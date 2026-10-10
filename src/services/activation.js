import { fail } from '../lib/http.js';
import { account,stringField,passwordInput } from '../lib/validation.js';
import { CAMPUSES,roleLevel } from '../../shared/constants.js';
import { nowIso } from '../../shared/time.js';
import { parseWhitelistCsv } from '../lib/whitelist-csv.js';
import { hashPassword } from '../lib/passwords.js';
import { issueAccessToken,hashAccessToken } from '../lib/access-tokens.js';
import { encryptText,decryptText } from '../lib/privacy.js';
import { requireRole,requireGrantScope } from './permissions.js';

function manageable(actor,item){
  requireGrantScope(actor,item.authorizedCampuses);
  if(roleLevel[item.expectedRole]>=roleLevel[actor.role])fail(403,'不能管理与自身同级或更高的激活资格');
}
function inScope(actor,item){
  return roleLevel[item.expectedRole]<roleLevel[actor.role] && item.authorizedCampuses.length>0 && item.authorizedCampuses.every(campus=>actor.authorizedCampuses.includes(campus));
}
export function activationService(repository,users,key){
  return {
    async import(input,actor){
      requireRole(actor,'admin');
      const items=parseWhitelistCsv(input),fresh=[],skipped=[];
      const [staff,whitelist]=await Promise.all([users.list(),repository.listWhitelist()]);
      const existing=new Set([...staff.map(item=>item.account),...whitelist.map(item=>item.studentId)]);
      for(const item of items){
        manageable(actor,item);
        if(existing.has(item.studentId))skipped.push(item.studentId);
        else fresh.push(item);
      }
      if(fresh.length)await repository.importWhitelist(fresh,actor.account,nowIso());
      return {imported:fresh.map(item=>item.studentId),skipped};
    },
    async whitelist(actor){
      requireRole(actor,'admin');
      return {items:(await repository.listWhitelist()).filter(item=>inScope(actor,item))};
    },
    async changeWhitelist(id,input,actor){
      const item=await repository.findWhitelist(id);
      if(!item)fail(404,'白名单不存在');
      manageable(actor,item);
      if(!['open','revoked'].includes(input.status))fail(400,'资格状态不正确');
      if(item.status==='activated')fail(409,'已激活账号请在账号列表中管理');
      if(!await repository.changeWhitelist(item,input.status,actor.account,nowIso()))fail(409,'白名单已更新，请刷新');
      return {ok:true};
    },
    async submit(input){
      const studentId=account(input.studentId),name=stringField(input.name,'姓名',80,true),contact=stringField(input.contact,'核验联系方式',120,true);
      if(!/^\d{6,20}$/.test(studentId) || name.length<2 || !CAMPUSES.includes(input.homeCampus))fail(400,'学号、姓名或所属校区不正确');
      const password=passwordInput(input.password);
      const whitelist=await repository.findWhitelist(studentId);
      if(!whitelist || whitelist.status!=='open' || (whitelist.expectedName && whitelist.expectedName!==name) || await users.find(studentId))fail(400,'当前资料无法提交激活申请，请联系管理员核实');
      const receipt=issueAccessToken(),id=crypto.randomUUID();
      if(!await repository.submit({id,studentId,name,homeCampus:input.homeCampus,contact:encryptText(contact,key),passwordHash:hashPassword(password),receiptHash:receipt.hash,createdAt:nowIso()},whitelist.revision))fail(409,'资格已更新，请联系管理员');
      return {id,receipt:receipt.token,status:'pending'};
    },
    async status(id,receipt){
      if(typeof receipt!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(receipt))fail(404,'申请不存在或回执无效');
      const item=await repository.publicStatus(id,hashAccessToken(receipt));
      if(!item)fail(404,'申请不存在或回执无效');
      return item;
    },
    async requests(actor){
      requireRole(actor,'admin');
      return {items:(await repository.listRequests()).filter(item=>inScope(actor,item)).map(item=>({...item,contact:decryptText(item.contact,key)}))};
    },
    async review(input,actor){
      requireRole(actor,'admin');
      const ids=input.ids,status=input.status,note=stringField(input.reviewNote,'审核说明',300,true);
      if(!Array.isArray(ids) || !ids.length || ids.length>100 || new Set(ids).size!==ids.length || ids.some(id=>typeof id!=='string' || id.length>40) || !['approved','rejected'].includes(status))fail(400,'审核申请或状态不正确');
      if(status==='approved' && (input.identityVerified!==true || note.length<8))fail(400,'审批前必须逐人核验身份，并填写至少 8 字的说明');
      const items=[];
      for(const id of ids){
        const item=await repository.findRequest(id);
        if(!item)fail(404,'申请不存在');
        manageable(actor,item);
        if(item.status!=='pending' || (status==='approved' && item.whitelistStatus!=='open'))fail(409,'申请或资格已更新，请刷新');
        items.push(item);
      }
      const result=await repository.review(items,status,note,actor.account,nowIso());
      if(!result.applied.length)fail(409,'申请已被其他管理员处理，请刷新');
      return result;
    }
  };
}
