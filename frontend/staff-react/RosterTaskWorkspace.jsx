import { WorkspaceMoreActions } from './WorkspaceMoreActions';
import { StaffIdentity } from './StaffIdentity';
import { RosterAssignment } from './RosterAssignment';
import { addDays, dateKey } from '../../shared/time.js';
import { campuses, days, key, label, issueLabels } from './roster-workflow-shared.js';
import { RosterStage } from './RosterStage';
export function RosterTaskWorkspace({
  office,
  active,
  taskId,
  data,
  setData,
  rows,
  setRows,
  busy,
  dirty,
  setDirty,
  setPanel,
  setChoosing,
  setQuery,
  mobileDay,
  setMobileDay,
  setReopenDeadline,
  setOverrideIssues,
  setOverrideReason,
  poolQuery,
  setPoolQuery,
  setView,
  setCandidatePool,
  setShowConflicts,
  task,
  draft,
  editable,
  collecting,
  run,
  members,
  slots,
  names,
  protectedPerson,
  assign,
  unassigned,
  candidateSlots,
  collectionView,
  stage,
  showBoard,
  assignmentCount
}) {
  return (
    <>
      <div className="roster-view-tabs" role="tablist" aria-label="本周工作内容">
        <button
          role="tab"
          aria-selected={collectionView}
          onClick={() => setView('collection')}
          disabled={dirty || busy}
        >
          收集进度
        </button>
        <button
          role="tab"
          aria-selected={!collectionView}
          onClick={() => setView('roster')}
          disabled={busy || !draft}
        >
          班表与调整
        </button>
        {!draft && <span>结束收集并自动排班后，在这里调整班表</span>}
      </div>
      <>
        {data.allSuspended && (
          <p className="react-message" role="status">
            本周所有服务日暂停，无需安排值班。可结束收集；已有记录保留。
          </p>
        )}
      </>
      <RosterStage office={office} stage={stage} />
      <section className="roster-next">
        <div>
          <span className="react-eyebrow">
            {task.weekStart} 起 · {task.slotStart}–{task.slotEnd}
          </span>
          <h2>
            {
              {
                scheduled: '本周收集尚未开放',
                collecting: '正在收集可用时间',
                ready: '收集已结束，可以自动排班',
                adjusting: '核对并调整班表',
                revising: '正在修订已发布班表',
                published: '班表已发布'
              }[stage]
            }
          </h2>
          <p>
            {stage === 'scheduled'
              ? `将于 ${new Date(task.collectionOpensAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 开放本周填报。`
              : collecting && collectionView
                ? `${data.progress.submitted} / ${data.progress.total} 人已提交 · 截止 ${new Date(task.deadline).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
                : stage === 'published'
                  ? '成员正在使用当前班表。修改时先建立修订稿，确认后再发布。'
                  : dirty
                    ? '有未保存调整，请先保存并校验。'
                    : data.publishedVersion
                      ? '原班表继续生效，修订发布后才会替换。'
                      : '完成覆盖和资格检查后，成员才能看到班次。'}
          </p>
        </div>
        <div>
          {collecting && collectionView && (
            <button
              className="field-primary"
              disabled={busy || dirty}
              onClick={() => setPanel('close')}
            >
              结束收集
            </button>
          )}
          {stage === 'ready' && (
            <button
              className="field-primary"
              disabled={busy || data.requiresRuleConfirmation}
              onClick={() => run('generate', '/api/rosters/generate', { taskId })}
            >
              {'生成自动排班'}
            </button>
          )}
          {stage === 'published' && (
            <button
              className="field-primary"
              disabled={busy}
              onClick={() =>
                run('revise', `/api/roster-tasks/${taskId}/revision`, {
                  publishedVersionId: data.publishedVersion.id
                })
              }
            >
              调整已发布班表
            </button>
          )}
          {editable && !collectionView && dirty && (
            <span className="roster-edit-hint">调整尚未保存</span>
          )}
        </div>
      </section>
      {collectionView && (
        <section className="roster-collection">
          <div className="roster-section-title">
            <h2>收集情况</h2>
            <span>填报人数反映已提交，不代表一定可覆盖全部班次</span>
          </div>
          <progress
            max={Math.max(1, data.progress.total)}
            value={data.progress.submitted}
            aria-label="填报进度"
          />
          <div className="roster-coverage">
            {data.progress.coverage.map((slot) => (
              <article key={key(slot)}>
                <strong>{label(slot)}</strong>
                {!office && <span>负责人可用 {slot.leads} / 需 1 名</span>}
                <span>
                  {office ? '办公' : '普通'}人员可用 {slot.ordinary} / {office ? '目标' : '最低'}{' '}
                  {slot.ordinaryMinimum ?? 1} 名
                </span>
              </article>
            ))}
          </div>
          <details>
            <summary>
              查看成员填报情况 · {data.progress.total - data.progress.submitted} 人未提交
            </summary>
            <ul className="roster-progress-people">
              {data.progress.people.map((person) => (
                <li key={person.memberId}>
                  <strong>{person.name}</strong>
                  <span>
                    {!person.active
                      ? '资格或账号已变化'
                      : !person.submission
                        ? '尚未提交'
                        : person.submission.unavailable
                          ? '整周无法参加'
                          : '已提交可用时间'}
                  </span>
                </li>
              ))}
            </ul>
          </details>
          {data.publishedVersion && <p className="react-muted">此次重新收集不改变当前有效班表。</p>}
        </section>
      )}
      {!collecting && stage !== 'scheduled' && (
        <div className="roster-secondary-actions">
          <WorkspaceMoreActions label="收集与排班操作">
            <button
              disabled={busy || dirty}
              onClick={() => {
                setReopenDeadline(`${addDays(dateKey(), 1)}T18:00`);
                setPanel('reopen');
              }}
            >
              重新开放收集
            </button>
            {editable && (
              <button disabled={busy || dirty} onClick={() => setPanel('regenerate')}>
                重新自动排班
              </button>
            )}
          </WorkspaceMoreActions>
        </div>
      )}
      {showBoard && (
        <>
          <div className="roster-board-heading">
            <h2>{editable ? '班表草稿' : '当前有效班表'}</h2>
            <span>
              {rows.length} 班 · {new Set(rows.map((row) => row.memberId)).size} 人
            </span>
            {dirty && (
              <button
                onClick={() => {
                  setRows(draft.assignments);
                  setDirty(false);
                }}
              >
                撤销未保存调整
              </button>
            )}
          </div>
          {rows.some((row) => row.servicePaused) && (
            <section className="roster-paused-history">
              <h3>暂停日期 · 原安排保留</h3>
              <p className="react-muted">暂停日不再安排新人员，已有班次与请假记录保留。</p>
              <ul>
                {rows
                  .filter((row) => row.servicePaused)
                  .map((row) => (
                    <li key={`${row.memberId}:${key(row)}`}>
                      <strong>{row.memberName || names.get(row.memberId) || '成员'}</strong>
                      <span>{label(row)}</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
          <div className="roster-mobile-days" aria-label="选择值班日期">
            {days.map((day, i) => (
              <button key={day} aria-pressed={mobileDay === i} onClick={() => setMobileDay(i)}>
                {day}
                <small>{addDays(task.weekStart, i).slice(5)}</small>
              </button>
            ))}
          </div>
          <div className="roster-board-layout" inert={busy || undefined} aria-busy={busy}>
            <div className="roster-campus-boards">
              {[...new Set(slots.map((slot) => slot.campusId))].map((campusId) => (
                <section className="roster-campus-board" key={campusId}>
                  <h3>{campuses[campusId]}</h3>
                  <div className="roster-week-columns">
                    {slots
                      .filter((slot) => slot.campusId === campusId)
                      .map((slot) => {
                        const index = Math.round(
                          (Date.parse(slot.businessDate) - Date.parse(task.weekStart)) / 86400000
                        );
                        const assigned = rows.filter((row) => key(row) === key(slot)),
                          effective = assigned.filter((row) => row.leaveStatus !== 'approved');
                        const leads = effective.filter(
                            (row) => row.roleKind === 'repair_lead'
                          ).length,
                          ordinary = effective.length - leads;
                        return (
                          <article
                            className="roster-day-column"
                            data-visible={mobileDay === index}
                            key={key(slot)}
                            onDragOver={(event) => {
                              if (editable) event.preventDefault();
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const member = members.find(
                                (item) => item.memberId === event.dataTransfer.getData('text/plain')
                              );
                              if (
                                member &&
                                candidateSlots(member).some((item) => key(item) === key(slot))
                              )
                                assign(member, slot);
                            }}
                          >
                            <header>
                              <strong>{days[index]}</strong>
                              <span>{slot.businessDate.slice(5)}</span>
                            </header>
                            <p className="roster-coverage-caption">
                              {office
                                ? `已排 ${effective.length} / 目标 ${slot.ordinaryMinimum ?? 1} 人`
                                : `负责人 ${leads}/1 · 普通 ${ordinary}/${slot.ordinaryMinimum ?? 1}`}
                            </p>
                            {!office && (leads !== 1 || ordinary < (slot.ordinaryMinimum ?? 1)) && (
                              <span className="roster-gap">
                                {leads !== 1 ? '负责人需处理' : '普通人员缺额'}
                              </span>
                            )}
                            {(office
                              ? [{ title: '办公人员', items: assigned }]
                              : [
                                  {
                                    title: '值班负责人',
                                    items: assigned.filter((row) => row.roleKind === 'repair_lead')
                                  },
                                  {
                                    title: '普通维修人员',
                                    items: assigned.filter((row) => row.roleKind !== 'repair_lead')
                                  }
                                ]
                            ).map((group) => (
                              <section className="roster-role-group" key={group.title}>
                                <h4>
                                  {group.title}
                                  <span>{group.items.length} 人</span>
                                </h4>
                                <ul>
                                  {group.items.map((row) => (
                                    <RosterAssignment
                                      key={row.memberId}
                                      row={row}
                                      member={members.find(
                                        (item) => item.memberId === row.memberId
                                      )}
                                      editable={editable}
                                      protectedRow={protectedPerson(row)}
                                      onEdit={() => {
                                        setQuery('');
                                        setCandidatePool('all');
                                        setShowConflicts(false);
                                        setChoosing(
                                          row.leaveStatus === 'approved'
                                            ? {
                                                slot,
                                                supplementFor: names.get(row.memberId) || '请假成员'
                                              }
                                            : {
                                                slot,
                                                memberId: row.memberId,
                                                sourceKey: key(row)
                                              }
                                        );
                                      }}
                                    />
                                  ))}
                                </ul>
                                {!group.items.length && (
                                  <p className="roster-empty-slot">尚未安排</p>
                                )}
                              </section>
                            ))}
                            {editable && (
                              <button
                                className="roster-add-person"
                                disabled={busy}
                                onClick={() => {
                                  setQuery('');
                                  setCandidatePool('all');
                                  setShowConflicts(false);
                                  setChoosing({ slot });
                                }}
                              >
                                添加{office ? '办公' : '维修'}人员
                              </button>
                            )}
                          </article>
                        );
                      })}
                  </div>
                </section>
              ))}
            </div>
            <aside className="roster-unassigned">
              <h3>{office ? '人员班次数' : '尚未安排'}</h3>
              <p className="react-muted">
                {office
                  ? '同一成员每日最多一班。'
                  : '负责人可以本周不排班。普通人员未安排的问题需在发布前处理。'}
              </p>
              <label className="workspace-search-label">
                查找待安排人员
                <input
                  type="search"
                  value={poolQuery}
                  onChange={(event) => setPoolQuery(event.target.value)}
                  placeholder="输入姓名"
                />
              </label>
              <div className="roster-pool-list">
                {(office
                  ? [...members].sort(
                      (a, b) =>
                        assignmentCount(a) - assignmentCount(b) ||
                        a.name.localeCompare(b.name, 'zh-CN')
                    )
                  : unassigned
                )
                  .filter((member) => member.name.includes(poolQuery.trim()))
                  .map((member) => (
                    <div
                      className="roster-unassigned-person"
                      key={member.memberId}
                      draggable={editable}
                      onDragStart={(event) =>
                        event.dataTransfer.setData('text/plain', member.memberId)
                      }
                    >
                      <strong>{member.name}</strong>
                      <StaffIdentity identities={member.identities} />
                      <small>
                        {office
                          ? `本周已排 ${rows.filter((row) => row.memberId === member.memberId).length} 班 · `
                          : ''}
                        {member.available.length ? '已填报可参加时间' : '暂无完整班次填报'}
                      </small>
                      {editable && (
                        <button
                          onClick={() => {
                            setQuery('');
                            setCandidatePool('all');
                            setShowConflicts(false);
                            setChoosing({ memberId: member.memberId, slot: slots[0] });
                          }}
                        >
                          安排到日期
                        </button>
                      )}
                    </div>
                  ))}
              </div>
              {!(office ? members : unassigned).length && (
                <p className="react-muted">本周参与人员均已安排。</p>
              )}
            </aside>
          </div>
          {draft.sourceChanged && !dirty && (
            <p role="status" className="react-message">
              任务或人员数据已变化。请核对安排后保存并重新校验。
              <button onClick={() => setDirty(true)}>核对当前班表</button>
            </p>
          )}
          {!!draft.validation.errors.length && !dirty && (
            <section className="roster-issues">
              <h3>发布前需要处理</h3>
              <ul>
                {draft.validation.errors.map((issue, i) => (
                  <li key={i}>
                    <span>
                      {names.get(issue.memberId) || ''} {issueLabels[issue.code] || '安排需要核对'}{' '}
                      {issue.slot ? label(issue.slot) : ''}
                    </span>
                    {editable && (
                      <button
                        onClick={() => {
                          setQuery('');
                          setCandidatePool('all');
                          setShowConflicts(true);
                          setChoosing(
                            issue.slot
                              ? { slot: issue.slot }
                              : issue.memberId
                                ? {
                                    memberId: issue.memberId,
                                    slot:
                                      slots.find((slot) =>
                                        rows.some(
                                          (row) =>
                                            row.memberId === issue.memberId &&
                                            key(row) === key(slot)
                                        )
                                      ) || slots[0]
                                  }
                                : { slot: slots[0] }
                          );
                        }}
                      >
                        处理此问题
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {editable && (
            <div className="roster-editbar">
              <div>
                <strong>
                  {dirty
                    ? '有未保存的调整'
                    : draft.validation.valid
                      ? '班表检查通过'
                      : '先处理下方检查问题'}
                </strong>
                <span>当前有效班表会保留到新版本发布</span>
              </div>
              <div>
                {dirty && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      setRows(draft.assignments);
                      setDirty(false);
                    }}
                  >
                    撤销本次修改
                  </button>
                )}
                {dirty ? (
                  <button
                    className="field-primary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        'save',
                        `/api/rosters/${draft.id}`,
                        { version: draft.version, assignments: rows },
                        'PATCH'
                      )
                    }
                  >
                    保存并校验
                  </button>
                ) : (
                  <button
                    className="field-primary"
                    disabled={busy || draft.validation.blocking || draft.sourceChanged}
                    onClick={() => {
                      setOverrideIssues([]);
                      setOverrideReason('');
                      setPanel('publish');
                    }}
                  >
                    检查并发布
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
