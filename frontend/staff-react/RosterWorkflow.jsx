import { DataFields } from './DataValue';
import { Modal } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { StaffIdentity } from './StaffIdentity';
import { RequirementEditor } from './StaffingRequirements.jsx';
import { CollectionScope } from './CollectionScope';
import { CollectionSettings } from './CollectionSettings';
import { key, label } from './roster-workflow-shared.js';
import { CollectionComposer } from './CollectionComposer';
import { RosterStage } from './RosterStage';
import { useRosterWorkflow } from './useRosterWorkflow';
import { RosterTaskWorkspace } from './RosterTaskWorkspace';
import { RosterCommandDialog } from './RosterCommandDialog';
import { RosterCandidatePicker } from './RosterCandidatePicker';
import { RosterImport } from './RosterImport';
import './roster.css';
import './roster-workflow.css';
export { RosterStage } from './RosterStage';
export function RosterWorkflow({ user, office = false }) {
  const {
    active,
    canCreate,
    tasks,
    taskId,
    setTaskId,
    data,
    setData,
    rows,
    setRows,
    tasksLoading,
    loading,
    busy,
    dirty,
    setDirty,
    error,
    setError,
    notice,
    setNotice,
    creating,
    setCreating,
    panel,
    setPanel,
    choosing,
    setChoosing,
    query,
    setQuery,
    confirmOverride,
    setConfirmOverride,
    mobileDay,
    setMobileDay,
    reopenDeadline,
    setReopenDeadline,
    requirementsDirty,
    setRequirementsDirty,
    overrideIssues,
    setOverrideIssues,
    overrideReason,
    setOverrideReason,
    extraPeople,
    addedPeople,
    setAddedPeople,
    poolQuery,
    setPoolQuery,
    setView,
    candidatePool,
    setCandidatePool,
    showConflicts,
    setShowConflicts,
    manage,
    task,
    draft,
    editable,
    collecting,
    loadTasks,
    load,
    run,
    openParticipants,
    change,
    members,
    slots,
    names,
    protectedPerson,
    selectedAssignment,
    assign,
    differences,
    unassigned,
    candidateSlots,
    collectionView,
    stage,
    showBoard,
    assignmentCount,
    visibleCandidates
  } = useRosterWorkflow({ user, office });
  return (
    <section className="react-page roster-workflow">
      <WorkspaceHeader group="值班管理" title={office ? '办公排班管理' : '维修排班管理'}>
        {canCreate && (
          <button disabled={busy || dirty || requirementsDirty} onClick={() => setCreating(true)}>
            {office ? '新建办公收集任务' : '新建收集任务'}
          </button>
        )}
      </WorkspaceHeader>
      <div className="roster-range">
        <CollectionScope
          tasks={tasks}
          taskId={taskId}
          onChange={setTaskId}
          management
          disabled={busy || dirty || requirementsDirty}
        />
        <div className="roster-range-actions">
          <button
            disabled={!taskId || busy || dirty || requirementsDirty || loading}
            onClick={async () => {
              try {
                await loadTasks();
                await load(taskId);
              } catch (failure) {
                setError(failure.message);
              }
            }}
          >
            刷新
          </button>
          {task?.actions?.configure && (
            <button
              disabled={dirty || busy || requirementsDirty || loading || !data}
              onClick={() => setPanel('settings')}
            >
              任务设置
            </button>
          )}
        </div>
      </div>
      {task?.collectionIssue && (
        <p data-motion-value="text" role="status" className="react-message">
          {task.collectionIssue}
        </p>
      )}
      {error && (
        <p data-motion-value="text" role="alert" className="react-error">
          {error}
        </p>
      )}
      {notice && (
        <p data-motion-value="text" role="status" className="react-message">
          {notice}
        </p>
      )}
      {!tasksLoading && !taskId && !error && (
        <section className="roster-start">
          <strong data-motion-value="text">{'从发布可用时间收集开始'}</strong>
          {canCreate ? (
            <button className="field-primary" onClick={() => setCreating(true)}>
              {'发布收集任务'}
            </button>
          ) : (
            <p>暂无可配置任务，请联系维修排班负责人发布收集。</p>
          )}
        </section>
      )}
      {(tasksLoading || (taskId && !data && !error)) && (
        <section className="roster-loading" aria-label="本周收集与排班" aria-busy="true">
          <h2>收集与排班</h2>
          <p className="react-muted">
            发布可用时间收集 → 查看填报进度 → 结束收集 → 生成并调整班表 → 检查并发布。
          </p>
          <DataFields fields={[['收集进度'], ['当前班表'], ['发布检查']]} />
        </section>
      )}
      {data && manage && (
        <RosterTaskWorkspace
          office={office}
          active={active}
          taskId={taskId}
          data={data}
          setData={setData}
          rows={rows}
          setRows={setRows}
          busy={busy}
          dirty={dirty}
          setDirty={setDirty}
          setPanel={setPanel}
          setChoosing={setChoosing}
          setQuery={setQuery}
          mobileDay={mobileDay}
          setMobileDay={setMobileDay}
          setReopenDeadline={setReopenDeadline}
          setOverrideIssues={setOverrideIssues}
          setOverrideReason={setOverrideReason}
          poolQuery={poolQuery}
          setPoolQuery={setPoolQuery}
          setView={setView}
          setCandidatePool={setCandidatePool}
          setShowConflicts={setShowConflicts}
          task={task}
          draft={draft}
          editable={editable}
          collecting={collecting}
          run={run}
          members={members}
          slots={slots}
          names={names}
          protectedPerson={protectedPerson}
          assign={assign}
          unassigned={unassigned}
          candidateSlots={candidateSlots}
          collectionView={collectionView}
          stage={stage}
          showBoard={showBoard}
          assignmentCount={assignmentCount}
        />
      )}
      {data && !manage && (
        <section className="roster-start">
          <h2>收集任务设置</h2>
          <p>你可以配置授权校区每日需求。收集、人员安排与发布由维修排班负责人处理。</p>
          <RequirementEditor taskId={taskId} onDirty={setRequirementsDirty} />
        </section>
      )}
      {creating && (
        <CollectionComposer
          office={office}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            loadTasks(id).catch((failure) => setError(failure.message));
            setNotice('收集任务已发布，成员现在可以填报时间。');
          }}
        />
      )}
      {panel === 'participants' && (
        <Modal title="增补参与人员" onClose={() => setPanel('')}>
          <p>
            增补加入当前周。已有填报和班表不会自动改变；需要用于以后各周时，请在每周开放设置中明确应用。
          </p>
          <div className="roster-choice-row">
            {extraPeople.map((person) => (
              <label key={person.memberId}>
                <input
                  type="checkbox"
                  checked={addedPeople.includes(person.memberId)}
                  onChange={() =>
                    setAddedPeople((current) =>
                      current.includes(person.memberId)
                        ? current.filter((id) => id !== person.memberId)
                        : [...current, person.memberId]
                    )
                  }
                />
                {person.name}
                <StaffIdentity identities={person.identities} />
              </label>
            ))}
          </div>
          {!extraPeople.length && <p>当前范围没有其他符合资格的人员。</p>}
          {error && (
            <p data-motion-value="text" role="alert" className="react-error">
              {error}
            </p>
          )}
          <div className="roster-modal-actions">
            <button onClick={() => setPanel('')}>取消</button>
            <button
              className="field-primary"
              disabled={busy || !addedPeople.length}
              onClick={() =>
                run('participants', `/api/roster-tasks/${taskId}/participants`, {
                  revision: task.revision,
                  memberIds: addedPeople
                })
              }
            >
              确认增补
            </button>
          </div>
        </Modal>
      )}
      {panel === 'import' && draft && (
        <RosterImport
          taskId={taskId}
          draft={draft}
          members={members}
          office={office}
          onClose={() => setPanel('')}
          onSaved={() => {
            setPanel('');
            load(taskId);
            setNotice('值班表已导入草稿，请检查问题并发布。');
          }}
        />
      )}
      {panel === 'automation' && data?.series && (
        <Modal title="收集任务设置" onClose={() => setPanel('')}>
          <CollectionSettings
            series={data.series}
            task={task}
            busy={busy}
            error={error}
            onSave={(input) =>
              run('series', `/api/roster-series/${data.series.id}`, input, 'PATCH')
            }
          />
        </Modal>
      )}
      {panel === 'settings' && (
        <Modal
          title="本周人数与参与名单"
          onClose={() => {
            if (!requirementsDirty) setPanel('');
          }}
        >
          <p data-motion-value="text">
            {task.weekStart} · {task.description || '本周可用时间收集'}
          </p>
          <RequirementEditor
            taskId={taskId}
            onDirty={setRequirementsDirty}
            onSaved={() => load(taskId)}
          />
          {requirementsDirty && (
            <p className="react-message">
              有未保存的需求调整。
              <button
                onClick={() => {
                  setRequirementsDirty(false);
                  setPanel('');
                }}
              >
                放弃修改并关闭
              </button>
            </p>
          )}
          {manage && (
            <button disabled={busy || requirementsDirty} onClick={openParticipants}>
              增补参与人员
            </button>
          )}
          {data?.series && (
            <button disabled={busy || requirementsDirty} onClick={() => setPanel('automation')}>
              每周循环收集设置
            </button>
          )}
        </Modal>
      )}
      {['close', 'reopen', 'regenerate', 'publish'].includes(panel) && (
        <RosterCommandDialog
          taskId={taskId}
          data={data}
          rows={rows}
          busy={busy}
          error={error}
          panel={panel}
          setPanel={setPanel}
          reopenDeadline={reopenDeadline}
          setReopenDeadline={setReopenDeadline}
          overrideIssues={overrideIssues}
          setOverrideIssues={setOverrideIssues}
          overrideReason={overrideReason}
          setOverrideReason={setOverrideReason}
          task={task}
          draft={draft}
          run={run}
          names={names}
          differences={differences}
        />
      )}
      {choosing && (
        <RosterCandidatePicker
          office={office}
          rows={rows}
          choosing={choosing}
          setChoosing={setChoosing}
          query={query}
          setQuery={setQuery}
          confirmOverride={confirmOverride}
          setConfirmOverride={setConfirmOverride}
          candidatePool={candidatePool}
          setCandidatePool={setCandidatePool}
          showConflicts={showConflicts}
          setShowConflicts={setShowConflicts}
          change={change}
          members={members}
          slots={slots}
          protectedPerson={protectedPerson}
          selectedAssignment={selectedAssignment}
          assign={assign}
          candidateSlots={candidateSlots}
          assignmentCount={assignmentCount}
          visibleCandidates={visibleCandidates}
        />
      )}
    </section>
  );
}
