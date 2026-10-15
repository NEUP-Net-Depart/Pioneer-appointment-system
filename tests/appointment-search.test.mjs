import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppointmentSearch, APPOINTMENT_SEARCH_LIMIT } from '../shared/appointment-search.js';
import { appointmentAccessRules, matchesAppointmentAccess } from '../src/lib/appointment-access.js';
import { requireAppointmentAccess } from '../src/services/permissions.js';
import { statusLabels } from '../shared/constants.js';

test('shared search parser distinguishes tail fragments from cross-date numbers', () => {
  for (const value of ['', '-01', '10--01', 'test01', '01%', '1'.repeat(81), null]) assert.equal(parseAppointmentSearch(value), null);
  assert.equal(parseAppointmentSearch('0').ready, false);
  assert.deepEqual(parseAppointmentSearch('01'), {text:'01', acrossDates:false, ready:true});
  for (const value of ['1015-01', 'reserve1015-01', ' REVERSE1015-01 ']) assert.deepEqual(parseAppointmentSearch(value), {text:'1015-01', acrossDates:true, ready:true});
  assert.equal(parseAppointmentSearch('1015-').ready, true);
  assert.ok(APPOINTMENT_SEARCH_LIMIT > 0);
});

test('candidate policy and detail authorization agree across roles, states and ownership', () => {
  for (const role of ['technician','admin','superadmin']) {
    const actor = { role, status:'enabled', account:'100001', authorizedCampuses:['南湖'] };
    for (const status of Object.keys(statusLabels)) for (const source of ['booking','onsite']) for (const assignedTo of ['',actor.account,'100002']) for (const registeredBy of ['',actor.account,'100002']) {
      const item = { campus:'南湖', status, source, assignedTo, registeredBy };
      const allowed = matchesAppointmentAccess(item, appointmentAccessRules(actor, {start:true}));
      if (allowed) assert.doesNotThrow(() => requireAppointmentAccess(actor,item,{start:true}));
      else assert.throws(() => requireAppointmentAccess(actor,item,{start:true}));
      assert.throws(() => requireAppointmentAccess(actor,{...item,campus:'浑南'},{start:true}));
    }
  }
});
