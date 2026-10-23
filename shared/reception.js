// Reception is an operational stage, not an appointment status.
export const receptionLabels = Object.freeze({ queued:'现场排队', assigned:'待接手', started:'维修中', closed:'已结束' });
export function receptionStatus(item) {
  return item.status==='booked' && ['queued','assigned'].includes(item.reception?.state) ? item.reception.state : item.status;
}
