import { campusId } from './scopes.js';
import { dateKey, validDate } from '../../platform/time.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const string = { type: 'string', minLength: 1 };
const strings = { type: 'array', items: string, minItems: 1 };
const schema = properties => ({ type: 'object', properties, additionalProperties: false });

function matchesSchema(value, definition) {
  if (definition.type === 'object') return object(value) && Object.entries(value).every(([key, item]) =>
    Object.hasOwn(definition.properties, key) && matchesSchema(item, definition.properties[key]));
  if (definition.type === 'string') return typeof value === 'string' && value.trim().length >= (definition.minLength || 0);
  if (definition.type === 'array') return Array.isArray(value) && value.length >= (definition.minItems || 0) && value.every(item => matchesSchema(item, definition.items));
  if (definition.type === 'boolean') return typeof value === 'boolean';
  return false;
}

export function validCondition(condition, providers) {
  if (!object(condition) || typeof condition.code !== 'string') return false;
  const provider = Object.hasOwn(providers, condition.code) ? providers[condition.code] : null;
  return !!provider && typeof provider.check === 'function' && (condition.version === undefined || condition.version === provider.version) &&
    object(condition.parameters ?? {}) && (!provider.parameterSchema || matchesSchema(condition.parameters ?? {}, provider.parameterSchema));
}

function activeOn(item, context) {
  const day = context?.businessDate || dateKey();
  return item.active !== false && (!item.businessDate || item.businessDate === day) &&
    (!item.effectiveFrom || validDate(item.effectiveFrom) && item.effectiveFrom <= day) &&
    (!item.effectiveTo || validDate(item.effectiveTo) && day < item.effectiveTo);
}

export function conditionProviders() {
  return {
    ownResource: {
      code: 'ownResource', version: 1, description: '资源归属于当前成员', parameterSchema: schema({}),
      check: ({ actor, resource }) => !!actor?.memberId && actor.memberId === (resource?.memberId || resource?.assignedMemberId)
    },
    activeDutyRole: {
      code: 'activeDutyRole', version: 1, description: '当前成员在业务日期拥有有效岗位',
      parameterSchema: schema({ kind: string, roleKinds: strings, dutyType: string }),
      check: ({ context, resource, parameters = {} }) => {
        if (resource?.businessDate && resource.businessDate !== context?.businessDate) return false;
        const duties = context?.todayDuties || [];
        return duties.some(duty => activeOn(duty, context) &&
          (!resource?.campusId || !!(duty.campusId || duty.campusName) && campusId(duty.campusId || duty.campusName) === campusId(resource.campusId)) &&
          (!parameters.kind || parameters.kind === duty.roleKind) && (!parameters.roleKinds || parameters.roleKinds.includes(duty.roleKind)) &&
          (!parameters.dutyType || duty.dutyType === parameters.dutyType));
      }
    },
    signedDutyPresence: {
      code: 'signedDutyPresence', version: 1, description: '当天已在目标校区签到', parameterSchema: schema({}),
      check: ({ context, resource }) => !!context?.presence && context.presence.businessDate === context.businessDate &&
        !!resource?.campusId && campusId(context.presence.campusId) === campusId(resource.campusId)
    },
    activeDepartmentMembership: {
      code: 'activeDepartmentMembership', version: 1, description: '当前成员在业务日期具有有效任职',
      parameterSchema: schema({ departmentId: string, departmentIds: strings, assignmentType: string, isPrimary: { type: 'boolean' } }),
      check: ({ context, resource, parameters = {} }) => {
        const departments = parameters.departmentIds || (parameters.departmentId ? [parameters.departmentId] :
          resource?.departmentIds || (resource?.departmentId ? [resource.departmentId] : []));
        return (context?.memberships || []).some(item => activeOn(item, context) &&
          (!departments.length || departments.includes(item.departmentId)) &&
          (!parameters.departmentId || parameters.departmentId === item.departmentId) &&
          (!parameters.assignmentType || parameters.assignmentType === item.assignmentType) &&
          (parameters.isPrimary === undefined || parameters.isPrimary === item.isPrimary));
      }
    },
    repairWorkEligible: {
      code: 'repairWorkEligible', version: 1, description: '成员具备维修工作资格', parameterSchema: schema({}),
      check: ({ context }) => (context?.workProfiles || []).some(item => activeOn(item, context) && ['repair', 'exchange'].includes(item.profileCode))
    },
    rosterParticipantEligible: {
      code:'rosterParticipantEligible',version:1,description:'普通维修或办公排班资格',parameterSchema:schema({}),
      check:({context}) => (context?.workProfiles || []).some(item=>activeOn(item,context) && item.profileCode==='office') ||
        (context?.workProfiles || []).some(item=>activeOn(item,context) && item.profileCode==='repair') &&
        !(context?.workProfiles || []).some(item=>activeOn(item,context) && item.profileCode==='exchange')
    },
    attendanceEligible: {
      code: 'attendanceEligible', version: 1, description: '成员可参加该签到场次', parameterSchema: schema({}),
      check: ({ context }) => context?.attendanceEligible !== false
    },
    meetingParticipant: {
      code: 'meetingParticipant', version: 1, description: '成员在发布参会名单中', parameterSchema: schema({}),
      check: ({ context }) => context?.meetingParticipant === true
    },
    meetingOrganizer: {
      code: 'meetingOrganizer', version: 1, description: '成员是会议管理人或获授权负责人', parameterSchema: schema({}),
      check: ({ context }) => context?.meetingOrganizer === true
    }
  };
}
