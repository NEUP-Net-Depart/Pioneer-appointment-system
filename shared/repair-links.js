export const repairLinkLabels = {
  continuation: '原故障继续处理',
  recurrence: '原故障复发',
  repair_induced: '维修引入新故障',
  historical: '历史关联'
};

export const repairLinkKinds = ['continuation', 'recurrence', 'repair_induced'];

export function confirmedRepairLink(input) {
  return repairLinkKinds.includes(input.linkKind) &&
    (input.linkKind === 'repair_induced'
      ? input.sameDeviceAndRepairRelated === true
      : input.sameDeviceAndFault === true);
}
