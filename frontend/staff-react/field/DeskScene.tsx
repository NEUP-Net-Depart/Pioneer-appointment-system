import React from 'react';
import { Empty, Notice, Status, time } from './ui';
import { StaffIdentity } from '../StaffIdentity';
import { fieldPersonGroup } from '../../../shared/staff-identities.js';
import type { useFieldWorkspace } from './useFieldWorkspace';
type Props = Pick<
  ReturnType<typeof useFieldWorkspace> & Parameters<typeof useFieldWorkspace>[0],
  | 'key'
  | 'scene'
  | 'setSelected'
  | 'setRegistration'
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
  scene,
  setSelected,
  setRegistration,
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
  return (
    <>
      <section className="field-overview">
        <div>
          <p className="field-muted">
            {scene === 'desk' ? '先找到预约，再安排现场交接' : '关注人员覆盖和正在处理的工单'}
          </p>
          <h2>{scene === 'desk' ? '让每一位机主有序得到接待' : '今天的现场运行'}</h2>
        </div>
        <div className="field-actions">
          {data.capability['attendance.session.manage'] && (
            <button disabled={busy} onClick={showAttendance}>
              展示签到码
            </button>
          )}
          {data.capability['onsite.frontdesk.create'] && (
            <button className="field-primary" onClick={() => setRegistration(true)}>
              ＋ 临时登记
            </button>
          )}
        </div>
      </section>
      <div className="field-metrics">
        {[
          ['all', '今日预约', (data.appointments || []).length],
          [
            'booked',
            '待接待',
            (data.appointments || []).filter((i) => i.status === 'booked').length
          ],
          [
            'in_progress',
            '维修中',
            (data.appointments || []).filter((i) => i.status === 'in_progress').length
          ],
          ['available', '空闲人员', people.filter((p) => p.canReceive).length]
        ].map(([value, label, count]) => (
          <button
            key={value}
            className={
              filter === value || (value === 'available' && showAvailable) ? 'selected' : ''
            }
            onClick={() => {
              if (value === 'available') {
                setShowAvailable(!showAvailable);
                setTab('people');
              } else {
                setFilter(String(value));
                setTab('appointments');
              }
            }}
          >
            <span>{label}</span>
            <strong>{data.appointments ? count : '—'}</strong>
          </button>
        ))}
      </div>
      {scene === 'operations' && people.some((p) => p.scheduled && p.state === 'unsigned') && (
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
              ['all', '全部'],
              ['booked', '待接待'],
              ['in_progress', '维修中'],
              ['completed', '已完成']
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'active' : ''}
                aria-pressed={filter === value}
                onClick={() => setFilter(filter === value ? 'all' : value)}
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
            <button className="field-order" key={item.id} onClick={() => setSelected(item.id)}>
              <span>
                <strong>{item.deviceModel || item.deviceType}</strong>
                <small>
                  {item.id} · {item.faultType}
                </small>
              </span>
              <span>
                {item.timeSlot}
                {item.servicePaused && <small>当日暂停维修</small>}
              </span>
              <Status value={item.status} />
              <span>{item.assignedToName || '等待接待'}</span>
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
            <button
              className="field-text"
              aria-pressed={showAvailable}
              onClick={() => setShowAvailable(!showAvailable)}
            >
              {showAvailable ? '查看全部' : '只看空闲'}
            </button>
          </div>
          <p className="field-muted field-person-summary">
            已到岗 {people.filter((person) => person.signedInAt).length} 人 · 维修排班{' '}
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
                <div className="field-person">
                  <span className="field-avatar">{person.name.slice(-2)}</span>
                  <div>
                    <strong>{person.name}</strong>
                    <StaffIdentity identities={person.identities} />
                    <small>
                      {person.department || '工作人员'}
                      {!person.scheduled ? ' · 非排班到岗' : ''}
                    </small>
                    {person.signedInAt && <small>签到 {time(person.signedInAt)}</small>}
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
