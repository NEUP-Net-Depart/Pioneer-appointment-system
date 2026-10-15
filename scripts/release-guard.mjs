const uuid=/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export const STAFF_BRANCH='next/staff-platform';
export const STAFF_PROJECT='pioneer-staff-staging';
export function validateStaffConfig(base,staff){
  validateRemoteConfig(base);
  const db=staff.d1_databases?.filter(item=>item.binding==='DB'),r2=staff.r2_buckets?.filter(item=>item.binding==='ATTACHMENTS');
  if(staff.name!==STAFF_PROJECT || db?.length!==1 || r2?.length!==1 || !uuid.test(db[0].database_id) || db[0].database_id.startsWith('00000000-') || db[0].database_name!=='pioneer-appointments-staff-staging' || r2[0].bucket_name!=='pioneer-attachments-staff-staging')throw new Error('Configure the dedicated Staff Staging Pages, DB and ATTACHMENTS resources.');
  for(const target of [base,base.env.preview]){
    if(staff.name===base.name || db[0].database_id===target.d1_databases[0].database_id || db[0].database_name===target.d1_databases[0].database_name || r2[0].bucket_name===target.r2_buckets[0].bucket_name)throw new Error('Staff Staging must be isolated from Production and Preview.');
  }
  if(staff.compatibility_date!==base.compatibility_date || JSON.stringify(staff.compatibility_flags)!==JSON.stringify(base.compatibility_flags) || JSON.stringify(staff.limits)!==JSON.stringify(base.limits))throw new Error('Staff Staging must retain the existing Cloudflare compatibility and limits.');
  if(db[0].migrations_dir!=='database/staff-migrations' || !/^\d+$/.test(staff.vars?.MAX_R2_BYTES || '') || Number(staff.vars.MAX_R2_BYTES)<=0)throw new Error('Configure Staff Staging migrations and attachment quota.');
  return staff;
}
export function validateRemoteConfig(cfg){
  if(!cfg.name || !cfg.env?.preview)throw new Error('Configure the existing Pages project and an independent Preview environment.');
  const targets=[cfg,cfg.env.preview].map(bindings=>{
    const databases=bindings.d1_databases?.filter(item=>item.binding==='DB') || [];
    const buckets=bindings.r2_buckets?.filter(item=>item.binding==='ATTACHMENTS') || [];
    if(databases.length!==1 || buckets.length!==1)throw new Error('Each environment requires exactly one DB and ATTACHMENTS binding.');
    if(!uuid.test(databases[0].database_id) || databases[0].database_id.startsWith('00000000-'))throw new Error('Set the real D1 database_id before remote operations.');
    if(!databases[0].database_name || !buckets[0].bucket_name)throw new Error('Set D1 and private R2 resource names.');
    return {database:databases[0],bucket:buckets[0]};
  });
  if(targets[0].database.database_id===targets[1].database.database_id || targets[0].bucket.bucket_name===targets[1].bucket.bucket_name)throw new Error('Preview must use a separate D1 database and R2 bucket.');
  return cfg;
}
export function requireRemoteApproval({preview=false,staffStaging=false,execute=false,approval}={}){
  if(preview && staffStaging)throw new Error('Choose one deployment target.');
  const target=staffStaging ? 'staff-staging' : preview ? 'preview' : 'production';
  if(approval && approval!==target)throw new Error('Approval must match the target environment.');
  if(execute && approval!==target)throw new Error(`Remote execution requires --execute --approve-${target} after explicit human authorization.`);
  if(!execute && approval)throw new Error('An approval flag requires --execute.');
  return execute;
}
export function remoteOptions(args){
  const allowed=['--preview','--staff-staging','--execute','--approve-preview','--approve-production','--approve-staff-staging'];
  if(args.some(arg=>!allowed.includes(arg)) || new Set(args).size!==args.length)throw new Error('Use --preview or --staff-staging, --execute and one matching --approve-<target> flag.');
  const approvals=args.filter(arg=>arg.startsWith('--approve-'));
  if(approvals.length>1)throw new Error('Choose exactly one target approval.');
  const result={preview:args.includes('--preview'),staffStaging:args.includes('--staff-staging'),execute:args.includes('--execute'),approval:approvals[0]?.slice('--approve-'.length)};
  requireRemoteApproval(result);return result;
}
