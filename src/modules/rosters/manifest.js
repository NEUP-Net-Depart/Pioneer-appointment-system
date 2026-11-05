export const rostersManifest = {
 code:'rosters',version:'2.0.0',contractVersion:'2',requiredSchemaVersion:'0048',releaseState:'ready',
 dependencies:['identity@1','organization@1','authorization@1'],
 permissions:['roster.read','roster.manage'],routes:['/api/rosters','/api/me/availability'],
 navigation:[{id:'rosters',path:'/staff/rosters',title:'排班与可用时间',permission:'roster.read'}],
 attendancePolicies:[],workbenchProviders:[],reports:[],auditActions:['rosters.week.published','rosters.availability.updated','rosters.leave.recorded','rosters.leave.withdrawn','rosters.cover.requested','rosters.cover.responded']
};
