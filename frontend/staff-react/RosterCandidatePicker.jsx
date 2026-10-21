import { Modal } from './field/ui';
import { StaffIdentity } from './StaffIdentity';
import { RosterAssignmentControls, RosterReportedTimes } from './RosterAssignment';
import { key, label } from './roster-workflow-shared.js';
export function RosterCandidatePicker({
  office,
  rows,
  choosing,
  setChoosing,
  query,
  setQuery,
  confirmOverride,
  setConfirmOverride,
  candidatePool,
  setCandidatePool,
  showConflicts,
  setShowConflicts,
  change,
  members,
  slots,
  protectedPerson,
  selectedAssignment,
  assign,
  candidateSlots,
  assignmentCount,
  visibleCandidates
}) {
  return (
    <Modal
      title={
        choosing.supplementFor
          ? '安排补位人员'
          : choosing.memberId
            ? '调整人员安排'
            : `安排 ${label(choosing.slot)}`
      }
      onClose={() => {
        setChoosing(null);
        setConfirmOverride(null);
      }}
    >
      <div className="roster-picker">
        {choosing.supplementFor && (
          <p role="status">
            为 {choosing.supplementFor} 安排补位人员。原请假班次与审批记录会保留，不计入在岗人数。
          </p>
        )}
        {selectedAssignment && (
          <RosterAssignmentControls
            row={selectedAssignment}
            member={members.find((member) => member.memberId === selectedAssignment.memberId)}
            office={office}
            onChange={(updated) =>
              change(rows.map((row) => (row === selectedAssignment ? updated : row)))
            }
            onReplace={() => {
              setConfirmOverride(null);
              setQuery('');
              setCandidatePool('all');
              setShowConflicts(false);
              setChoosing({ slot: selectedAssignment, replaceId: selectedAssignment.memberId });
            }}
            onRemove={() => {
              change(rows.filter((row) => row !== selectedAssignment));
              setConfirmOverride(null);
              setChoosing(null);
            }}
          />
        )}
        <label>
          目标班次
          <select
            aria-label="目标班次"
            disabled={!!choosing.supplementFor}
            value={key(choosing.slot)}
            onChange={(event) => {
              setChoosing((current) => ({
                ...current,
                slot: slots.find((slot) => key(slot) === event.target.value)
              }));
              setConfirmOverride(null);
            }}
          >
            {slots.map((slot) => (
              <option value={key(slot)} key={key(slot)}>
                {label(slot)}
              </option>
            ))}
          </select>
        </label>
        <label>
          查找成员
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入姓名"
          />
        </label>
        {!choosing.memberId && (
          <div className="roster-candidate-filters">
            {!office && (
              <div role="group" aria-label="人员名额">
                {[
                  ['all', '全部'],
                  ['lead', '负责人'],
                  ['ordinary', '普通维修']
                ].map(([value, text]) => (
                  <button
                    key={value}
                    aria-pressed={candidatePool === value}
                    onClick={() => setCandidatePool(value)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
            <label>
              <input
                type="checkbox"
                checked={showConflicts}
                onChange={(event) => setShowConflicts(event.target.checked)}
              />
              显示不可安排人员
            </label>
          </div>
        )}
        <div className="roster-candidates">
          {visibleCandidates.map((member) => {
            const eligible = candidateSlots(member).some(
                (slot) => key(slot) === key(choosing.slot)
              ),
              reported = member.available.some((slot) => key(slot) === key(choosing.slot));
            const same = rows.some(
                (row) => row.memberId === member.memberId && key(row) === key(choosing.slot)
              ),
              protectedMember = rows.some(
                (row) =>
                  row.memberId === member.memberId &&
                  (!office || row.businessDate === choosing.slot.businessDate) &&
                  protectedPerson(row)
              );
            return (
              <article className="roster-candidate" key={member.memberId}>
                <div>
                  <strong>{member.name}</strong>
                  <StaffIdentity identities={member.identities} />
                  <small>
                    {assignmentCount(member)
                      ? `本周已安排 ${assignmentCount(member)} 班`
                      : '本周尚未安排 · 优先'}
                  </small>
                  {rows.some(
                    (row) => row.memberId === member.memberId && key(row) !== key(choosing.slot)
                  ) && (
                    <p>
                      当前安排：
                      {rows
                        .filter((row) => row.memberId === member.memberId)
                        .map(label)
                        .join('、')}
                    </p>
                  )}
                  <RosterReportedTimes windows={member.reportedWindows} title="原填报时间" />
                  <RosterReportedTimes windows={member.existingAssignments} title="已有其他班次" />
                  <span>
                    {!eligible
                      ? '此班次资格、授权或已有安排冲突'
                      : protectedMember
                        ? '原班次已签到或结束'
                        : same
                          ? '已在本班次'
                          : reported
                            ? '可安排'
                            : '未填报此时段 · 可人工安排'}
                  </span>
                </div>
                <button
                  disabled={!eligible || protectedMember || same}
                  onClick={() => assign(member, choosing.slot)}
                >
                  {selectedAssignment
                    ? '移动到本班次'
                    : choosing.replaceId
                      ? '替换此班次'
                      : assignmentCount(member)
                        ? '额外安排'
                        : '添加'}
                </button>
              </article>
            );
          })}
          {!visibleCandidates.length && (
            <p className="roster-empty-slot" role="status">
              当前条件没有可安排的成员。可切换身份、清空姓名或显示不可安排人员查看原因。
            </p>
          )}
        </div>
        {confirmOverride && (
          <section className="roster-override-confirm" role="alert">
            <p>
              {confirmOverride.member.name} 将安排至 {label(confirmOverride.slot)}。
              {confirmOverride.moving.length > 0 && (
                <>原安排 {confirmOverride.moving.map(label).join('、')} 将移除。</>
              )}
              {confirmOverride.replacing && <>将替换 {confirmOverride.replacing}。</>}
              {!confirmOverride.reported && <>此时段未填报可参加，将记录为人工安排，原填报不变。</>}
            </p>
            <button onClick={() => setConfirmOverride(null)}>取消</button>
            <button
              className="field-primary"
              onClick={() => assign(confirmOverride.member, confirmOverride.slot, true)}
            >
              确认人工安排
            </button>
          </section>
        )}
        <div className="roster-modal-actions">
          <button
            className="field-primary"
            onClick={() => {
              setChoosing(null);
              setConfirmOverride(null);
            }}
          >
            完成调整
          </button>
        </div>
      </div>
    </Modal>
  );
}
