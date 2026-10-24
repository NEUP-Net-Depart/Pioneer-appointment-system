import React from 'react';
import { AnimatedValue } from '../AnimatedValue';
import { Empty, Notice, Status, time } from './ui';
import { StaffIdentity } from '../StaffIdentity';
import { fieldPersonGroup } from '../../../shared/staff-identities.js';
import { receptionStatus, queueTicketLabel } from '../../../shared/reception.js';
import type { useFieldWorkspace } from './useFieldWorkspace';
type Props = Pick<
  ReturnType<typeof useFieldWorkspace> & Parameters<typeof useFieldWorkspace>[0],
  | 'key'
  | 'setSelected'
  | 'setRegistration'
  | 'setScanOpen'
  | 'busy'
  | 'filter'
  | 'setFilter'
  | 'search'
  | 'setSearch'
  | 'tab'
  | 'setTab'
  | 'showAvailable'
  | 'setShowAvailable'
  | 'peopleQuery'
  | 'setPeopleQuery'
  | 'result'
  | 'data'
  | 'showAttendance'
  | 'items'
  | 'people'
  | 'visiblePeople'
>;
export function DeskScene({
  key,
  setSelected,
  setRegistration,
  setScanOpen,
  busy,
  filter,
  setFilter,
  search,
  setSearch,
  tab,
  setTab,
  showAvailable,
  setShowAvailable,
  peopleQuery,
  setPeopleQuery,
  result,
  data,
  showAttendance,
  items,
  people,
  visiblePeople
}: Props) {
  const overview = data.overview;
  const orderFilters = [
    {
      value: 'booked',
      label: '未到场',
      hint: '今日尚未接待 / 实际预约',
      count: overview ? overview.notArrived + '/' + overview.total : '—',
      description: '今日预约中尚未完成到场接待的客户。扫描客户维修码，核验设备并补充照片后发号。'
    },
    {
      value: 'queued',
      label: '排队中',
      hint: '已核验 · 含已分派等待确认',
      count: overview?.queued ?? '—',
      description:
        '按到场接待顺序排队。分派后仍在队列，维修人员核对客户、设备与排号并确认后开始维修。'
    },
    {
      value: 'in_progress',
      label: '维修中',
      hint: '已确认接手',
      count: overview?.repairing ?? '—',
      description: '维修人员已接手设备，处理完成后填写结果。负责人可协调转派。'
    }
  ];
  const selectedFilter = orderFilters.find((stage) => stage.value === filter);
  return (
    <>
      <section className="field-overview">
        <div>
          <h2>客户接待与现场协作</h2>
        </div>
        <div className="field-actions">
          {data.capability['repair.receive'] && (
            <button className="field-primary" onClick={() => setScanOpen(true)}>
              扫描客户维修码
            </button>
          )}
          {data.capability['attendance.session.manage'] && (
            <button disabled={busy} onClick={showAttendance}>
              展示签到码
            </button>
          )}
          {data.capability['onsite.frontdesk.create'] && (
            <button onClick={() => setRegistration(true)}>＋ 临时登记</button>
          )}
        </div>
      </section>
      <div className="field-metrics" role="group" aria-label="现场概览">
        {orderFilters.map(({ value, label, hint, count }) => (
          <button
            key={value}
            className={`field-metric-card ${value === 'all' ? 'field-metric-summary' : ''} ${filter === value ? 'selected' : ''}`}
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(filter === value ? 'all' : value);
              setTab('appointments');
            }}
          >
            <span className="field-metric-label">{label}</span>
            <strong>
              <AnimatedValue value={count} />
            </strong>
            <small>{hint}</small>
          </button>
        ))}
        <button
          className={`field-metric-card field-metric-people ${showAvailable ? 'selected' : ''}`}
          aria-pressed={showAvailable}
          onClick={() => {
            setShowAvailable(!showAvailable);
            setTab('people');
          }}
        >
          <span className="field-metric-label">空闲中</span>
          <strong>
            <AnimatedValue
              value={data.staffPresence ? people.filter((person) => person.canReceive).length : '—'}
            />
          </strong>
          <small>已签到且可接单</small>
        </button>
      </div>
      {data.capability['repair.dispatch'] &&
        (data.appointments || []).some((item) => receptionStatus(item) === 'queued') &&
        people.some((person) => person.canReceive) && (
          <div className="reception-next" role="status">
            <span>现场有等待分派的工单，且有空闲维修人员。</span>
            <button
              onClick={() => {
                setFilter('queued');
                setTab('appointments');
              }}
            >
              处理现场队列
            </button>
          </div>
        )}
      {data.capability['repair.transfer'] &&
        people.some((p) => p.scheduled && p.state === 'unsigned') && (
          <Notice>
            有 {people.filter((p) => p.scheduled && p.state === 'unsigned').length}{' '}
            位排班成员尚未签到，请核实到岗情况。
          </Notice>
        )}
      <div className="field-mobile-tabs">
        <button
          className={tab === 'appointments' ? 'active' : ''}
          onClick={() => setTab('appointments')}
        >
          预约
        </button>
        <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>
          在岗人员
        </button>
      </div>
      <div className={`field-desk-grid tab-${tab}`}>
        <section className="field-card field-appointments">
          <div className="field-section-heading">
            <h2>{selectedFilter?.label || '预约与现场队列'}</h2>
            <span>
              {items.length} 条{' '}
              {filter !== 'all' && (
                <button className="field-text" onClick={() => setFilter('all')}>
                  显示全部
                </button>
              )}
            </span>
          </div>
          <p className="field-order-guidance">
            {selectedFilter?.description ||
              '到场核验后发号，按顺序分派；已分派的客户仍需等待维修人员核对确认。'}
          </p>
          <input
            className="field-search-input"
            aria-label="搜索当日预约"
            placeholder="搜索编号、设备或故障"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="field-table-head">
            <span>预约与设备</span>
            <span>时段</span>
            <span>状态</span>
            <span>维修人员</span>
          </div>
          {items.map((item) => (
            <button
              data-motion-item={item.id}
              className="field-order"
              key={item.id}
              onClick={() => setSelected(item.id)}
            >
              <span>
                <strong>
                  {item.reception?.ticket && (
                    <span className="field-queue-number">
                      {queueTicketLabel(item.reception.ticket)} ·{' '}
                    </span>
                  )}
                  {item.deviceModel || item.deviceType}
                </strong>
                <small>
                  {item.id} · {item.faultType}
                </small>
              </span>
              <span>
                {item.timeSlot}
                {item.servicePaused && <small>当日暂停维修</small>}
              </span>
              <Status value={receptionStatus(item)} />
              <span>
                {item.reception?.state === 'assigned'
                  ? item.reception.assignedToName
                  : item.assignedToName ||
                    (item.reception?.leftAt
                      ? '重新到场后排号'
                      : item.reception?.state === 'queued'
                        ? '等待分派'
                        : item.status === 'in_progress'
                          ? '维修处理中'
                          : '—')}
                {item.date < data.businessDate &&
                  item.reception &&
                  ['queued', 'assigned'].includes(item.reception.state) && (
                    <small>跨日待处理 · {item.date}</small>
                  )}
              </span>
            </button>
          ))}
          {!data.appointments && result.loading && (
            <div className="workspace-skeleton" aria-label="正在读取预约">
              <span />
              <span />
              <span />
            </div>
          )}
          {data.appointments && !items.length && (
            <Empty title="没有符合条件的预约">可调整筛选条件，或登记现场到访机主。</Empty>
          )}
        </section>
        <section className="field-card field-people">
          <div className="field-section-heading">
            <h2>现场人员</h2>
          </div>
          <p className="field-muted field-person-summary">
            可接单 {people.filter((person) => person.canReceive).length} 人 · 已到岗{' '}
            {people.filter((person) => person.signedInAt).length} 人 · 维修排班{' '}
            {people.filter((person) => person.scheduledRepair).length} 人 · 已到岗负责人{' '}
            {
              people.filter(
                (person) =>
                  person.signedInAt &&
                  person.identities?.some((identity) => identity.code === 'repair_lead')
              ).length
            }{' '}
            人
          </p>
          <label className="workspace-search-label">
            查找现场人员
            <input
              type="search"
              value={peopleQuery}
              onChange={(event) => setPeopleQuery(event.target.value)}
              placeholder="姓名、部门或身份"
            />
          </label>
          <div className="field-people-list">
            {visiblePeople.map((person, index, visible) => (
              <React.Fragment key={person.memberId}>
                {!showAvailable &&
                  fieldPersonGroup(person) === 'other' &&
                  (index === 0 || fieldPersonGroup(visible[index - 1]) !== 'other') && (
                    <div className="field-person-divider">其他人员</div>
                  )}
                <div data-motion-item={person.memberId} className="field-person">
                  <span className="field-avatar">{person.name.slice(-2)}</span>
                  <div>
                    <strong>{person.name}</strong>
                    <StaffIdentity identities={person.identities} />
                    <small>
                      {person.department || '工作人员'}
                      {!person.scheduled ? ' · 非排班到岗' : ''}
                    </small>
                    {person.signedInAt && <small>签到 {time(person.signedInAt)}</small>}
                    {person.workload && (
                      <small>
                        今日已接 {person.workload.started} · 已完成 {person.workload.completed}
                      </small>
                    )}
                    {person.currentRepair ? (
                      <button
                        className="field-text"
                        onClick={() => setSelected(person.currentRepair!.id)}
                      >
                        {person.currentRepair.deviceModel || '查看当前工单'}
                      </button>
                    ) : (
                      <small>{person.reason || '可以接待维修'}</small>
                    )}
                  </div>
                  <Status value={person.state} />
                </div>
              </React.Fragment>
            ))}
          </div>
          {people.length > 0 && !visiblePeople.length && (
            <Empty title="没有匹配的现场人员">更换搜索词或切换为查看全部人员。</Empty>
          )}
          {!data.staffPresence && result.loading && (
            <div className="workspace-skeleton" aria-label="正在读取人员">
              <span />
              <span />
            </div>
          )}
          {data.staffPresence && !people.length && (
            <Empty title="暂无现场人员">展示工作人员签到码，成员扫码并确认后记录到岗。</Empty>
          )}
        </section>
      </div>
    </>
  );
}
