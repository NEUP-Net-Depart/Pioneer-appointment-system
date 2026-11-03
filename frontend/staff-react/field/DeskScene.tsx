import { DataValue } from '../DataValue';
import React, { useState } from 'react';
import { AnimatedValue } from '../AnimatedValue';
import { Empty, Status } from './ui';
import { StaffIdentity } from '../StaffIdentity';
import { AppointmentLookup } from './AppointmentLookup';
import { fieldPersonGroup } from '../../../shared/staff-identities.js';
import { receptionStatus, queueTicketLabel } from '../../../shared/reception.js';
import type { useFieldWorkspace } from './useFieldWorkspace';
type Props = Pick<
  ReturnType<typeof useFieldWorkspace> & Parameters<typeof useFieldWorkspace>[0],
  | 'key'
  | 'active'
  | 'setSelected'
  | 'setRegistration'
  | 'setScanOpen'
  | 'busy'
  | 'filter'
  | 'setFilter'
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
  active,
  setSelected,
  setRegistration,
  setScanOpen,
  busy,
  filter,
  setFilter,
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
  const [searchActive, setSearchActive] = useState(false);
  const overview = data.overview;
  const orderFilters = [
    {
      value: 'booked',
      label: '未到场',
      count: overview?.notArrived ?? '—'
    },
    { value: 'queued', label: '排队中', count: overview?.queued ?? '—' },
    { value: 'in_progress', label: '维修中', count: overview?.repairing ?? '—' }
  ];
  const selectedFilter = orderFilters.find((stage) => stage.value === filter);
  return (
    <>
      <section className="field-overview" aria-label="现场操作">
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
        {orderFilters.map(({ value, label, count }) => (
          <button
            key={value}
            className={`field-metric-card ${tab === 'appointments' && filter === value ? 'selected' : ''}`}
            aria-pressed={tab === 'appointments' && filter === value}
            onClick={() => {
              setFilter(tab === 'appointments' && filter === value ? 'all' : value);
              setTab('appointments');
            }}
          >
            <span data-motion-value="text" className="field-metric-label">
              {label}
            </span>
            <strong>
              <AnimatedValue value={count} />
            </strong>
          </button>
        ))}
        <button
          className={`field-metric-card field-metric-people ${tab === 'people' && showAvailable ? 'selected' : ''}`}
          aria-pressed={tab === 'people' && showAvailable}
          onClick={() => {
            setShowAvailable(tab === 'people' ? !showAvailable : true);
            setTab('people');
          }}
        >
          <span className="field-metric-label">可接单</span>
          <strong>
            <AnimatedValue
              value={data.staffPresence ? people.filter((person) => person.canReceive).length : '—'}
            />
          </strong>
        </button>
      </div>
      <div className="field-desk-alerts">
        {data.capability['repair.dispatch'] &&
          (data.appointments || []).some((item) => receptionStatus(item) === 'queued') &&
          people.some((person) => person.canReceive) && (
            <div className="reception-next" role="status">
              <span>有工单待分派</span>
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
            <div className="reception-next">
              <span>
                {people.filter((p) => p.scheduled && p.state === 'unsigned').length} 人待签到
              </span>
              <button
                onClick={() => {
                  setTab('people');
                  setShowAvailable(false);
                  setPeopleQuery('');
                }}
              >
                查看到岗
              </button>
            </div>
          )}
      </div>
      <div className="field-mobile-tabs">
        <button
          className={tab === 'appointments' ? 'active' : ''}
          aria-pressed={tab === 'appointments'}
          onClick={() => setTab('appointments')}
        >
          预约
        </button>
        <button
          className={tab === 'people' ? 'active' : ''}
          aria-pressed={tab === 'people'}
          onClick={() => setTab('people')}
        >
          在岗人员
        </button>
      </div>
      <div className={`field-desk-grid tab-${tab}`}>
        <section className="field-card field-appointments">
          <div className="field-queue-tools">
            <div className="field-section-heading">
              <h2 data-motion-value="text">{selectedFilter?.label || '预约与现场队列'}</h2>
              <span data-motion-value="number">
                {items.length} 条{' '}
                {filter !== 'all' && (
                  <button className="field-text" onClick={() => setFilter('all')}>
                    显示全部
                  </button>
                )}
              </span>
            </div>
            <AppointmentLookup
              active={active}
              disabled={busy}
              onSelect={setSelected}
              onChange={setSearch}
              onSearchActivityChange={setSearchActive}
              label="搜索当日预约"
              inputRole="textbox"
              hasLocalMatches={items.length > 0}
              campusId={data.campusId}
              searchCapabilities={data.searchCapabilities}
            />
          </div>
          <div className="field-table-head">
            <span>预约与设备</span>
            <span>时段</span>
            <span>状态</span>
            <span>维修人员</span>
            <span>操作</span>
          </div>
          {items.map((item) => {
            const carriedOver =
              item.date < data.businessDate &&
              item.reception &&
              ['queued', 'assigned'].includes(item.reception.state);
            const assignee =
              item.reception?.state === 'assigned'
                ? item.reception.assignedToName
                : item.assignedToName ||
                  (item.reception?.leftAt
                    ? '重新到场后排号'
                    : item.reception?.state === 'queued'
                      ? '等待分派'
                      : item.status === 'in_progress'
                        ? '维修处理中'
                        : '');
            return (
              <button
                data-motion-item={item.id}
                className="field-order"
                key={item.id}
                onClick={() => setSelected(item.id)}
              >
                <span>
                  <strong data-motion-value="text">
                    {item.reception?.ticket && (
                      <span data-motion-value="text" className="field-queue-number">
                        {queueTicketLabel(item.reception.ticket)} ·{' '}
                      </span>
                    )}
                    {item.deviceModel || item.deviceType}
                    {item.registrationFlow === 'repair_followup' && (
                      <span className="field-followup-badge">返修</span>
                    )}
                  </strong>
                  <small data-motion-value="text">
                    {item.id} · {item.faultType}
                  </small>
                </span>
                <span data-motion-value="text">
                  {item.timeSlot}
                  {item.servicePaused && <small>当日暂停维修</small>}
                </span>
                <Status value={receptionStatus(item)} />
                <span
                  data-motion-value="text"
                  className="field-order-assignee"
                  data-empty={!assignee && !carriedOver}
                >
                  {assignee || '—'}
                  {carriedOver && <small data-motion-value="text">跨日待处理 · {item.date}</small>}
                </span>
                <span className="field-order-action">
                  {receptionStatus(item) === 'booked' && data.capability['repair.receive']
                    ? '核验到场'
                    : receptionStatus(item) === 'queued' && data.capability['repair.dispatch']
                      ? '分派维修'
                      : item.status === 'in_progress'
                        ? '查看维修'
                        : '查看详情'}
                  <span aria-hidden="true"> →</span>
                </span>
              </button>
            );
          })}
          {!data.appointments && result.loading && <DataValue label="今日预约" />}
          {data.appointments && !items.length && !searchActive && (
            <Empty title="没有符合条件的预约" />
          )}
        </section>
        <section className="field-card field-people">
          <div className="field-section-heading">
            <h2>{showAvailable ? '可接单人员' : '现场人员'}</h2>
            {showAvailable && (
              <button className="field-text" onClick={() => setShowAvailable(false)}>
                显示全部人员
              </button>
            )}
          </div>
          <div className="field-person-summary">
            <span>
              已到岗{' '}
              <DataValue label="已到岗人数" pending={result.loading}>
                {data.staffPresence
                  ? people.filter((person) => person.signedInAt).length
                  : undefined}
              </DataValue>
            </span>
            <span>
              维修排班{' '}
              <DataValue label="维修排班人数" pending={result.loading}>
                {data.staffPresence
                  ? people.filter((person) => person.scheduledRepair).length
                  : undefined}
              </DataValue>
            </span>
          </div>
          <input
            type="search"
            className="field-search-input field-people-search"
            aria-label="查找现场人员"
            value={peopleQuery}
            onChange={(event) => setPeopleQuery(event.target.value)}
            placeholder="查找姓名、部门或身份"
          />
          <div className="field-people-list">
            {visiblePeople.map((person, index, visible) => {
              const reason = person.reason?.replace(
                /^(?:请先完成该校区到岗签到|请先返回岗位)(?: · |$)/,
                ''
              );
              return (
                <React.Fragment key={person.memberId}>
                  {!showAvailable &&
                    fieldPersonGroup(person) === 'other' &&
                    (index === 0 || fieldPersonGroup(visible[index - 1]) !== 'other') && (
                      <div className="field-person-divider">其他人员</div>
                    )}
                  <div data-motion-item={person.memberId} className="field-person">
                    <span data-motion-value="text" className="field-avatar">
                      {person.name.slice(-2)}
                    </span>
                    <div>
                      <div className="field-person-heading">
                        <strong data-motion-value="text">{person.name}</strong>
                        <Status value={person.state} />
                      </div>
                      <StaffIdentity identities={person.identities} />
                      {(person.department || (!person.scheduled && person.signedInAt)) && (
                        <small data-motion-value="text">
                          {[
                            person.department,
                            !person.scheduled && person.signedInAt ? '非排班到岗' : ''
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      )}
                      {person.workload &&
                        (person.workload.started > 0 || person.workload.completed > 0) && (
                          <small data-motion-value="number">
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
                        reason && <small data-motion-value="text">{reason}</small>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          {people.length > 0 && !visiblePeople.length && <Empty title="没有匹配的现场人员" />}
          {!data.staffPresence && result.loading && <DataValue label="现场人员" />}
          {data.staffPresence && !people.length && <Empty title="暂无现场人员" />}
        </section>
      </div>
    </>
  );
}
