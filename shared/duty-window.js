// Availability describes a complete duty, never a personal partial time range.
export function dutyEnd(start) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start || '')) return '';
  const [hour,minute]=start.split(':').map(Number),end=hour*60+minute+120;
  return end<1440 ? `${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}` : '';
}
export function fullDutyWindows(windows,task) {
  return windows.filter(row=>row.startAt<=task.slotStart&&row.endAt>=task.slotEnd)
    .map(row=>({...row,startAt:task.slotStart,endAt:task.slotEnd}));
}
