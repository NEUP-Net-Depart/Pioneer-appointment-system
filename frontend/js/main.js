import { $, $$ } from './utils.js';
import { loadAppointments, syncAppointments } from './store.js';
import { initBooking } from './booking.js';
import { initLookup } from './lookup.js';
import { initStaff, renderStaff } from './staff.js';
import { initAuth } from './auth.js';
import { initStats, renderStats } from './stats.js';
import { initUsers } from './users.js';
const appointments = loadAppointments();
let currentRole = 'student';
const pageParams = new URLSearchParams(window.location.search);
const pageMode = pageParams.get('mode') === 'staff' ? 'staff' : 'user';
const userEntry = pageParams.get('entry') === 'user';
if (userEntry) document.body.classList.add('user-mode');
function switchView(view) { const link = $(`[data-view-link="${view}"]`); if (link?.hidden) return; $$('.view').forEach(item => item.classList.toggle('is-active', item.dataset.view === view)); $$('.nav-link').forEach(item => item.classList.toggle('is-active', item.dataset.viewLink === view)); window.scrollTo({ top: 0, behavior: 'smooth' }); if (view === 'staff') renderStaff(appointments); if (view === 'stats') renderStats(appointments); }
$$('[data-view-link]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); switchView(button.dataset.viewLink); }));
initBooking({ appointments });
initLookup(appointments);
initStaff(appointments);
initStats(appointments);
const refreshUsers = initUsers(appointments);
async function refreshAfterLogin() { await syncAppointments(appointments); renderStaff(appointments); renderStats(appointments); }
initAuth({ onLogin: role => { currentRole = role; appointments.splice(0); switchView(pageMode === 'staff' ? 'staff' : (role === 'guest' || role === 'student' ? 'booking' : 'staff')); if (role !== 'guest') refreshAfterLogin(); if (role === 'admin' || role === 'superadmin') refreshUsers?.(); }, onLogout: () => { currentRole = 'guest'; appointments.splice(0); if (pageMode !== 'staff') switchView('booking'); } });

if (pageMode === 'staff') {
  $$('[data-view-link="booking"], [data-view-link="lookup"]').forEach(item => { item.hidden = true; });
}
