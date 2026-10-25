// One device remains one appointment throughout reception, repair and follow-up.
export const MAX_BOOKING_DEVICES = 2;
export const DEVICE_FIELDS = ['deviceType','brand','deviceModel','warranty','faultType','issue','liquidMetal','dellG15'];
export const deviceFields = input => Object.fromEntries(DEVICE_FIELDS.map(key => [key,input[key]]));
