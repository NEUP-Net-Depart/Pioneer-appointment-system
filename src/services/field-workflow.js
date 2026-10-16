import { fail } from "../lib/http.js";
import { dateKey, eventWindow } from "../platform/time.js";
import { campusId } from "../modules/authorization/scopes.js";
import { scanCode } from "../lib/scan-code.js";
import { presentAppointment } from "./appointments.js";
import { requestId, stableJson } from "../platform/contracts.js";

// The UI consumes these decisions; commands recompute them against current facts.
export function fieldWorkflow({
  repository,
  appointments,
  users,
  staff,
  authorizer,
  encryptionKey,
  secret,
  enabled,
}) {
  const names = { "campus-nanhu": "南湖", "campus-hunnan": "浑南" };
  const allowed = (context, code, target = {}) =>
    authorizer.evaluate(context.actor, code, target, context, context.grants)
      .allowed;
  async function eligibility(actor, campus, ignoreAppointment = "") {
    const context = await staff.contextFor(actor),
      id = campusId(campus);
    const current = await appointments.currentRepair(actor.account);
    const event = await repository.dutyEvent(dateKey(), id);
    const qualified = context.workProfiles.some((item) =>
      ["repair", "exchange"].includes(item.profileCode),
    );
    const reason =
      !qualified || !allowed(context, "repair.start", { campusId: id })
        ? "当前没有该校区的维修资格"
        : current && current.id !== ignoreAppointment
          ? "请先完成当前维修"
          : !context.presence || context.presence.campusId !== id
            ? "请先完成该校区到岗签到"
            : context.presence.state !== "available"
              ? "请先返回岗位"
              : !event ||
                  !eventWindow(
                    event.startsAt,
                    event.endsAt,
                    new Date().toISOString(),
                  )
                ? "当前不在值班工作窗口"
                : "";
    return { allowed: !reason, reason, context, event, current };
  }
  async function requireEligible(actor, campus, ignoreAppointment = "") {
    const result = await eligibility(actor, campus, ignoreAppointment);
    if (!result.allowed) fail(409, result.reason, "WORK_NOT_READY");
    return result;
  }
  async function home(actor, query = {}) {
    if (!enabled) return { enabled: false };
    const context = await staff.contextFor(actor);
    const campuses = (actor.authorizedCampuses || []).map((value) => ({
      id: campusId(value),
      name: names[campusId(value)] || value,
    }));
    const selected =
      query.campusId ||
      context.presence?.campusId ||
      context.todayDuties[0]?.campusId ||
      campuses[0]?.id;
    if (!campuses.some((item) => item.id === selected))
      fail(403, "没有该校区的访问权限");
    const target = { campusId: selected, memberId: context.actor.memberId };
    const capability = Object.fromEntries(
      [
        "repair.summary.read",
        "repair.start",
        "repair.transfer",
        "onsite.create",
        "onsite.frontdesk.create",
        "attendance.self",
        "attendance.session.manage",
        "members.manage",
        "roles.manage",
      ].map((code) => [code, allowed(context, code, target)]),
    );
    const ready = await eligibility(actor, selected);
    const current = ready.current
      ? await detail(actor, ready.current.id)
      : null;
    const contexts = [];
    if (
      (capability["repair.summary.read"] && context.workProfiles.some((item) =>
        ["repair", "exchange"].includes(item.profileCode),
      )) ||
      current
    )
      contexts.push({ id: "repair", label: "维修工作台" });
    if (capability["onsite.frontdesk.create"])
      contexts.push({ id: "desk", label: "接待台" });
    if (capability["repair.transfer"])
      contexts.push({ id: "operations", label: "现场管理" });
    const state = current
      ? "repairing"
      : !context.presence
        ? "unsigned"
        : context.presence.state === "away"
          ? "away"
          : ready.allowed
            ? "available"
            : "closed";
    return {
      enabled,
      businessDate: dateKey(),
      actor: context.actor,
      authVersion: context.authVersion,
      campuses,
      campusId: selected,
      contexts,
      capability,
      state,
      reason: ready.reason,
      currentRepair: current,
      todayDuties: context.todayDuties,
      presence: context.presence,
      event: ready.event,
      updatedAt: new Date().toISOString(),
    };
  }
  async function project(actor, item, providedContext) {
    const context = providedContext || (await staff.contextFor(actor)),
      target = {
        campusId: campusId(item.campus),
        assignedMemberId: item.assignedMemberId,
        id: item.id,
        businessDate: item.date,
      };
    if (
      !allowed(context, "repair.summary.read", target) &&
      item.assignedMemberId !== context.actor.memberId
    )
      return null;
    if (!(actor.authorizedCampuses || []).includes(item.campus)) return null;
    const publicItem = await presentAppointment(item, encryptionKey, {
      staff: true,
    });
    const identity = allowed(context, "customer.identity.read", target),
      contact = allowed(context, "customer.contact.read", target);
    const keys = [
      "id",
      "revision",
      "createdAt",
      "expiresAt",
      "repairNumber",
      "campus",
      "date",
      "timeSlot",
      "status",
      "source",
      "deviceType",
      "brand",
      "deviceModel",
      "warranty",
      "faultType",
      "issue",
      "assignedTo",
      "assignedToName",
      "assignedMemberId",
      "startedAt",
      "completedAt",
      "outcome",
      "repairNote",
      "frontPhotoId",
      "backPhotoId",
    ];
    if (identity) keys.push("name", "studentId");
    if (contact) keys.push("phone", "social");
    const visible = Object.fromEntries(
      keys.map((key) => [key, publicItem[key]]),
    );
    visible.canReadDetails =
      item.assignedMemberId === context.actor.memberId ||
      identity ||
      allowed(context, "repair.transfer", target);
    if (!visible.canReadDetails)
      for (const key of ["repairNote", "frontPhotoId", "backPhotoId"])
        delete visible[key];
    return visible;
  }
  async function projectList(actor, items) {
    const context = await staff.contextFor(actor);
    return (
      await Promise.all(items.map((item) => project(actor, item, context)))
    ).filter(Boolean);
  }
  async function detail(actor, id) {
    if (!enabled) fail(404, "现场工作台尚未启用");
    const item = await appointments.find(id);
    if (!item) fail(404, "预约不存在");
    const context = await staff.contextFor(actor),
      target = {
        campusId: campusId(item.campus),
        assignedMemberId: item.assignedMemberId,
        id: item.id,
        businessDate: item.date,
      };
    const visible = await project(actor, item, context);
    if (!visible) fail(403, "没有该预约的访问权限");
    return {
      ...visible,
      canCorrect: ['admin', 'superadmin'].includes(actor.role) || allowed(context, 'repair.correct', target),
      canRecoverCredential: ['admin', 'superadmin'].includes(actor.role),
      original: visible.canReadDetails && (item.assignedMemberId === context.actor.memberId || allowed(context, 'customer.identity.read', target)) ? {
        note: item.note, signature: item.signature, agreementAt: item.agreementAt, agreementVersion: item.agreementVersion,
        college: item.college, serial: item.serial, liquidDrop: item.liquidDrop,
      } : null,
      intake: visible.canReadDetails ? await repository.latestIntake(id) : null,
      canTransfer:
        item.status === "in_progress" &&
        allowed(context, "repair.transfer", target),
      canFinish:
        item.status === "in_progress" &&
        item.assignedMemberId === context.actor.memberId &&
        allowed(context, "repair.finish.own", target),
      canStart:
        item.status === "booked" &&
        (await eligibility(actor, item.campus)).allowed,
      repairCode: scanCode(item.id, secret),
    };
  }
  async function correctionAssignees(actor, id, query = {}) {
    const item = await detail(actor, id);
    if (!item.canCorrect) fail(403, '没有该预约的纠错权限');
    return { items: await users.assignees({ campus: item.campus, q: String(query.q || '').slice(0, 120) }) };
  }
  async function transferCandidates(actor, id) {
    const item = await detail(actor, id);
    if (!item.canTransfer) fail(403, '没有该预约的转派权限');
    const data = await board(actor, { campusId: campusId(item.campus) });
    return { items: data.staffPresence.filter(person => person.canReceive && person.memberId !== item.assignedMemberId) };
  }
  async function board(actor, query = {}) {
    if (!enabled) fail(404, "现场工作台尚未启用");
    const data = await home(actor, query);
    if (!data.contexts.some((item) => ["desk", "operations"].includes(item.id)))
      fail(403, "当前没有该校区的现场岗位权限");
    const context = await staff.contextFor(actor);
    await appointments.expirePending(new Date().toISOString(), {
      campuses: [names[data.campusId]],
    });
    const list = await appointments.list(
      {
        date: data.businessDate,
        status: "all",
        sort: "date",
        direction: "asc",
      },
      { campuses: [names[data.campusId]], technician: "" },
    );
    const people = await repository.fieldPeople(
      data.businessDate,
      data.campusId,
    );
    const staffPresence = await Promise.all(
      people.map(async (person) => {
        const user = await users.find(person.account);
        const ready =
          user?.status === "enabled" && user.memberStatus !== "inactive"
            ? await eligibility(user, data.campusId)
            : { allowed: false, reason: "成员或账号已停用" };
        return {
          ...person,
          state: ready.current ? "repairing" : person.state || "unsigned",
          canReceive: ready.allowed,
          reason: ready.reason,
          currentRepair: ready.current
            ? { id: ready.current.id, deviceModel: ready.current.deviceModel }
            : null,
        };
      }),
    );
    const items = list.items
      .filter((item) =>
        allowed(context, "repair.summary.read", {
          campusId: data.campusId,
          id: item.id,
          assignedMemberId: item.assignedMemberId,
        }),
      )
      .map((item) =>
        Object.fromEntries(
          [
            "id",
            "revision",
            "campus",
            "date",
            "timeSlot",
            "status",
            "deviceType",
            "deviceModel",
            "faultType",
            "assignedToName",
          ].map((key) => [key, item[key]]),
        ),
      );
    return { ...data, appointments: items, staffPresence };
  }
  async function assertTransfer(actor, item, targetAccount) {
    await staff.requirePermission(actor, "repair.transfer", {
      campusId: campusId(item.campus),
      id: item.id,
      assignedMemberId: item.assignedMemberId,
      businessDate: item.date,
    });
    if (item.status !== "in_progress") fail(409, "只有维修中的工单可以转派");
    const target = await users.find(targetAccount);
    if (
      !target ||
      target.status !== "enabled" ||
      target.memberStatus === "inactive"
    )
      fail(409, "接手人员已不可用");
    if (target.memberId === item.assignedMemberId)
      fail(409, "请选择其他接手人员");
    return requireEligible(target, item.campus);
  }
  async function receipt(actor, action, payload, id) {
    const key = requestId(payload.requestId);
    if (!key) fail(400, "缺少有效操作编号，请重新打开工单");
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(stableJson(payload)),
        ),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const prior = await repository.receipt(actor.memberId, action, key);
    if (prior) {
      if (prior.payloadHash !== hash || prior.resourceRef.id !== id)
        fail(409, "操作编号已用于其他内容");
      // A receipt never bypasses the caller's present-day resource authorization.
      return { replay: await detail(actor, id), payloadHash: hash };
    }
    return { payloadHash: hash };
  }
  return {
    enabled,
    projectList,
    home,
    board,
    detail,
    correctionAssignees,
    transferCandidates,
    eligibility,
    requireEligible,
    assertTransfer,
    receipt,
  };
}
