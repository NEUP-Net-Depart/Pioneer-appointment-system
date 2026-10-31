import { fail } from '../../lib/http.js';
import { weekRange, validDate, addDays } from '../../platform/time.js';
import { requestId, stableJson, publicResourceRef } from '../../platform/contracts.js';
import { campusId as normalizeCampusId } from '../../modules/authorization/scopes.js';
import {
  rosterScope,
  rosterTaskManaged,
  rosterDepartments,
  rosterMemberInScope,
  rosterMemberReadable
} from '../../modules/rosters/scope.js';
import { staffIdentities } from '../../../shared/staff-identities.js';
import { repairRosterPool, rosterFactContext } from '../../modules/rosters/qualification.js';
import {
  collectionInstant,
  validateRecurrence,
  recurringPeriodWeek
} from '../../modules/rosters/recurrence.js';
import { rosterCollections } from '../../../shared/roster-collections.js';

export function collectionsDomain({
  repository,
  platform,
  calendarClock,
  collectionStatus,
  contextFor,
  requirePermission,
  rosterWrite
}) {
  async function rosterOwnFact(context, task) {
    return (await repository.rosterMemberFacts([context.actor.memberId], task.weekStart)).find(
      (item) => item.memberId === context.actor.memberId
    );
  }

  function rosterParticipant(context, task, fact) {
    if (
      (task.dutyType === 'office' && task.workflowVersion !== 1) ||
      !validDate(task.weekStart) ||
      (task.memberIds?.length && !task.memberIds.includes(context.actor.memberId)) ||
      !fact?.active
    )
      return false;
    return Array.from({ length: 4 }, (_, offset) => addDays(task.weekStart, offset)).some(
      (day) =>
        (task.dutyType === 'office'
          ? fact.profiles.some(
              (item) =>
                item.profileCode === 'office' &&
                item.effectiveFrom <= day &&
                (!item.effectiveTo || day < item.effectiveTo)
            )
          : !!repairRosterPool(fact, platform.authorizer, day, {
              id: task.id,
              campusIds: rosterScope(task).campusIds
            })) &&
        rosterScope(task).campusIds.some((campusId) =>
          rosterMemberReadable(context, platform.authorizer, fact, task, day, campusId)
        )
    );
  }

  async function rosterOptions(actor, query = {}) {
    const dutyType = query.dutyType || 'repair';
    if (!['repair', 'office'].includes(dutyType)) fail(400, '岗位类型不正确');
    const context = await contextFor(actor),
      code = dutyType === 'office' ? 'roster.office.manage' : 'roster.repair.manage';
    if (!context.permissions[code]) fail(403, '没有创建此类排班任务的权限');
    const [campuses, departments] = await Promise.all([
      repository.listCampuses(),
      repository.listDepartments()
    ]);
    return {
      items: campuses
        .map((campus) => {
          const task = (departmentIds) => ({
            dutyType,
            campusScope: {
              campusIds: [campus.id],
              ...(departmentIds.length ? { departmentIds } : {})
            }
          });
          return {
            campusId: campus.id,
            name: campus.name,
            allDepartments: rosterTaskManaged(context, platform.authorizer, task([])),
            departments: departments.filter((department) =>
              rosterTaskManaged(context, platform.authorizer, task([department.id]))
            )
          };
        })
        .filter((campus) => campus.allDepartments || campus.departments.length)
    };
  }

  async function rosterCandidates(actor, input) {
    const task = input.campusScope
      ? input
      : {
          ...input,
          dutyType: input.dutyType || 'repair',
          campusScope: {
            campusIds: input.campusIds || [],
            departmentIds: input.departmentIds || []
          }
        };
    if (!validDate(task.weekStart) || !rosterScope(task).valid) fail(400, '请先选择工作周和校区');
    const context = await contextFor(actor);
    if (!rosterTaskManaged(context, platform.authorizer, task))
      fail(403, '没有管理此范围排班的权限');
    const facts = await repository.rosterMemberFacts(
      await repository.rosterAudience(),
      task.weekStart
    );
    const items = facts.filter(
      (fact) =>
        fact.active &&
        Array.from({ length: 4 }, (_, i) => addDays(task.weekStart, i)).some((day) =>
          rosterScope(task).campusIds.some(
            (campusId) =>
              rosterMemberInScope(fact, task, day, campusId) &&
              (task.dutyType === 'office'
                ? fact.profiles.some(
                    (item) =>
                      item.profileCode === 'office' &&
                      item.effectiveFrom <= day &&
                      (!item.effectiveTo || day < item.effectiveTo)
                  )
                : (rosterDepartments(fact, day, task).length
                    ? rosterDepartments(fact, day, task)
                    : [{}]
                  ).some((item) =>
                    repairRosterPool(fact, platform.authorizer, day, {
                      campusId,
                      departmentId: item.departmentId
                    })
                  ))
          )
        )
    );
    return {
      items: items.map((fact) => ({
        memberId: fact.memberId,
        name: fact.name,
        identities: staffIdentities(rosterFactContext(fact, task.weekStart), platform.authorizer)
      }))
    };
  }

  const commandRecord = (actor, context, input) => ({
    actorMemberId: context.actor.memberId,
    actorAccount: actor.account,
    authVersion: context.authVersion,
    requestId: requestId(input.requestId) || crypto.randomUUID()
  });

  const configurableCampuses = (context, task) =>
    rosterScope(task).campusIds.filter((campusId) =>
      rosterTaskManaged(
        context,
        platform.authorizer,
        { ...task, campusScope: { ...task.campusScope, campusIds: [campusId] } },
        task.dutyType === 'office' ? 'roster.office.manage' : 'roster.repair.configure'
      )
    );

  async function collectionCommand(actor, taskId, input) {
    const task = await repository.rosterTaskById(taskId),
      context = await contextFor(actor);
    if (!task) fail(404, '收集任务不存在');
    if (!rosterTaskManaged(context, platform.authorizer, task))
      fail(403, '没有结束或重新开放收集的权限');
    const record = commandRecord(actor, context, input);
    const replay = await repository.rosterCommandReceipt(
      record.actorMemberId,
      'collection',
      record.requestId
    );
    if (replay) {
      if (replay.resourceId !== taskId || replay.payload !== JSON.stringify(input))
        fail(409, '请求编号已用于其他操作');
      return repository.rosterTaskById(taskId);
    }
    if (!['close', 'reopen'].includes(input.action) || input.revision !== task.revision)
      fail(409, '任务状态已更新，请刷新核对');
    if (
      input.action === 'reopen' &&
      (!Number.isFinite(Date.parse(input.deadline)) || Date.parse(input.deadline) <= Date.now())
    )
      fail(400, '请选择未来的截止时间');
    try {
      await repository.changeCollection(task, input, record);
    } catch (error) {
      if (String(error.message).includes('constraint')) fail(409, '任务或权限已变化，请刷新核对');
      throw error;
    }
    if (input.action === 'close' && task.seriesId)
      await currentCollectionPeriods(actor, context, await repository.listRosterTasks());
    return repository.rosterTaskById(taskId);
  }

  async function addParticipants(actor, taskId, input) {
    const task = await repository.rosterTaskById(taskId),
      context = await contextFor(actor);
    if (!task) fail(404, '收集任务不存在');
    if (!rosterTaskManaged(context, platform.authorizer, task)) fail(403, '没有增补参与人员的权限');
    const record = commandRecord(actor, context, input),
      replay = await repository.rosterCommandReceipt(
        record.actorMemberId,
        'participants',
        record.requestId
      );
    if (replay) {
      if (replay.resourceId !== taskId || replay.payload !== JSON.stringify(input))
        fail(409, '请求编号已被使用');
      return repository.rosterTaskById(taskId);
    }
    if (
      input.revision !== task.revision ||
      !Array.isArray(input.memberIds) ||
      !input.memberIds.length ||
      new Set([...task.memberIds, ...input.memberIds]).size > 300
    )
      fail(400, '请核对任务版本与增补名单');
    const candidates = await rosterCandidates(actor, task);
    if (input.memberIds.some((id) => !candidates.items.some((member) => member.memberId === id)))
      fail(403, '增补人员必须具有本任务范围的有效排班资格');
    try {
      await repository.addRosterParticipants(task, input, record);
    } catch (error) {
      if (String(error.message).includes('constraint')) fail(409, '任务或权限已变化，请刷新核对');
      throw error;
    }
    return repository.rosterTaskById(taskId);
  }

  async function submitAvailability(
    actor,
    taskId,
    input,
    { carried = false, preferenceRevision, continuationAt } = {}
  ) {
    const task = await repository.rosterTaskById(taskId),
      context = await contextFor(actor);
    if (!task) fail(404, '收集任务不存在');
    const fact = await rosterOwnFact(context, task);
    if (!rosterParticipant(context, task, fact)) fail(403, '你不在本次收集范围内');
    const record = commandRecord(actor, context, input),
      replay = await repository.rosterCommandReceipt(
        record.actorMemberId,
        'availability',
        record.requestId
      );
    if (replay) {
      if (replay.resourceId !== taskId || replay.payload !== JSON.stringify({ ...input, carried }))
        fail(409, '请求编号已用于其他填报');
      return taskAvailability(actor, taskId);
    }
    const state = collectionStatus(task),
      continuationClosed =
        carried && state === 'closed' && continuationAt === continuationCutoff(task);
    if (state !== 'open' && !continuationClosed) fail(409, '收集已结束，请联系负责人重新开放');
    if (
      !Array.isArray(input.windows) ||
      input.windows.length > 64 ||
      (!input.windows.length && input.unavailable !== true) ||
      (input.windows.length && input.unavailable)
    )
      fail(400, '请填写可用时间，或选择整周无法参加');
    const paused = await repository.serviceDays(task.weekStart, addDays(task.weekStart, 3));
    for (const window of input.windows) {
      if (
        paused.some(
          (day) =>
            day.paused &&
            day.businessDate === window.businessDate &&
            day.campusId === window.campusId
        )
      )
        fail(409, '该日期暂停维修，请取消该日期后提交', 'SERVICE_DAY_PAUSED');
      if (window.startAt !== task.slotStart || window.endAt !== task.slotEnd)
        fail(400, '请选择完整值班日期和校区，不能只参加部分班次');
      if (
        !validDate(window.businessDate) ||
        window.businessDate < task.weekStart ||
        window.businessDate > addDays(task.weekStart, 3) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.startAt) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.endAt) ||
        window.endAt <= window.startAt
      )
        fail(400, '请填写本周工作日的有效时间');
      if (
        !rosterMemberReadable(
          context,
          platform.authorizer,
          fact,
          task,
          window.businessDate,
          window.campusId
        ) ||
        !(task.dutyType === 'office'
          ? fact.profiles.some(
              (item) =>
                item.profileCode === 'office' &&
                item.effectiveFrom <= window.businessDate &&
                (!item.effectiveTo || window.businessDate < item.effectiveTo)
            )
          : (rosterDepartments(fact, window.businessDate, task).length
              ? rosterDepartments(fact, window.businessDate, task)
              : [{}]
            ).some((item) =>
              repairRosterPool(fact, platform.authorizer, window.businessDate, {
                campusId: window.campusId,
                departmentId: item.departmentId
              })
            ))
      )
        fail(403, '填报日期或校区不在有效资格和授权范围内');
    }
    const payload = { ...input, carried };
    try {
      await repository.replaceRosterAvailability(task, context.actor.memberId, payload, {
        ...record,
        preferenceRevision,
        continuationAt,
        continuationClosed
      });
    } catch (error) {
      if (String(error.message).toLowerCase().includes('constraint'))
        fail(409, '填报、收集状态或权限已变化，输入已保留，请重新核对');
      throw error;
    }
    return taskAvailability(actor, taskId);
  }

  async function collectionMember(memberId) {
    const row = await repository.accountForMember(memberId);
    if (!row || row.status !== 'enabled') fail(403, '收集任务负责人账号已停用，请联系管理员接管');
    return {
      account: row.account,
      memberId,
      role: row.role,
      homeCampus: row.home_campus,
      authorizedCampuses: await repository.memberCampuses(memberId),
      authVersion: row.auth_version
    };
  }

  async function currentCollectionPeriods(actor, context, tasks) {
    const ids = [...new Set(tasks.map((task) => task.seriesId).filter(Boolean))];
    for (const id of ids) {
      const series = await repository.rosterSeries(id);
      if (!series?.enabled) continue;
      const template = await repository.rosterTaskById(series.template_task_id);
      if (!template) continue;
      const own = await rosterOwnFact(context, template);
      if (
        !rosterTaskManaged(context, platform.authorizer, template) &&
        !rosterParticipant(context, template, own) &&
        !configurableCampuses(context, template).length
      )
        continue;
      const first = tasks
        .filter((task) => task.seriesId === id)
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart))[0];
      const week = recurringPeriodWeek(series, first.weekStart, calendarClock());
      if (tasks.some((task) => task.seriesId === id && task.weekStart === week)) continue;
      // Only opening the ordinary collection resolves the current period. There
      // is no cron, timer, catch-up queue or future task publication.
      try {
        const owner = await collectionMember(series.owner_member_id);
        const candidates = await rosterCandidates(owner, { ...template, weekStart: week });
        const memberIds = template.memberIds.filter((id) =>
          candidates.items.some((item) => item.memberId === id)
        );
        if (!memberIds.length) {
          for (const task of tasks.filter((task) => task.seriesId === id))
            task.collectionIssue = '当前参与名单已无符合条件的人员，请负责人更新收集设置。';
          continue;
        }
        const period = await createRosterTask(
          owner,
          {
            weekStart: week,
            campusIds: template.campusScope.campusIds,
            departmentIds: template.campusScope.departmentIds || [],
            dutyType: template.dutyType,
            slotStart: template.slotStart,
            slotEnd: template.slotEnd,
            collectionOpensAt: new Date(
              Math.min(
                calendarClock().getTime(),
                Date.parse(
                  collectionInstant(
                    addDays(week, -7),
                    series.deadline_weekday,
                    series.deadline_time
                  )
                )
              )
            ).toISOString(),
            deadline: collectionInstant(week, series.deadline_weekday, series.deadline_time),
            description: template.description,
            memberIds,
            workflowVersion: 1,
            seriesId: id,
            requirements: template.requirements.map((row) => ({
              ...row,
              businessDate: addDays(
                week,
                Math.round(
                  (Date.parse(row.businessDate) - Date.parse(template.weekStart)) / 86400000
                )
              )
            })),
            requestId: `period:${id}:${week}`
          },
          { period: true, allowClosedPeriod: true }
        );
        tasks.push(period);
      } catch (error) {
        if (error.status === 403) {
          for (const task of tasks.filter((task) => task.seriesId === id))
            task.collectionIssue =
              '收集负责人的账号或授权已变化，请有管理权限的负责人保存收集设置后继续。';
          continue;
        }
        if (error.status !== 409) throw error;
        const concurrent = (await repository.listRosterTasks()).find(
          (task) => task.seriesId === id && task.weekStart === week
        );
        if (concurrent) tasks.push(concurrent);
        else
          for (const task of tasks.filter((task) => task.seriesId === id))
            task.collectionIssue = '当前工作周已有重叠任务，请负责人核对范围后继续。';
      }
    }
    return tasks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }

  function continuationCutoff(task) {
    return new Date(
      Math.min(
        calendarClock().getTime(),
        Date.parse(task.deadline),
        task.collectionClosedAt ? Date.parse(task.collectionClosedAt) : Infinity
      )
    ).toISOString();
  }

  async function applyAvailabilityContinuation(task, memberId) {
    if (collectionStatus(task) === 'scheduled' || !repository.pendingRosterPreferences) return;
    const continuationAt = continuationCutoff(task);
    for (const preference of await repository.pendingRosterPreferences(task.id, continuationAt)) {
      if (memberId && preference.member_id !== memberId) continue;
      try {
        const actor = await collectionMember(preference.member_id);
        const origin = await repository.rosterTaskById(preference.source_task_id);
        const paused = await repository.serviceDays(task.weekStart, addDays(task.weekStart, 3));
        const windows = JSON.parse(preference.windows)
          .filter(
            (window) =>
              task.campusScope.campusIds.includes(window.campusId) &&
              origin &&
              window.startAt <= task.slotStart &&
              window.endAt >= task.slotEnd
          )
          .map(({ weekday, ...window }) => ({
            ...window,
            startAt: task.slotStart,
            endAt: task.slotEnd,
            businessDate: addDays(task.weekStart, weekday - 1)
          }))
          .filter(
            (window) =>
              !paused.some(
                (day) =>
                  day.paused &&
                  day.businessDate === window.businessDate &&
                  day.campusId === window.campusId
              )
          );
        if (!preference.unavailable && !windows.length) continue;
        await submitAvailability(
          actor,
          task.id,
          {
            windows,
            unavailable: !!preference.unavailable,
            revision: -1,
            requestId: `carry:${task.id}:${preference.member_id}:${preference.revision}`
          },
          { carried: true, preferenceRevision: preference.revision, continuationAt }
        );
      } catch (error) {
        if (![403, 409].includes(error.status)) throw error;
      }
    }
  }

  async function seriesCommand(actor, id, input) {
    const series = await repository.rosterSeries(id),
      context = await contextFor(actor);
    if (!series) fail(404, '循环收集不存在');
    const task = await repository.rosterTaskById(series.template_task_id);
    if (!rosterTaskManaged(context, platform.authorizer, task))
      fail(403, '没有管理此循环任务的权限');
    const record = commandRecord(actor, context, input),
      signature = stableJson({ id, input });
    const replay = await repository.rosterCommandReceipt(
      record.actorMemberId,
      'series',
      record.requestId
    );
    if (replay) {
      if (JSON.parse(replay.payload).signature !== signature)
        fail(409, '请求编号已用于其他循环设置');
      return repository.rosterSeries(id);
    }
    if (input.revision !== series.revision || typeof input.enabled !== 'boolean')
      fail(409, '循环配置已变化，请重新读取');
    if (
      input.name !== undefined &&
      (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80)
    )
      fail(400, '收集名称须为 1–80 个字符');
    if (input.recurrence && !validateRecurrence(input.recurrence))
      fail(400, '请设置每周截止星期和时间（值班前一周）');
    const template = input.templateTaskId
      ? await repository.rosterTaskById(input.templateTaskId)
      : task;
    if (
      !template ||
      template.seriesId !== id ||
      !rosterTaskManaged(context, platform.authorizer, template)
    )
      fail(403, '不能使用此周次作为后续收集设置');
    if (input.templateTaskId && input.templateRevision !== template.revision)
      fail(409, '本周设置已变化，请重新读取后再应用到后续周期');
    await rosterWrite(() =>
      repository.updateRosterSeries(
        series,
        {
          ...input,
          name: input.name?.trim() ?? series.name,
          templateTaskId: template.id,
          templateRevision: template.revision,
          recurrence: input.recurrence || {
            publishWeekday: series.publish_weekday,
            publishTime: series.publish_time,
            deadlineWeekday: series.deadline_weekday,
            deadlineTime: series.deadline_time
          },
          signature
        },
        record
      )
    );
    return repository.rosterSeries(id);
  }

  async function availabilityPreferences(actor, input) {
    const context = await contextFor(actor);
    if (input) {
      if (!['repair', 'office'].includes(input.dutyType) || input.enabled !== false)
        fail(400, '请选择需要关闭的自动延续');
      await repository.disableRosterPreference(context.actor.memberId, input.dutyType);
    }
    return { items: await repository.rosterPreferences(context.actor.memberId) };
  }

  async function rosterTasks(actor) {
    const context = await contextFor(actor);
    if (
      ![
        'roster.read',
        'roster.repair.manage',
        'roster.office.manage',
        'roster.repair.configure'
      ].some((code) => context.permissions[code])
    )
      fail(403, '没有查看排班任务的权限');
    const [storedTasks, departments, campuses] = await Promise.all([
      repository.listRosterTasks(),
      repository.listDepartments(true),
      repository.listCampuses(true)
    ]);
    const tasks = await currentCollectionPeriods(actor, context, storedTasks);
    const ownFacts = new Map(),
      items = [];
    for (const task of tasks) {
      const manage = rosterTaskManaged(context, platform.authorizer, task);
      const writableCampuses = configurableCampuses(context, task);
      const configure = writableCampuses.length > 0;
      if (context.permissions['roster.read'] && !ownFacts.has(task.weekStart))
        ownFacts.set(task.weekStart, await rosterOwnFact(context, task));
      const fill = rosterParticipant(context, task, ownFacts.get(task.weekStart));
      if (!manage && !fill && !configure) continue;
      const scope = rosterScope(task);
      const label = [
        ...scope.campusIds.map((id) => campuses.find((item) => item.id === id)?.name || id),
        ...scope.departmentIds.map((id) => departments.find((item) => item.id === id)?.name || id)
      ];
      const { memberIds, createdByMemberId, ...summary } = task;
      items.push({
        ...summary,
        ...(!manage && !fill
          ? {
              campusScope: { ...task.campusScope, campusIds: writableCampuses },
              requirements: summary.requirements.filter((item) =>
                writableCampuses.includes(item.campusId)
              )
            }
          : {}),
        collectionState: collectionStatus(task),
        ...(manage ? { memberIds, createdByMemberId } : {}),
        scopeLabel:
          !manage && !fill
            ? writableCampuses
                .map((id) => campuses.find((item) => item.id === id)?.name || id)
                .join(' · ')
            : label.join(' · '),
        actions: {
          manage,
          readOwn: fill,
          fill: fill && collectionStatus(task) === 'open',
          configure
        }
      });
    }
    return { items, collections: rosterCollections(items) };
  }

  async function taskAvailability(actor, taskId) {
    const context = await contextFor(actor);
    const task = await repository.rosterTaskById(taskId);
    if (!task) fail(404, '排班任务不存在');
    const manage = rosterTaskManaged(context, platform.authorizer, task),
      own = await rosterOwnFact(context, task);
    if (!manage && !rosterParticipant(context, task, own))
      fail(403, '没有查看该任务填报信息的权限');
    await applyAvailabilityContinuation(task, context.actor.memberId);
    const rows = await repository.availability(taskId);
    const facts = new Map(
      (
        await repository.rosterMemberFacts(
          [...new Set(rows.map((row) => row.memberId))],
          task.weekStart
        )
      ).map((item) => [item.memberId, item])
    );
    const submission = repository.rosterSubmissions
      ? (await repository.rosterSubmissions(taskId)).find(
          (item) => item.memberId === context.actor.memberId
        )
      : null;
    const preference = repository.rosterPreferences
      ? (await repository.rosterPreferences(context.actor.memberId)).find(
          (item) => item.duty_type === task.dutyType
        )
      : null;
    const pausedDays = await repository.serviceDays(task.weekStart, addDays(task.weekStart, 3));
    const selectableSlots = Array.from({ length: 4 }, (_, i) => addDays(task.weekStart, i)).flatMap(
      (businessDate) =>
        rosterScope(task)
          .campusIds.filter(
            (campusId) =>
              !pausedDays.some(
                (day) =>
                  day.paused && day.businessDate === businessDate && day.campusId === campusId
              ) &&
              own?.active &&
              rosterMemberReadable(
                context,
                platform.authorizer,
                own,
                task,
                businessDate,
                campusId
              ) &&
              (task.dutyType === 'office'
                ? own.profiles.some(
                    (profile) =>
                      profile.profileCode === 'office' &&
                      profile.effectiveFrom <= businessDate &&
                      (!profile.effectiveTo || businessDate < profile.effectiveTo)
                  )
                : !!repairRosterPool(own, platform.authorizer, businessDate, {
                    id: task.id,
                    campusId
                  }))
          )
          .map((campusId) => ({ businessDate, campusId }))
    );
    return {
      submission,
      selectableSlots,
      autoContinue: !!preference?.enabled,
      items: rows.filter(
        (item) =>
          rosterMemberInScope(facts.get(item.memberId), task, item.businessDate, item.campusId) &&
          (manage ||
            (item.memberId === context.actor.memberId &&
              rosterMemberReadable(
                context,
                platform.authorizer,
                own,
                task,
                item.businessDate,
                item.campusId
              )))
      )
    };
  }

  async function createRosterTask(
    actor,
    input,
    { period = false, allowClosedPeriod = false } = {}
  ) {
    const dutyType = input.dutyType || 'repair';
    if (!['repair', 'office'].includes(dutyType)) fail(400, '岗位类型不正确');
    if (
      input.collectionName !== undefined &&
      (typeof input.collectionName !== 'string' || input.collectionName.trim().length > 80)
    )
      fail(400, '收集名称最多 80 个字符');
    if (
      !validDate(input.weekStart) ||
      weekRange(input.weekStart).start !== input.weekStart ||
      !(input.campusId || input.campusIds?.length) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.slotStart) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.slotEnd) ||
      input.slotEnd <= input.slotStart ||
      !Number.isFinite(Date.parse(input.deadline))
    )
      fail(400, '请选择周一、有效校区、完整班次时间和填报截止时间');
    if (
      input.departmentIds !== undefined &&
      (!Array.isArray(input.departmentIds) ||
        input.departmentIds.length > 100 ||
        input.departmentIds.some((id) => typeof id !== 'string' || !id.trim()))
    )
      fail(400, '部门范围不正确');
    if (
      input.memberIds !== undefined &&
      (!Array.isArray(input.memberIds) ||
        input.memberIds.length > 300 ||
        input.memberIds.some((id) => typeof id !== 'string' || !id.trim()))
    )
      fail(400, '邀请名单不正确');
    const departmentIds = [...new Set(input.departmentIds || [])].sort();
    if (
      input.campusIds !== undefined &&
      (!Array.isArray(input.campusIds) ||
        !input.campusIds.length ||
        input.campusIds.some((id) => typeof id !== 'string'))
    )
      fail(400, '请选择有效校区');
    const selectedCampuses = [
      ...new Set((input.campusIds || [input.campusId]).map(normalizeCampusId))
    ].sort();
    const task = {
      ...input,
      id: crypto.randomUUID(),
      dutyType,
      memberIds: [...new Set(input.memberIds || [])].sort(),
      campusScope: {
        campusIds: selectedCampuses,
        ...(departmentIds.length ? { departmentIds } : {})
      }
    };
    if (!period) {
      delete task.seriesId;
      delete task.collectionOpensAt;
    }
    if (input.recurrence?.enabled) {
      if (input.workflowVersion !== 1 || !validateRecurrence(input.recurrence))
        fail(400, '请设置每周截止星期和时间（值班前一周）');
      task.recurrence = { publishWeekday: 1, publishTime: '00:00', ...input.recurrence };
    }
    if (dutyType === 'repair' || input.workflowVersion === 1)
      task.requirements = normalizedRequirements(task, input.requirements);
    const context = await contextFor(actor);
    if (!rosterTaskManaged(context, platform.authorizer, task))
      fail(403, '没有管理所选校区与部门排班的权限');
    if (input.workflowVersion === 1) {
      const record = commandRecord(actor, context, input),
        signature = stableJson(input);
      const replay = await repository.rosterCommandReceipt(
        record.actorMemberId,
        'create-task',
        record.requestId
      );
      if (replay) {
        if (JSON.parse(replay.payload).signature !== signature) fail(409, '请求编号已用于其他任务');
        return repository.rosterTaskById(replay.resourceId);
      }
      task.commandRecord = record;
      task.commandSignature = signature;
    }
    const [campuses, departments] = await Promise.all([
      repository.listCampuses(),
      repository.listDepartments()
    ]);
    if (
      selectedCampuses.some((id) => !campuses.some((item) => item.id === id)) ||
      departmentIds.some((id) => !departments.some((item) => item.id === id))
    )
      fail(400, '请选择有效校区和部门');
    if (input.workflowVersion === 1) {
      if (!allowClosedPeriod && Date.parse(input.deadline) <= Date.now())
        fail(400, '收集截止时间应晚于现在');
      const candidates = await rosterCandidates(actor, task);
      if (!input.memberIds?.length) task.memberIds = candidates.items.map((item) => item.memberId);
      else if (input.memberIds.some((id) => !candidates.items.some((item) => item.memberId === id)))
        fail(403, '名单中存在无有效排班资格的成员');
      if (!task.memberIds.length || task.memberIds.length > 300)
        fail(400, '请选择 1–300 名参与人员');
      if (
        (await repository.listRosterTasks()).some(
          (other) =>
            other.dutyType === dutyType &&
            other.weekStart === task.weekStart &&
            other.slotStart < task.slotEnd &&
            task.slotStart < other.slotEnd &&
            rosterScope(other).campusIds.some((id) => selectedCampuses.includes(id)) &&
            (!departmentIds.length ||
              !rosterScope(other).departmentIds.length ||
              departmentIds.some((id) => rosterScope(other).departmentIds.includes(id)))
        )
      )
        fail(409, '所选范围已有收集任务，请打开现有任务继续处理');
    }
    const invited = await repository.rosterMemberFacts(task.memberIds, task.weekStart);
    if (
      invited.length !== task.memberIds.length ||
      invited.some(
        (fact) =>
          !Array.from({ length: 4 }, (_, offset) => addDays(task.weekStart, offset)).some((day) =>
            selectedCampuses.some((campusId) => rosterMemberInScope(fact, task, day, campusId))
          )
      )
    )
      fail(403, '邀请名单包含排班范围外的成员');
    let result;
    try {
      result = await rosterWrite(() => repository.createRosterTask(task, context.actor.memberId));
    } catch (error) {
      if (
        String(error.message).includes('UNIQUE constraint failed: roster_tasks.') ||
        String(error.message).includes('ROSTER_TASK_SCOPE_OVERLAP')
      )
        fail(409, '本周此校区、部门和时段已有同类任务，请打开现有任务');
      throw error;
    }
    if (!task.commandRecord || !repository.rosterAudit)
      await repository.audit({
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        action: 'rosters.task.created',
        sourceRef: publicResourceRef('rosters', 'task', result.id),
        after: result,
        requestId: input.requestId
      });
    return result;
  }

  function normalizedRequirements(task, values) {
    const slots = Array.from({ length: 4 }, (_, offset) =>
      rosterScope(task).campusIds.map((campusId) => ({
        businessDate: addDays(task.weekStart, offset),
        campusId
      }))
    ).flat();
    if (values === undefined) return slots.map((slot) => ({ ...slot, ordinaryMinimum: 1 }));
    if (
      !Array.isArray(values) ||
      values.length !== slots.length ||
      slots.some(
        (slot) =>
          values.filter(
            (item) => item?.businessDate === slot.businessDate && item.campusId === slot.campusId
          ).length !== 1
      ) ||
      values.some(
        (item) =>
          !Number.isInteger(item.ordinaryMinimum) ||
          item.ordinaryMinimum < 0 ||
          item.ordinaryMinimum > 300
      )
    )
      fail(400, '请为周一至周四的每个校区填写 0–300 名普通维修人员最低需求');
    return slots.map((slot) => ({
      ...slot,
      ordinaryMinimum: values.find(
        (item) => item.businessDate === slot.businessDate && item.campusId === slot.campusId
      ).ordinaryMinimum
    }));
  }

  async function rosterRequirements(actor, taskId, input) {
    const context = await contextFor(actor),
      task = await repository.rosterTaskById(taskId);
    if (!task) fail(404, '排班任务不存在');
    const writableCampuses = configurableCampuses(context, task);
    if (!writableCampuses.length) fail(403, '没有配置此范围人员需求的权限');
    const visibleTask = {
      ...task,
      memberIds: undefined,
      campusScope: { ...task.campusScope, campusIds: writableCampuses },
      requirements: task.requirements.filter((item) => writableCampuses.includes(item.campusId))
    };
    if (!input)
      return {
        task: visibleTask,
        requirements: visibleTask.requirements?.length
          ? visibleTask.requirements
          : normalizedRequirements(visibleTask),
        requiresRuleConfirmation:
          task.dutyType !== 'office' && task.ruleVersion !== 'repair-minimum-v2'
      };
    if (!Number.isInteger(input.revision) || input.revision !== task.revision)
      fail(409, '需求已被其他人更新，请刷新后核对；当前输入尚未清除');
    const edited = normalizedRequirements(visibleTask, input.requirements);
    const requirements = normalizedRequirements(task).map(
      (row) =>
        edited.find(
          (item) => item.businessDate === row.businessDate && item.campusId === row.campusId
        ) ||
        task.requirements.find(
          (item) => item.businessDate === row.businessDate && item.campusId === row.campusId
        ) ||
        row
    );
    const result = await repository.saveRosterRequirements(
      task,
      { revision: input.revision, requirements },
      {
        actorMemberId: context.actor.memberId,
        actorAccount: actor.account,
        authVersion: context.authVersion,
        action: 'rosters.requirements.updated',
        sourceRef: publicResourceRef('rosters', 'task', taskId),
        before: { requirements: task.requirements, ruleVersion: task.ruleVersion },
        after: { requirements, ruleVersion: 'repair-minimum-v2' },
        requestId: input.requestId
      }
    );
    if (!result) fail(409, '需求或权限已变化，请刷新后核对');
    return {
      task: { ...visibleTask, revision: result.revision, ruleVersion: result.ruleVersion },
      requirements: result.requirements.filter((item) => writableCampuses.includes(item.campusId)),
      requiresRuleConfirmation: false
    };
  }

  async function saveAvailability(actor, taskId, input) {
    if (
      !validDate(input.businessDate) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startAt) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endAt) ||
      input.endAt <= input.startAt
    )
      fail(400, '可用时间范围不正确');
    const context = await contextFor(actor);
    await requirePermission(actor, 'roster.read', { memberId: context.actor.memberId });
    const task = await repository.rosterTaskById(taskId);
    if (!task) fail(404, '排班任务不存在');
    if (task.workflowVersion === 1) fail(409, '请使用整周填报提交，避免覆盖已提交的收集结果');
    if (task.dutyType === 'office' && task.workflowVersion !== 1) fail(400, '旧办公班表无需填报');
    if (task.memberIds?.length && !task.memberIds.includes(context.actor.memberId))
      fail(403, '该任务未邀请你填报');
    if (collectionStatus(task) !== 'open') fail(409, '该任务已结束收集，请联系负责人重新开放');
    if (weekRange(input.businessDate).start !== task.weekStart) fail(400, '请选择任务所在周的日期');
    if (input.businessDate > addDays(task.weekStart, 3)) fail(400, '请选择周一至周四的服务日期');
    const campusIds = task.campusScope?.campusIds || [];
    const allowed = (await repository.memberCampuses(context.actor.memberId)).map(
      normalizeCampusId
    );
    if (!campusIds.includes(input.campusId) || !allowed.includes(input.campusId))
      fail(403, '该校区不在本次任务或你的授权范围内');
    const fact = await rosterOwnFact(context, task);
    const qualified =
      fact &&
      !!repairRosterPool(fact, platform.authorizer, input.businessDate, {
        id: task.id,
        campusId: input.campusId
      });
    if (
      !qualified ||
      !rosterParticipant(context, task, fact) ||
      !rosterMemberReadable(
        context,
        platform.authorizer,
        fact,
        task,
        input.businessDate,
        input.campusId
      )
    )
      fail(403, '该日期的校区、部门或填报资格不在你的授权范围内');
    return repository.saveAvailability(taskId, context.actor.memberId, input, input.revision);
  }
  return {
    rosterOptions,
    rosterCandidates,
    commandRecord,
    collectionCommand,
    addParticipants,
    submitAvailability,
    applyAvailabilityContinuation,
    seriesCommand,
    availabilityPreferences,
    rosterTasks,
    taskAvailability,
    createRosterTask,
    rosterRequirements,
    saveAvailability
  };
}
