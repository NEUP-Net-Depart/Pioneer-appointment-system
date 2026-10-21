export function serviceDayRepository(db) {
  const list=async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
  async function serviceDays(start,end=start) {
    return list('SELECT business_date AS businessDate,campus_id AS campusId,paused,reason,revision FROM service_day_overrides WHERE business_date BETWEEN ? AND ? ORDER BY business_date,campus_id',start,end);
  }
  async function serviceDay(date,campus) {
    return db.prepare('SELECT s.business_date AS businessDate,s.campus_id AS campusId,s.paused,s.reason,s.revision FROM service_day_overrides s JOIN campuses c ON c.id=s.campus_id WHERE s.business_date=? AND (s.campus_id=? OR c.name=?)').bind(date,campus,campus).first();
  }
  async function affectedServiceDay(date,campusId) {
    return list("SELECT a.id,a.date,a.time_slot AS timeSlot,a.status FROM appointments a JOIN campuses c ON c.name=a.campus WHERE c.id=? AND a.date=? AND a.status IN ('booked','in_progress') ORDER BY a.time_slot,a.id",campusId,date);
  }
  async function saveServiceDay(input,actor) {
    const payload=JSON.stringify(input),previous=await db.prepare('SELECT * FROM service_day_receipts WHERE actor_member_id=? AND request_id=?').bind(actor.memberId,input.requestId).first();
    if(previous)return {replay:true,matches:previous.payload===payload,result:JSON.parse(previous.result_json)};
    const marker=crypto.randomUUID(),at=new Date().toISOString(),result={...input,revision:input.revision+1};
    try {await db.batch([
      db.prepare(`INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,after_json,request_id,occurred_at)
        SELECT ?,?,?,'service.day.changed',?,?,?,? WHERE COALESCE((SELECT revision FROM service_day_overrides WHERE business_date=? AND campus_id=?),-1)=?
        AND EXISTS(SELECT 1 FROM staff_accounts WHERE member_id=? AND auth_version=? AND status='enabled')`)
        .bind(marker,actor.memberId,actor.account,JSON.stringify({module:'settings',type:'service-day',id:`${input.businessDate}:${input.campusId}`}),JSON.stringify(result),input.requestId,at,input.businessDate,input.campusId,input.revision,actor.memberId,actor.authVersion),
      db.prepare(`INSERT INTO service_day_overrides(business_date,campus_id,paused,reason,revision,updated_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=?) ON CONFLICT(business_date,campus_id) DO UPDATE SET paused=excluded.paused,reason=excluded.reason,revision=excluded.revision,updated_at=excluded.updated_at`)
        .bind(input.businessDate,input.campusId,input.paused?1:0,input.reason,input.revision+1,at,marker),
      db.prepare('INSERT INTO service_day_receipts(actor_member_id,request_id,payload,result_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=?)').bind(actor.memberId,input.requestId,payload,JSON.stringify(result),marker)
    ]);}catch(error){
      const concurrent=await db.prepare('SELECT payload,result_json FROM service_day_receipts WHERE actor_member_id=? AND request_id=?').bind(actor.memberId,input.requestId).first();
      if(concurrent)return {replay:true,matches:concurrent.payload===payload,result:JSON.parse(concurrent.result_json)};
      throw error;
    }
    const saved=await db.prepare('SELECT payload,result_json FROM service_day_receipts WHERE actor_member_id=? AND request_id=?').bind(actor.memberId,input.requestId).first();
    return saved?{replay:saved.payload!==payload,matches:saved.payload===payload,result:JSON.parse(saved.result_json)}:null;
  }
  async function saveServiceDays(input,actor) {
    const payload=JSON.stringify(input),receipt=()=>db.prepare('SELECT payload,result_json FROM service_day_receipts WHERE actor_member_id=? AND request_id=?').bind(actor.memberId,input.requestId).first();
    const previous=await receipt();
    if(previous)return {matches:previous.payload===payload,result:JSON.parse(previous.result_json)};
    const marker=crypto.randomUUID(),at=new Date().toISOString();
    const result={items:input.items.map(item=>({...item,revision:item.revision+1}))};
    const statements=[db.prepare(`INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,after_json,request_id,occurred_at)
      SELECT ?,?,?,'service.days.changed',?,?,?,? WHERE NOT EXISTS(
        SELECT 1 FROM json_each(?) item WHERE COALESCE((SELECT revision FROM service_day_overrides s
        WHERE s.business_date=json_extract(item.value,'$.businessDate') AND s.campus_id=json_extract(item.value,'$.campusId')),-1)<>json_extract(item.value,'$.revision')
        OR json_extract(item.value,'$.businessDate')<date(?,'+8 hours'))
      AND EXISTS(SELECT 1 FROM staff_accounts a JOIN members m ON m.id=a.member_id
        WHERE a.account=? AND a.member_id=? AND a.auth_version=? AND a.status='enabled' AND m.status='active')`)
      .bind(marker,actor.memberId,actor.account,JSON.stringify({module:'settings',type:'service-days'}),JSON.stringify(result),input.requestId,at,JSON.stringify(input.items),at,actor.account,actor.memberId,actor.authVersion)];
    for(const item of result.items)statements.push(db.prepare(`INSERT INTO service_day_overrides(business_date,campus_id,paused,reason,revision,updated_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=?) ON CONFLICT(business_date,campus_id)
      DO UPDATE SET paused=excluded.paused,reason=excluded.reason,revision=excluded.revision,updated_at=excluded.updated_at`)
      .bind(item.businessDate,item.campusId,+item.paused,item.reason,item.revision,at,marker));
    statements.push(db.prepare('INSERT INTO service_day_receipts(actor_member_id,request_id,payload,result_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM audit_events WHERE id=?)')
      .bind(actor.memberId,input.requestId,payload,JSON.stringify(result),marker));
    try {await db.batch(statements);}catch(error){const saved=await receipt();if(saved)return {matches:saved.payload===payload,result:JSON.parse(saved.result_json)};throw error;}
    const saved=await receipt();return saved && {matches:saved.payload===payload,result:JSON.parse(saved.result_json)};
  }
  return {serviceDays,serviceDay,affectedServiceDay,saveServiceDay,saveServiceDays};
}
