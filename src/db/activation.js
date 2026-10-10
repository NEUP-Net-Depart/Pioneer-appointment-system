const whitelistSelect=`SELECT w.*,(SELECT json_group_array(campus) FROM whitelist_campus_grants WHERE student_id=w.student_id) AS campuses FROM staff_whitelist w`;
const requestSelect=`SELECT r.*,w.expected_role,w.expected_name,w.status AS whitelist_status,w.revision AS whitelist_revision,
  (SELECT json_group_array(campus) FROM whitelist_campus_grants WHERE student_id=r.student_id) AS campuses
  FROM activation_requests r JOIN staff_whitelist w ON w.student_id=r.student_id`;
function whitelist(row){
  return row ? {studentId:row.student_id,expectedName:row.expected_name,expectedRole:row.expected_role,status:row.status,authorizedCampuses:JSON.parse(row.campuses),revision:row.revision,createdAt:row.created_at} : null;
}
function application(row){
  return row ? {id:row.id,studentId:row.student_id,name:row.name,homeCampus:row.home_campus,contact:row.contact,
    status:row.status,reviewNote:row.review_note,reviewedBy:row.reviewed_by,reviewedAt:row.reviewed_at,createdAt:row.created_at,
    expectedRole:row.expected_role,expectedName:row.expected_name,authorizedCampuses:JSON.parse(row.campuses),
    whitelistStatus:row.whitelist_status,whitelistRevision:row.whitelist_revision} : null;
}
export function activationRepository(db){
  return {
    async findWhitelist(id){return whitelist(await db.prepare(`${whitelistSelect} WHERE w.student_id=?`).bind(id).first());},
    async listWhitelist(){return (await db.prepare(`${whitelistSelect} ORDER BY w.created_at DESC,w.student_id`).all()).results.map(whitelist);},
    async importWhitelist(items,actor,instant){
      await db.batch(items.flatMap(item=>[
        db.prepare('INSERT INTO staff_whitelist(student_id,expected_name,expected_role,created_by,created_at) VALUES (?,?,?,?,?)')
          .bind(item.studentId,item.expectedName,item.expectedRole,actor,instant),
        ...item.authorizedCampuses.map(campus=>db.prepare('INSERT INTO whitelist_campus_grants VALUES (?,?)').bind(item.studentId,campus))
      ]));
    },
    async changeWhitelist(target,status,actor,instant){
      const statements=[];
      if(status==='revoked')statements.push(db.prepare(`UPDATE activation_requests SET status='rejected',password_hash='',review_note='白名单资格已撤销',reviewed_by=?,reviewed_at=?
        WHERE student_id=? AND status='pending' AND EXISTS(SELECT 1 FROM staff_whitelist WHERE student_id=? AND revision=?)`)
        .bind(actor,instant,target.studentId,target.studentId,target.revision));
      statements.push(db.prepare("UPDATE staff_whitelist SET status=?,revision=revision+1 WHERE student_id=? AND revision=? AND status<>'activated' RETURNING student_id")
        .bind(status,target.studentId,target.revision));
      const results=await db.batch(statements);return results.at(-1).results.length>0;
    },
    async submit(input,whitelistRevision){
      const row=await db.prepare(`INSERT INTO activation_requests(id,student_id,name,home_campus,contact,password_hash,receipt_hash,created_at)
        SELECT ?,?,?,?,?,?,?,? FROM staff_whitelist w WHERE student_id=? AND status='open' AND revision=?
        AND NOT EXISTS(SELECT 1 FROM staff_accounts WHERE account=w.student_id) RETURNING id`)
        .bind(input.id,input.studentId,input.name,input.homeCampus,input.contact,input.passwordHash,input.receiptHash,input.createdAt,input.studentId,whitelistRevision).first();
      return row?.id;
    },
    async publicStatus(id,receiptHash){
      return db.prepare('SELECT id,status,review_note AS reviewNote,reviewed_at AS reviewedAt FROM activation_requests WHERE id=? AND receipt_hash=?').bind(id,receiptHash).first();
    },
    async findRequest(id){return application(await db.prepare(`${requestSelect} WHERE r.id=?`).bind(id).first());},
    async listRequests(){return (await db.prepare(`${requestSelect} ORDER BY r.created_at DESC,r.id`).all()).results.map(application);},
    async review(items,status,note,actor,instant){
      const results=await db.batch(items.map(item=>db.prepare(`UPDATE activation_requests
        SET status=?,review_note=?,reviewed_by=?,reviewed_at=?,password_hash=CASE WHEN ?='rejected' THEN '' ELSE password_hash END
        WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM staff_whitelist WHERE student_id=? AND revision=?)
        RETURNING id`).bind(status,note,actor,instant,status,item.id,item.studentId,item.whitelistRevision)));
      return {applied:results.flatMap(result=>result.results.map(row=>row.id)),conflicts:items.filter((_,n)=>!results[n].results.length).map(item=>item.id)};
    }
  };
}
