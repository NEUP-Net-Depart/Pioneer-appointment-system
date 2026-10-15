// Shared form options and validation; colleges are independent of campus.
export const COLLEGE_SOURCE = 'https://neu.edu.cn/zzjg.htm';
export const COLLEGE_BRANCH_SOURCE = 'https://www.neuq.edu.cn/xxgk1/zzjg.htm';
export const COLLEGES = [
  '文法学院','马克思主义学院','外国语学院','艺术学院','工商管理学院','理学院',
  '资源与土木工程学院','冶金学院','材料科学与工程学院','机械工程与自动化学院',
  '信息科学与工程学院','计算机科学与工程学院','软件学院','医学与生物信息工程学院',
  '生命科学与健康学院','江河建筑学院','机器人科学与工程学院','未来技术学院',
  '国家卓越工程师学院','国防教育学院','继续教育学院','国际教育学院',
  '悉尼智能科技学院','民族教育学院','创新创业学院','佛山研究生创新学院',
  '经济学院','管理学院','计算机与通信工程学院','控制工程学院','外国语言文化学院',
  '数学与统计学院','资源与材料学院','民族学学院','智能感知与光电工程学院'
];
export const BRANDS = [
  { value: '联想', label: '联想 Lenovo', source: 'https://www.lenovo.com.cn/' },
  { value: '华硕', label: '华硕 ASUS', source: 'https://www.asus.com.cn/laptops/for-home/all-series/' },
  { value: '惠普', label: '惠普 HP', source: 'https://www.hp.com/cn-zh/laptops-and-2-in-1s.html' },
  { value: '机械革命', label: '机械革命 MECHREVO' },
  { value: '荣耀', label: '荣耀 HONOR' },
  { value: '小米', label: '小米 Xiaomi' },
  { value: 'Apple', label: '苹果 Apple', source: 'https://www.apple.com.cn/mac/' },
  { value: '宏碁', label: '宏碁 Acer' },
  { value: 'Dell', label: '戴尔 Dell', source: 'https://www.dell.com/zh-cn/' }
];
export const STUDENT_DEVICE_TYPES = ['笔记本','台式机','其他'];
export const FAULT_TYPES = ['清灰换硅脂','换硬盘','换内存','系统问题','蓝屏','黑屏','网络问题','其他'];
export const ANSWERS = ['是','否','不清楚'];
export const FAULT_HINTS = {
  '清灰换硅脂': '我们免费提供普通硅脂，也可自行携带。',
  '换硬盘': '更换硬盘所需配件请自行准备；不确定兼容性可在故障描述中说明。',
  '换内存': '更换内存所需配件请自行准备；不确定兼容性可在故障描述中说明。'
};
export const AGREEMENT_VERSION = 'v1.1';
export const STUDENT_FIELD_LIMITS = Object.freeze({
  name:20,studentId:20,college:50,brand:30,deviceModel:60,email:254,qqAccount:12,wechatAccount:20,issue:1000
});
export const characterCount = text => [...String(text || '')].length;

export function studentFieldErrors(data) {
  const errors = {};
  const text = (key, label, limit, required = false) => {
    const value = data[key];
    if (value === undefined && !required) return;
    if (required && (typeof value !== 'string' || !value.trim())) errors[key] = `请输入${label}`;
    else if (typeof value !== 'string' || characterCount(value) > limit) errors[key] = `请检查${label}`;
  };
  for (const [key,label,limit,required] of [
    ['name','姓名',STUDENT_FIELD_LIMITS.name,true],['studentId','学号',STUDENT_FIELD_LIMITS.studentId,true],['college','学院',STUDENT_FIELD_LIMITS.college,true],
    ['brand','品牌',STUDENT_FIELD_LIMITS.brand,true],['deviceModel','设备型号',STUDENT_FIELD_LIMITS.deviceModel,false],['email','邮箱',STUDENT_FIELD_LIMITS.email,false],
    ['contactValue',data.contactType==='qq' ? 'QQ 账号' : '微信账号',data.contactType==='qq' ? STUDENT_FIELD_LIMITS.qqAccount : STUDENT_FIELD_LIMITS.wechatAccount,true],['issue','故障描述与补充说明',STUDENT_FIELD_LIMITS.issue,data.faultType === '其他']
  ]) text(key,label,limit,required);
  if (!/^\d{6,20}$/.test(data.studentId || '')) errors.studentId = '请输入学号';
  if (!STUDENT_DEVICE_TYPES.includes(data.deviceType)) errors.deviceType = '请选择设备类型';
  if (!FAULT_TYPES.includes(data.faultType)) errors.faultType = '请选择故障分类';
  if (!ANSWERS.includes(data.warranty)) errors.warranty = '请选择是否在保，可选不清楚';
  if (data.deviceType === '笔记本' && !ANSWERS.includes(data.liquidMetal)) errors.liquidMetal = '请选择是否使用液金散热，可选不清楚';
  if (data.deviceType === '笔记本' && data.brand === 'Dell' && data.dellG15 != null && data.dellG15 !== '' && !ANSWERS.includes(data.dellG15)) errors.dellG15 = '请选择是否属于 Dell G15 系列';
  if (!['qq','wechat'].includes(data.contactType)) errors.contactType = '请选择 QQ 或微信';
  if (data.email && (typeof data.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))) errors.email = '请输入有效的联系邮箱';
  return errors;
}
