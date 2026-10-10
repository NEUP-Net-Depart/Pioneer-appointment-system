const uuid=/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
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
export function requireRemoteApproval({preview=false,execute=false,approval}={}){
  const target=preview ? 'preview' : 'production';
  if(approval && approval!==target)throw new Error('Approval must match the target environment.');
  if(execute && approval!==target)throw new Error(`Remote execution requires --execute --approve-${target} after explicit human authorization.`);
  if(!execute && approval)throw new Error('An approval flag requires --execute.');
  return execute;
}
export function remoteOptions(args){
  const allowed=['--preview','--execute','--approve-preview','--approve-production'];
  if(args.some(arg=>!allowed.includes(arg)) || new Set(args).size!==args.length)throw new Error('Use --preview, --execute and one matching --approve-preview/--approve-production flag.');
  const approvals=args.filter(arg=>arg.startsWith('--approve-'));
  if(approvals.length>1)throw new Error('Choose exactly one target approval.');
  const result={preview:args.includes('--preview'),execute:args.includes('--execute'),approval:approvals[0]?.slice('--approve-'.length)};
  requireRemoteApproval(result);return result;
}
