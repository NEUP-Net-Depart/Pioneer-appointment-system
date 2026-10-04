import { initNavigation } from '/shared/navigation.js';
import { initBooking } from './booking.js';
import { initLookup } from './lookup.js';
const appointments = [];
initNavigation();
initBooking({ appointments });
initLookup(appointments);
