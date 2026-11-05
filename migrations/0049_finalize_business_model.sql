-- Final v1.2 cleanup. Preserve removed metadata once; runtime uses the single new model.
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-registration-flow-'||id,'repairs.registration.archived',json_object('module','repairs','type','appointment','id',id),
 json_object('registration_flow',registration_flow),'现场登记统一入口，原入口类型仅作历史事实保留',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM appointments;
ALTER TABLE appointments DROP COLUMN registration_flow;
DROP INDEX idx_active_queue;
CREATE INDEX idx_open_appointments ON appointments(date,campus,time_slot,created_at,id) WHERE status IN ('booked','in_progress');

INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-retired-condition-grant-'||id,'authorization.condition.archived',json_object('module','authorization','type','role_grant','id',id),
 json_object('id',id,'role_id',role_id,'permission_code',permission_code,'scope_spec',scope_spec,'condition_spec',condition_spec,'validity_spec',validity_spec,'revision',revision),
 '废止维修与排班准入条件；不将带旧条件的系统授权自动扩权',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM role_grants WHERE permission_code='onsite.frontdesk.create' OR EXISTS(SELECT 1 FROM json_each(condition_spec) WHERE json_extract(value,'$.code') IN ('activeDutyRole','signedDutyPresence','rosterParticipantEligible','repairWorkEligible'));
DELETE FROM role_grants WHERE permission_code='onsite.frontdesk.create' OR EXISTS(SELECT 1 FROM json_each(condition_spec) WHERE json_extract(value,'$.code') IN ('activeDutyRole','signedDutyPresence','rosterParticipantEligible','repairWorkEligible'));
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-permission-definition-'||code,'authorization.definition.archived',json_object('module','authorization','type','permission','id',code),
 json_object('code',code,'module_code',module_code,'name',name,'description',description,'scope_kinds',scope_kinds,'condition_kinds',condition_kinds,'sensitive',sensitive),
 '按有效工作人员、真实任职和校区确定业务权限',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM permission_definitions WHERE code IN ('repair.summary.read','repair.start','repair.receive','repair.finish.own','repair.transfer','repair.correct','customer.identity.read','customer.contact.read','onsite.create','members.manage','statistics.read','roster.read','roster.manage','attendance.self','attendance.session.manage','attendance.correct','attendance.export','onsite.frontdesk.create');
DELETE FROM permission_definitions WHERE code='onsite.frontdesk.create';
UPDATE permission_definitions SET condition_kinds='[]',scope_kinds='["campus"]' WHERE code IN ('repair.summary.read','repair.start','repair.receive','repair.finish.own','repair.transfer','repair.correct','customer.identity.read','customer.contact.read','onsite.create','members.manage','statistics.read','roster.read','roster.manage','attendance.self','attendance.session.manage','attendance.correct','attendance.export');
UPDATE permission_definitions SET description='授权校区内工作人员直接接单' WHERE code='repair.start';
UPDATE permission_definitions SET description='首次接收设备并保存外观照片' WHERE code='repair.receive';
UPDATE permission_definitions SET description='实际收到设备的工作人员确认接手并留下交接历史' WHERE code='repair.transfer';
UPDATE permission_definitions SET description='当前主修结束本次服务并提交结果' WHERE code='repair.finish.own';
UPDATE permission_definitions SET description='结束时主修或授权校区管理人员更正结果并留痕' WHERE code='repair.correct';
UPDATE permission_definitions SET description='读取授权校区内工单及维修历史' WHERE code='repair.summary.read';
UPDATE permission_definitions SET description='单张工单的必要联系方式，访问自动审计' WHERE code='customer.contact.read';
UPDATE permission_definitions SET description='按任职校区范围管理成员资料' WHERE code='members.manage';
INSERT INTO staff_release_markers VALUES('business-model-0049',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
