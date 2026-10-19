import React, { useEffect, useState } from "react";
import { api, Empty, Modal, Notice, CredentialCard, Scanner, Status, time } from "./ui";
import { useField } from "./useField";
import { Repair } from "./Repair";
import {AppointmentLookup} from './AppointmentLookup';
import { Registration } from "./Registration";
import type { Home } from "./types";
import { WorkspaceHeader } from '../WorkspaceHeader';
import { StaffIdentity } from '../StaffIdentity';
import { compareFieldPeople, fieldPersonGroup } from '../../../shared/staff-identities.js';
import "./field.css";

export function FieldApp({
  initial,
  onNavigate,
  workspaceLinks = [],
  requestedScene,
  onSceneChange,
  onContextChange,
  active = true,
}: {
  initial: Home;
  workspaceLinks?: { id: string; label: string; group?: string }[];
  requestedScene?: string | null;
  onSceneChange?: (scene: string) => void;
  onContextChange?: (home: Home) => void;
  active?: boolean;
  onNavigate: (view: string) => void;
}) {
  const key = `field-scene:${initial.actor.memberId}`;
  const [scene, setScene] = useState(() =>
    requestedScene || (initial.currentRepair
      ? "repair"
      : initial.contexts.find((c) => c.id === sessionStorage.getItem(key))
          ?.id ||
        initial.contexts.find((c) => c.id === "desk")?.id ||
        initial.contexts[0]?.id ||
        "mine"),
  );
  useEffect(() => {
    if (requestedScene && (requestedScene === 'mine' || initial.contexts.some(context => context.id === requestedScene))) setScene(requestedScene);
  }, [requestedScene, initial.contexts]);
  const [campus, setCampus] = useState(initial.campusId),
    [selected, setSelected] = useState(""),
    [scanOpen, setScanOpen] = useState(false),
    [registration, setRegistration] = useState(false);
  const [message, setMessage] = useState(""),
    [token, setToken] = useState<{ token: string; expiresAt: string } | null>(
      null,
    ),
    [checkToken, setCheckToken] = useState("");
  const [checkResult,setCheckResult]=useState<{occurredAt:string;type?:string;campusId?:string;isExisting?:boolean;nonScheduled?:boolean;identitySnapshot?:{identities?:{code:string;label:string}[]}}|null>(null);
  const [checkPreview, setCheckPreview] = useState<{
    campusName: string;
    businessDate: string;
    startsAt: string;
    endsAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [tab, setTab] = useState("appointments"),
    [showAvailable, setShowAvailable] = useState(false),
    [peopleQuery, setPeopleQuery] = useState('');
  const result = useField(
      campus,
      scene,
      `${initial.actor.memberId}:${initial.authVersion}`,
      initial,
      active,
    ),
    data = result.data;
  const refresh = result.refresh;
  useEffect(() => {
    if (active) return;
    // Leaving the route must release device-backed UI immediately. The
    // selected repair remains mounted so an unfinished form can be resumed.
    setScanOpen(false);
    setToken(null);
    setCheckToken("");
    setCheckPreview(null);
    setCheckResult(null);
  }, [active]);
  useEffect(() => {
    if (!data) return;
    onContextChange?.(data);
    if (scene !== 'mine' && !data.contexts.some(context => context.id === scene)) {
      const next = data.contexts[0]?.id || 'mine';
      setScene(next); onSceneChange?.(next); setSelected(''); setScanOpen(false);
    }
  }, [data, scene, onContextChange, onSceneChange]);
  useEffect(() => {
    sessionStorage.setItem(key, scene);
  }, [key, scene]);
  async function execute(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function resolve(value: string) {
    if (value.startsWith("pioneer:attendance:v1:")) {
      await execute(async () => {
        const preview = await api<{
          campusName: string;
          businessDate: string;
          startsAt: string;
          endsAt: string;
        }>("/api/attendance/preview", {
          method: "POST",
          body: { token: value },
        });
        setScanOpen(false);
        setCheckPreview(preview);
        setCheckToken(value);
      });
      return;
    }
    await execute(async () => {
      const item = await api<{ id: string }>("/api/scan/resolve", {
        method: "POST",
        body: value.includes(".") ? { code: value } : { id: value },
      });
      setScanOpen(false);
      setSelected(item.id);
    });
  }
  async function showAttendance() {
    await execute(async () => {
      const event = await api<{ id: string; revision: number }>(
        "/api/attendance/events",
        {
          method: "POST",
          body: {
            campusId: campus,
            businessDate: data!.businessDate,
            type: "duty",
            requestId: crypto.randomUUID(),
          },
        },
      );
      const credential = await api<{ token: string; expiresAt: string }>(
        `/api/attendance/events/${event.id}/token`,
        { method: "POST", body: { revision: event.revision } },
      );
      setToken(credential);
    });
  }
  function openAttendance(){if(data?.directAttendance?.allowed)void checkIn('');else{setMessage('');setScanOpen(true);}}
  async function checkIn(value: string) {
    await execute(async () => {
      let record;
      try {record=await api<NonNullable<typeof checkResult>>(value?"/api/attendance/check-ins":"/api/attendance/self-check-in", {
        method: "POST",
        body: value?{ token: value, method: "qr", requestId: crypto.randomUUID() }:{campusId:campus,requestId:crypto.randomUUID()},
      });}catch(error){
        const recovered=await api<{items:NonNullable<typeof checkResult>[]}>("/api/me/attendance?businessDate="+(data?.businessDate||initial.businessDate));
        const existing=recovered.items.find(item=>item.type==='duty'&&item.campusId===campus);
        if(!existing)throw error;
        record={...existing,isExisting:true};
      }
      setCheckResult(record);
      setCheckToken("");
      setScanOpen(false);
      setMessage("签到成功，已更新到岗状态");
      await refresh();
    });
  }
  async function presence(state: string) {
    await execute(async () => {
      await api("/api/presence/me", {
        method: "PATCH",
        body: {
          state,
          campusId: data!.presence!.campusId,
          revision: data!.presence!.revision,
        },
      });
      await refresh();
    });
  }
  const items = (data?.appointments || []).filter(
    (item) =>
      (filter === "all" || item.status === filter) &&
      `${item.id} ${item.deviceModel} ${item.faultType}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const people = [...(data?.staffPresence || [])].sort(compareFieldPeople);
  const visiblePeople=people.filter(person=>(!showAvailable||person.canReceive)&&`${person.name} ${person.department||''} ${person.identities?.map(identity=>identity.label).join(' ')||''}`.includes(peopleQuery.trim()));
  const campusName = data?.campuses.find((c) => c.id === campus)?.name || "";
  return (
    <>
      <section className="field-content" aria-busy={result.loading}>
        <WorkspaceHeader group={scene === 'mine' ? '我的' : '今日工作'} title={scene === 'mine' ? '个人中心' : (data?.contexts || initial.contexts).find(c => c.id === scene)?.label || '今日工作'}>
          <div className="field-scope">
            <span>{data?.businessDate || initial.businessDate}</span>
            <label>
              <span className="field-sr-only">工作校区</span>
              <select
                value={campus}
                onChange={(e) => {
                  setCampus(e.target.value);
                  setSelected("");
                  setMessage("");
                }}
              >
                {(data?.campuses || initial.campuses).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}校区
                  </option>
                ))}
              </select>
            </label>
          </div>
        </WorkspaceHeader>
        <Notice>{message || result.error}</Notice>{data?.directAttendance?.allowed&&!data.presence&&scene!=="repair"&&<div className="field-actions"><button className="field-primary" disabled={busy} onClick={openAttendance}>本人到岗签到</button></div>}
        <div className="workspace-update" role="status" aria-live="polite">{result.loading ? "正在更新当前区域…" : ""}</div>
        {!data ? (
          <Empty
            title={result.error ? "暂时无法读取工作台" : "正在读取当日工作"}
          >
            <button onClick={refresh}>重新读取</button>
          </Empty>
        ) : (
          <>
            {!!data.pendingSwapInvitations && workspaceLinks.some(entry => entry.id === 'roster') && <section className="field-roster-todo" aria-label="待响应的换班邀请"><div><strong>{data.pendingSwapInvitations} 份换班邀请等待你确认</strong><p>查看双方的新安排，再决定是否同意。</p></div><button onClick={() => onNavigate('roster-requests')}>查看邀请</button></section>}
            {scene === "repair" && (
              <>
                <section className="field-hero">
                  <div>
                    <div className="field-actions">
                      <Status value={data.state} />
                      <span className="field-muted">{campusName}校区</span>
                      <StaffIdentity identities={data.identities} />
                    </div>
                    <h2>
                      {data.currentRepair
                        ? "继续处理当前设备"
                        : data.state === "unsigned"
                          ? "先签到，再开始今天的工作"
                          : data.state === "away"
                            ? "你当前处于离岗状态"
                            : data.state === "available"
                              ? "准备好接待下一位机主"
                              : "当前暂无可接单任务"}
                    </h2>
                    <p>
                      {data.currentRepair
                        ? `${data.currentRepair.brand} ${data.currentRepair.deviceModel} · ${data.currentRepair.faultType}`
                        : data.reason ||
                          "扫描机主维修码，确认设备信息后开始维修。"}
                    </p>
                  </div>
                  <div className="field-hero-action">
                    {data.currentRepair ? (
                      <button
                        className="field-primary"
                        onClick={() => setSelected(data.currentRepair!.id)}
                      >
                        继续维修
                      </button>
                    ) : data.state === "unsigned" && data.capability['attendance.self'] ? (
                      <button
                        className="field-primary"
                        onClick={openAttendance} disabled={busy}
                      >
                        到岗签到
                      </button>
                    ) : data.state === "away" ? (
                      <button
                        className="field-primary"
                        disabled={busy}
                        onClick={() => presence("available")}
                      >
                        返回岗位
                      </button>
                    ) : data.state === "available" ? (
                      <button
                        className="field-primary"
                        onClick={() => { setMessage(""); setScanOpen(true); }}
                      >
                        扫描维修码
                      </button>
                    ) : (
                      <button onClick={refresh}>刷新工作状态</button>
                    )}
                  </div>
                </section>
                <div className="field-work-grid">
                  <section className="field-card">
                    <div className="field-section-heading">
                      <h2>接待设备</h2>
                      <span>核验后才会建立维修记录</span>
                    </div>
                    <AppointmentLookup active={active && scene==='repair'} disabled={busy} onSelect={resolve}/>
                    <div className="field-actions">
                      <button
                        disabled={data.state !== "available"}
                        onClick={() => { setMessage(""); setScanOpen(true); }}
                      >
                        扫码 / 相册识别
                      </button>
                      {data.capability["onsite.create"] && (
                        <button
                          disabled={data.state !== "available"}
                          onClick={() => setRegistration(true)}
                        >
                          临时维修登记
                        </button>
                      )}
                    </div>
                  </section>
                  <section className="field-card">
                    <h2>{data.identities?.some(identity=>identity.code==='exchange') && !data.permissions['roster.read'] ? '到岗参与维修' : '今日班次'}</h2>
                    {data.todayDuties.length ? (
                      data.todayDuties.map((d) => (
                        <div key={d.id} className="field-shift">
                          <strong>
                            {d.campusName} ·{" "}
                            {d.dutyType === "office" ? "办公接待" : "维修值班"}
                          </strong>
                          <span>
                            {d.startAt}–{d.endAt}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="field-muted">
                        {data.identities?.some(identity=>identity.code==='exchange')
                          ? '交流人员不参与维修排班、填报或换班。到场后扫描工作人员签到码，签到后即可参与维修。'
                          : '今天没有排班。具备资格的成员仍可到场签到。'}
                      </p>
                    )}
                    {data.state === "available" && (
                      <button
                        className="field-text"
                        disabled={busy}
                        onClick={() => presence("away")}
                      >
                        暂时离岗
                      </button>
                    )}
                  </section>
                </div>
              </>
            )}
            {["desk", "operations"].includes(scene) && (
              <>
                <section className="field-overview">
                  <div>
                    <p className="field-muted">
                      {scene === "desk"
                        ? "先找到预约，再安排现场交接"
                        : "关注人员覆盖和正在处理的工单"}
                    </p>
                    <h2>
                      {scene === "desk"
                        ? "让每一位机主有序得到接待"
                        : "今天的现场运行"}
                    </h2>
                  </div>
                  <div className="field-actions">
                    {data.capability["attendance.session.manage"] && (
                      <button disabled={busy} onClick={showAttendance}>
                        展示签到码
                      </button>
                    )}
                    {data.capability["onsite.frontdesk.create"] && (
                      <button
                        className="field-primary"
                        onClick={() => setRegistration(true)}
                      >
                        ＋ 临时登记
                      </button>
                    )}
                  </div>
                </section>
                <div className="field-metrics">
                  {[
                    ["all", "今日预约", (data.appointments || []).length],
                    [
                      "booked",
                      "待接待",
                      (data.appointments || []).filter(
                        (i) => i.status === "booked",
                      ).length,
                    ],
                    [
                      "in_progress",
                      "维修中",
                      (data.appointments || []).filter(
                        (i) => i.status === "in_progress",
                      ).length,
                    ],
                    [
                      "available",
                      "空闲人员",
                      people.filter((p) => p.canReceive).length,
                    ],
                  ].map(([value, label, count]) => (
                    <button
                      key={value}
                      className={
                        filter === value ||
                        (value === "available" && showAvailable)
                          ? "selected"
                          : ""
                      }
                      onClick={() => {
                        if (value === "available") {
                          setShowAvailable(!showAvailable);
                          setTab("people");
                        } else {
                          setFilter(String(value));
                          setTab("appointments");
                        }
                      }}
                    >
                      <span>{label}</span>
                      <strong>{data.appointments ? count : "—"}</strong>
                    </button>
                  ))}
                </div>
                {scene === "operations" &&
                  people.some((p) => p.scheduled && p.state === "unsigned") && (
                    <Notice>
                      有{" "}
                      {
                        people.filter(
                          (p) => p.scheduled && p.state === "unsigned",
                        ).length
                      }{" "}
                      位排班成员尚未签到，请核实到岗情况。
                    </Notice>
                  )}
                <div className="field-mobile-tabs">
                  <button
                    className={tab === "appointments" ? "active" : ""}
                    onClick={() => setTab("appointments")}
                  >
                    预约
                  </button>
                  <button
                    className={tab === "people" ? "active" : ""}
                    onClick={() => setTab("people")}
                  >
                    在岗人员
                  </button>
                </div>
                <div className={`field-desk-grid tab-${tab}`}>
                  <section className="field-card field-appointments">
                    <div className="field-section-heading">
                      <h2>当日预约</h2>
                      <span>{items.length} 条</span>
                    </div>
                    <input
                      className="field-search-input"
                      aria-label="搜索当日预约"
                      placeholder="搜索编号、设备或故障"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <div className="field-filter">
                      {[
                        ["all", "全部"],
                        ["booked", "待接待"],
                        ["in_progress", "维修中"],
                        ["completed", "已完成"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          className={filter === value ? "active" : ""}
                          aria-pressed={filter === value}
                          onClick={() =>
                            setFilter(filter === value ? "all" : value)
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="field-table-head">
                      <span>预约与设备</span>
                      <span>时段</span>
                      <span>状态</span>
                      <span>维修人员</span>
                    </div>
                    {items.map((item) => (
                      <button
                        className="field-order"
                        key={item.id}
                        onClick={() => setSelected(item.id)}
                      >
                        <span>
                          <strong>{item.deviceModel || item.deviceType}</strong>
                          <small>
                            {item.id} · {item.faultType}
                          </small>
                        </span>
                        <span>{item.timeSlot}{item.servicePaused&&<small>当日暂停维修</small>}</span>
                        <Status value={item.status} />
                        <span>{item.assignedToName || "等待接待"}</span>
                      </button>
                    ))}
                    {!data.appointments && result.loading && <div className="workspace-skeleton" aria-label="正在读取预约"><span /><span /><span /></div>}
                    {data.appointments && !items.length && (
                      <Empty title="没有符合条件的预约">
                        可调整筛选条件，或登记现场到访机主。
                      </Empty>
                    )}
                  </section>
                  <section className="field-card field-people">
                    <div className="field-section-heading">
                      <h2>现场人员</h2>
                      <button
                        className="field-text"
                        aria-pressed={showAvailable}
                        onClick={() => setShowAvailable(!showAvailable)}
                      >
                        {showAvailable ? "查看全部" : "只看空闲"}
                      </button>
                    </div>
                    <p className="field-muted field-person-summary">已到岗 {people.filter(person=>person.signedInAt).length} 人 · 维修排班 {people.filter(person=>person.scheduledRepair).length} 人 · 已到岗负责人 {people.filter(person=>person.signedInAt && person.identities?.some(identity=>identity.code==='repair_lead')).length} 人</p>
                    <label className="workspace-search-label">查找现场人员<input type="search" value={peopleQuery} onChange={event=>setPeopleQuery(event.target.value)} placeholder="姓名、部门或身份"/></label>
                    <div className="field-people-list">{visiblePeople
                      .map((person,index,visible) => (
                        <React.Fragment key={person.memberId}>
                        {!showAvailable && fieldPersonGroup(person)==='other' && (index===0 || fieldPersonGroup(visible[index-1])!=='other') && <div className="field-person-divider">其他人员</div>}
                        <div className="field-person">
                          <span className="field-avatar">
                            {person.name.slice(-2)}
                          </span>
                          <div>
                            <strong>{person.name}</strong>
                            <StaffIdentity identities={person.identities} />
                            <small>
                              {person.department || "工作人员"}
                              {!person.scheduled ? " · 非排班到岗" : ""}
                            </small>
                            {person.signedInAt && <small>签到 {time(person.signedInAt)}</small>}
                            {person.currentRepair ? (
                              <button
                                className="field-text"
                                onClick={() =>
                                  setSelected(person.currentRepair!.id)
                                }
                              >
                                {person.currentRepair.deviceModel ||
                                  "查看当前工单"}
                              </button>
                            ) : (
                              <small>{person.reason || "可以接待维修"}</small>
                            )}
                          </div>
                          <Status value={person.state} />
                        </div>
                        </React.Fragment>
                      ))}</div>
                    {people.length>0&&!visiblePeople.length&&<Empty title="没有匹配的现场人员">更换搜索词或切换为查看全部人员。</Empty>}
                    {!data.staffPresence && result.loading && <div className="workspace-skeleton" aria-label="正在读取人员"><span /><span /></div>}
                    {data.staffPresence && !people.length && (
                      <Empty title="暂无现场人员">
                        展示工作人员签到码，成员扫码并确认后记录到岗。
                      </Empty>
                    )}
                  </section>
                </div>
              </>
            )}
            {scene === "mine" && (
              <div className="field-work-grid personal-workspace">
                <section className="field-card personal-schedule">
                  <div className="personal-identity"><span className="field-avatar" aria-hidden="true">{initial.actor.name.slice(-2)}</span><div><h2>{initial.actor.name}</h2><StaffIdentity identities={data.identities} /><p className="field-muted">个人安排与账号</p></div></div>
                  <h3>今日安排</h3>
                  {data.todayDuties.map((d) => (
                    <div className="field-shift" key={d.id}>
                      {d.campusName} · {d.startAt}–{d.endAt}
                    </div>
                  ))}
                  {!data.todayDuties.length && <p className="personal-no-shift">暂无排班安排</p>}
                  <div className="field-actions personal-actions">
                    {workspaceLinks.some(entry => entry.id === "roster") && <button onClick={() => onNavigate("roster")}>
                      我的班次与申请
                    </button>}
                    <button onClick={() => onNavigate("settings")}>
                      账号安全
                    </button>
                    <button
                      onClick={() =>
                        document.getElementById("logout-btn")?.click()
                      }
                    >
                      退出登录
                    </button>
{data.capability["attendance.self"] && <button
                      onClick={openAttendance} disabled={busy}
                      >
                        到岗签到
                    </button>}
                  </div>
                </section>
                {(data.capability["members.manage"] ||
                  data.capability["roles.manage"]) && (
                  <section className="field-card">
                    <h2>平台管理</h2>
                    <p className="field-muted">管理入口使用同一套权限范围</p>
                    <div className="field-actions personal-actions">
                      {data.capability["members.manage"] && (
                        <button onClick={() => onNavigate("members")}>
                          成员管理
                        </button>
                      )}
                      {data.capability["roles.manage"] && (
                        <button onClick={() => onNavigate("permissions")}>
                          角色与授权
                        </button>
                      )}
                    </div>
                  </section>
                )}
              </div>
            )}
            <footer className="field-footer">
              <span>
                更新于 {time(data.updatedAt)} · 页面可见时每 30 秒更新
              </span>
              <button onClick={refresh}>刷新</button>
            </footer>
          </>
        )}
      </section>
      {checkResult&&<Modal title={checkResult.isExisting?'你已完成到岗签到':'到岗签到成功'} compact onClose={()=>setCheckResult(null)}><div className="field-checkin-result"><span className="react-eyebrow">工作人员到岗</span><h2>{initial.actor.name}</h2><StaffIdentity identities={checkResult.identitySnapshot?.identities||data?.identities}/><p>{campusName}校区 · {data?.businessDate}</p><strong>{time(checkResult.occurredAt)}</strong><p className="field-muted">{checkResult.nonScheduled?'非排班到场参与工作':'当天排班已到岗'}{checkResult.isExisting?' · 保留首次签到时间':''}</p><button className="field-primary" onClick={()=>setCheckResult(null)}>返回工作台</button></div></Modal>}
      {scanOpen && (
        <Modal
          title="扫一扫"
          onClose={() => setScanOpen(false)}
        >
          <Scanner onCode={resolve} />
          <Notice>{message}</Notice>
          <p className="field-muted">支持客户维修码和工作人员签到码。识别后先核对信息，再确认接单或签到。</p>
        </Modal>
      )}
      {checkToken && (
        <Modal title="确认到岗签到" compact onClose={() => setCheckToken("")}>
          <p>
            {checkPreview?.campusName}校区 · {checkPreview?.businessDate}
            <br />
            {checkPreview &&
              `${time(checkPreview.startsAt)}–${time(checkPreview.endsAt)}`}
            <br />
            将以 {initial.actor.name} 的账号记录到岗。
          </p>
          <Notice>{message}</Notice>
          <button
            className="field-primary"
            disabled={busy}
            onClick={() => checkIn(checkToken)}
          >
            确认签到
          </button>
        </Modal>
      )}
      {token && (
        <Modal
          title="展示签到码"
          onClose={() => setToken(null)}
        >
          <CredentialCard kind="attendance" code={token.token} context={`${campusName}校区 · ${data?.businessDate || initial.businessDate}`} />
          <p className="field-muted">
            有效至 {time(token.expiresAt)} · 更新签到码后旧码失效
          </p>
          <Notice>{message}</Notice>
          <div className="field-actions">
            <button disabled={busy} onClick={showAttendance}>
              更新签到码
            </button>

          </div>
        </Modal>
      )}
      {selected && (
        <Repair
          sidePanel={scene !== "repair"}
          id={selected}
          key={selected}
          memberId={initial.actor.memberId}
          people={people}
          onClose={() => {
            setSelected("");
            refresh();
          }}
          onChanged={refresh}
        />
      )}
      {registration && (
        <Registration
          campus={campusName}
          frontdesk={scene !== "repair"}
          onClose={() => setRegistration(false)}
          onDone={(id) => {
            setRegistration(false);
            setSelected(id);
            refresh();
            setMessage(
              scene === "repair"
                ? "登记成功，请继续核验接单"
                : "登记成功，请展示维修码交接。关闭详情后可继续登记下一位。",
            );
          }}
        />
      )}
    </>
  );
}
