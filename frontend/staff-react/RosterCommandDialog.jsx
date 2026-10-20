import { Modal } from './field/ui';
import { campuses, key, label, issueLabels } from './roster-workflow-shared.js';
export function RosterCommandDialog({
  taskId,
  data,
  rows,
  busy,
  error,
  panel,
  setPanel,
  reopenDeadline,
  setReopenDeadline,
  overrideIssues,
  setOverrideIssues,
  overrideReason,
  setOverrideReason,
  task,
  draft,
  run,
  names,
  differences
}) {
  return (
    <Modal
      title={
        {
          close: '结束本次收集',
          reopen: '重新开放收集',
          regenerate: '重新生成自动排班',
          publish: '检查并发布班表'
        }[panel]
      }
      onClose={() => {
        if (!busy) setPanel('');
      }}
    >
      <div className="roster-confirm">
        {panel === 'close' && (
          <>
            <p>
              {data.progress.submitted} / {data.progress.total} 人已提交。结束后成员将不能修改填报。
            </p>
            {data.progress.people.filter((item) => !item.submission).length > 0 && (
              <p className="roster-gap">
                尚未提交：
                {data.progress.people
                  .filter((item) => !item.submission)
                  .map((item) => item.name)
                  .join('、')}
              </p>
            )}
          </>
        )}
        {panel === 'reopen' && (
          <>
            <p>保留已填报时间和当前班表。新的提交不会自动改变安排。</p>
            <label>
              新的截止时间
              <input
                type="datetime-local"
                required
                value={reopenDeadline}
                onChange={(event) => setReopenDeadline(event.target.value)}
              />
            </label>
          </>
        )}
        {panel === 'regenerate' && (
          <p>重新计算尚未锁定的安排。锁定的人工安排会保留，原已发布班表继续生效。</p>
        )}
        {panel === 'publish' && (
          <>
            {!draft.validation.valid && (
              <fieldset className="roster-override-confirm">
                <legend>确认业务问题后发布</legend>
                <p>以下问题不影响数据安全，但会影响人员覆盖或排班公平。必须逐项确认并说明原因。</p>
                {draft.validation.errors.map((issue) => (
                  <label className="roster-choice-row" key={issue.id}>
                    <input
                      type="checkbox"
                      checked={overrideIssues.includes(issue.id)}
                      onChange={(event) =>
                        setOverrideIssues((current) =>
                          event.target.checked
                            ? [...current, issue.id]
                            : current.filter((id) => id !== issue.id)
                        )
                      }
                    />
                    {names.get(issue.memberId) || ''} {issueLabels[issue.code] || issue.code}{' '}
                    {issue.slot ? label(issue.slot) : ''}
                  </label>
                ))}
                <label>
                  发布原因
                  <textarea
                    required
                    minLength={2}
                    maxLength={500}
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                  />
                </label>
              </fieldset>
            )}
            <p>
              {task.weekStart} 起 ·{' '}
              {task.campusScope.campusIds.map((id) => campuses[id]).join('、')}
            </p>
            <p>
              {rows.length} 班，{new Set(rows.map((row) => row.memberId)).size}{' '}
              人。以下变化确认后才生效。
            </p>
            <ul className="roster-diff">
              {differences.map(({ row, kind }, i) => (
                <li key={i}>
                  <span>{kind}</span>
                  <strong>{names.get(row.memberId) || '成员'}</strong>
                  <span>{label(row)}</span>
                  {row.manualOverride && <small>人工安排，超出原填报</small>}
                </li>
              ))}
            </ul>
            <p>发布时将再次核对资格、人数、签到和班次冲突。</p>
          </>
        )}
        {error && (
          <p role="alert" className="react-error">
            {error}
          </p>
        )}
        <div className="roster-modal-actions">
          <button disabled={busy} onClick={() => setPanel('')}>
            返回核对
          </button>
          <button
            className="field-primary"
            disabled={
              busy ||
              (panel === 'publish' &&
                !draft.validation.valid &&
                (overrideIssues.length !== draft.validation.errors.length ||
                  overrideReason.trim().length < 2)) ||
              (panel === 'reopen' &&
                (!reopenDeadline || !Number.isFinite(Date.parse(reopenDeadline))))
            }
            onClick={() =>
              panel === 'publish'
                ? run('publish', `/api/rosters/${draft.id}/publish`, {
                    version: draft.version,
                    ...(!draft.validation.valid
                      ? { confirmation: draft.confirmation, overrideIssues, overrideReason }
                      : {})
                  })
                : panel === 'regenerate'
                  ? run('generate', '/api/rosters/generate', { taskId })
                  : run(panel, `/api/roster-tasks/${taskId}/collection`, {
                      action: panel,
                      revision: task.revision,
                      ...(panel === 'reopen'
                        ? { deadline: new Date(reopenDeadline).toISOString() }
                        : {})
                    })
            }
          >
            {
              {
                close: '确认结束收集',
                reopen: '重新开放',
                regenerate: '重新生成',
                publish: '确认发布'
              }[panel]
            }
          </button>
        </div>
      </div>
    </Modal>
  );
}
