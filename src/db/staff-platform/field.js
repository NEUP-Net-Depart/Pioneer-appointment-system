import { dateKey } from '../../platform/time.js';
import { parseJson } from '../../platform/contracts.js';
import { membersDomain } from './members.js';
import { rows } from './shared.js';

export function fieldDomain({ db, event }) {
  async function busyRepairMembers() {
    return rows(
      await db
        .prepare(
          "SELECT DISTINCT s.member_id AS memberId FROM appointments a JOIN staff_accounts s ON s.account=a.assigned_to WHERE a.status='in_progress'"
        )
        .all()
    );
  }
  async function listCampuses(includeDisabled = false) {
    const result = await db
      .prepare(
        `SELECT * FROM campuses ${includeDisabled ? '' : 'WHERE enabled=1'} ORDER BY name,id`
      )
      .all();
    return rows(result).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      enabled: !!row.enabled,
      revision: row.revision
    }));
  }

  async function listDepartments(includeDisabled = false) {
    const result = await db
      .prepare(
        `SELECT * FROM departments ${includeDisabled ? '' : 'WHERE enabled=1'} ORDER BY name,id`
      )
      .all();
    return rows(result).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      ...(row.kind ? { kind: row.kind, stationCode: row.station_code } : {}),
      enabled: !!row.enabled,
      revision: row.revision
    }));
  }

  async function listLocations(campusId = '', includeDisabled = false) {
    const conditions = [],
      args = [];
    if (campusId) {
      conditions.push('l.campus_id=?');
      args.push(campusId);
    }
    if (!includeDisabled) conditions.push('l.enabled=1');
    const result = await db
      .prepare(
        `SELECT l.*,c.name AS campus_name FROM locations l JOIN campuses c ON c.id=l.campus_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY c.name,l.name,l.id`
      )
      .bind(...args)
      .all();
    return rows(result).map((row) => ({
      id: row.id,
      campusId: row.campus_id,
      campusName: row.campus_name,
      code: row.code,
      name: row.name,
      enabled: !!row.enabled,
      revision: row.revision
    }));
  }

  async function dutyEvent(businessDate, campusId) {
    return event(
      await db
        .prepare(
          "SELECT * FROM attendance_events WHERE type='duty' AND business_date=? AND campus_id=? ORDER BY created_at LIMIT 1"
        )
        .bind(businessDate, campusId)
        .first()
    );
  }

  async function latestIntake(id) {
    const row = await db
      .prepare(
        'SELECT verification_json FROM repair_intake_records WHERE appointment_id=? ORDER BY verified_at DESC,rowid DESC LIMIT 1'
      )
      .bind(id)
      .first();
    return parseJson(row?.verification_json, null);
  }

  async function fieldContexts(memberIds, day) {
    const contexts = new Map(),
      reader = membersDomain({ db });
    for (const id of memberIds) {
      const account = await reader.accountForMember(id);
      if (account)
        contexts.set(id, await reader.authorizationContext({ account: account.account }, day));
      else {
        const member = await reader.memberRow(id);
        if (member)
          contexts.set(id, {
            actor: { memberId: id, status: 'disabled', authorizedCampuses: [] },
            memberships: await reader.memberships(id, day),
            grants: [],
            todayDuties: [],
            businessDate: day,
            authorizationDate: dateKey()
          });
      }
    }
    return contexts;
  }
  return {
    listCampuses,
    listDepartments,
    listLocations,
    dutyEvent,
    latestIntake,
    fieldContexts,
    busyRepairMembers
  };
}
