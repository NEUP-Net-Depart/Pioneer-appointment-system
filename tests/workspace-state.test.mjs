import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setWorkspaceSession,
  clearWorkspaceState,
  readWorkspaceState,
  writeWorkspaceState,
  subscribeWorkspaceSession,
  workspaceSessionVersion,
  workspaceQueryVersion,
  invalidateWorkspaceQueries
} from '../frontend/staff-react/workspace-state.js';

test('query caches survive the same session but disappear before account or permission subscribers run', () => {
  clearWorkspaceState();
  setWorkspaceSession('member:1:permissions-a');
  const version = workspaceSessionVersion();
  const query = new Map([['/api/members', { data: { items: [{ memberId: 'private' }] } }]]);
  writeWorkspaceState('query:/api/members', query);
  let notifications = 0;
  const unsubscribe = subscribeWorkspaceSession(() => {
    notifications++;
    assert.equal(readWorkspaceState('query:/api/members'), undefined);
  });
  try {
    setWorkspaceSession('member:1:permissions-a');
    assert.equal(readWorkspaceState('query:/api/members'), query);
    assert.equal(workspaceSessionVersion(), version);
    assert.equal(notifications, 0);
    const queryVersion = workspaceQueryVersion();
    invalidateWorkspaceQueries();
    assert.equal(workspaceQueryVersion(), queryVersion + 1);
    assert.equal(readWorkspaceState('query:/api/members'), query);
    assert.equal(query.get('/api/members').stale, true);
    setWorkspaceSession('member:1:permissions-b');
    assert.equal(workspaceSessionVersion(), version + 1);
    assert.equal(notifications, 1);
    writeWorkspaceState('query:/api/members', query);
    clearWorkspaceState();
    assert.equal(notifications, 2);
  } finally {
    unsubscribe();
    clearWorkspaceState();
  }
});
