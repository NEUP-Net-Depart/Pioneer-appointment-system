import { fail } from './http.js';
import { account,stringField,campusGrants } from './validation.js';
export function parseWhitelistCsv(input) {
  const csv=stringField(input.csv,'CSV',200000,true).replace(/^\uFEFF/,'');
  const rows=[],row=[];let value='',quoted=false,closed=false;
  for(let n=0;n<csv.length;n++){
    const char=csv[n];
    if(quoted){
      if(char==='"'){if(csv[n+1]==='"'){value+='"';n++;}else{quoted=false;closed=true;}}
      else value+=char;
    }else if(char==='"'){
      if(value || closed)fail(400,'CSV 引号格式不正确');
      quoted=true;
    }else if(char===',' || char==='\n' || char==='\r'){
      row.push(value);value='';closed=false;
      if(char!==','){if(char==='\r' && csv[n+1]==='\n')n++;if(row.some(cell=>cell.trim()))rows.push(row.splice(0));else row.splice(0);}
    }else{
      if(closed)fail(400,'CSV 引号后的内容不正确');
      value+=char;
    }
  }
  if(quoted)fail(400,'CSV 引号未闭合');
  row.push(value);if(row.some(cell=>cell.trim()))rows.push(row);
  const header=rows.shift()?.map(cell=>cell.trim());
  const allowed=['studentId','expectedName','expectedRole','authorizedCampuses'];
  if(!header || !header.includes('studentId') || new Set(header).size!==header.length || header.some(key=>!allowed.includes(key)))fail(400,'CSV 表头应包含 studentId，可选 expectedName、expectedRole、authorizedCampuses');
  if(!rows.length || rows.length>200)fail(400,'CSV 应包含 1 至 200 条学号');
  const seen=new Set();
  return rows.map((cells,index)=>{
    if(cells.length!==header.length)fail(400,`CSV 第 ${index+2} 行列数不正确`);
    const item=Object.fromEntries(header.map((key,n)=>[key,cells[n].trim()]));
    const studentId=account(item.studentId),expectedRole=item.expectedRole || input.expectedRole || 'technician';
    if(!/^\d{6,20}$/.test(studentId) || seen.has(studentId))fail(400,`CSV 第 ${index+2} 行学号无效或重复`);
    if(!['technician','admin'].includes(expectedRole))fail(400,`CSV 第 ${index+2} 行角色无效`);
    seen.add(studentId);
    return {studentId,expectedRole,expectedName:stringField(item.expectedName,'名册姓名',80),authorizedCampuses:campusGrants(item.authorizedCampuses ? item.authorizedCampuses.split('|').map(value=>value.trim()) : input.authorizedCampuses)};
  });
}
