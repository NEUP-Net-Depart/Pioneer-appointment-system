const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => { const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ''); });
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) throw new Error('JWT_SECRET must be set to at least 32 characters in production');
if (process.env.NODE_ENV === 'production' && !/^[0-9a-fA-F]{64}$/.test(process.env.PII_ENCRYPTION_KEY || '')) throw new Error('PII_ENCRYPTION_KEY must be a 64-character hexadecimal key in production');
const database = require('./database');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./security');

const frontendRoot = path.resolve(__dirname, '..', 'frontend');
const attachmentRoot = path.resolve(process.env.ATTACHMENTS_DIR || path.join(__dirname, 'data', 'attachments'));
fs.mkdirSync(attachmentRoot, { recursive: true });
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || '127.0.0.1';
const allowedOrigin = process.env.FRONTEND_ORIGIN || '';
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.csv': 'text/csv; charset=utf-8' };
const statusLabels = { pending: '待审核', awaiting_claim: '待接单', claimed: '已接单', in_progress: '维修中', completed: '已完成', cancelled: '已取消', no_show: '爽约', no_repair: '无法维修' };
const allowedStatuses = new Set(Object.keys(statusLabels));
const roleLevel = { student: 0, technician: 1, admin: 2, superadmin: 3 };
const SLOT_CAPACITY = 20;
const loginAttempts = new Map();
const guestAttempts = new Map();

function securityHeaders() { return { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'", 'Cache-Control': 'no-store' }; }
function writeHeaders(response, type, request) { const headers = { ...securityHeaders(), 'Content-Type': type }; const origin = request?.headers?.origin; if (origin && allowedOrigin && origin === allowedOrigin) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'; headers['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,DELETE,OPTIONS'; headers['Access-Control-Expose-Headers'] = 'Content-Disposition'; } response.writeHead(response.statusCode || 200, headers); }
function sendJson(response, request, status, payload) { response.statusCode = status; writeHeaders(response, 'application/json; charset=utf-8', request); response.end(JSON.stringify(payload)); }
function readBody(request) { return readJsonBody(request, 1e6); }
function readJsonBody(request, maxBytes) { return new Promise((resolve, reject) => { let raw = ''; let done = false; request.on('data', chunk => { if (done) return; raw += chunk; if (raw.length > maxBytes) { done = true; reject(new Error('请求体过大')); request.destroy(); } }); request.on('end', () => { if (done) return; try { const body = raw ? JSON.parse(raw) : {}; if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(new Error('请求体必须是 JSON 对象')); resolve(body); } catch { reject(new Error('请求体不是有效 JSON')); } }); request.on('error', reject); }); }
function text(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function rawText(value) { return String(value ?? '').trim(); }
function normalizeTimeSlot(value) { const normalized = rawText(value).replace(/：/g, ':').replace(/[‐‑‒–—−-]/g, '-'); const match = normalized.match(/(\d{1,2})\s*:\s*(\d{2})\s*[^0-9]+(\d{1,2})\s*:\s*(\d{2})/); if (!match) return ''; const key = `${match[1].padStart(2, '0')}:${match[2]}-${match[3].padStart(2, '0')}:${match[4]}`; return { '19:00-20:00': '19:00–20:00', '20:00-21:00': '20:00–21:00' }[key] || ''; }
function account(value) { return text(value, 64).toLowerCase(); }
function validDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [year, month, day] = value.split('-').map(Number); const date = new Date(`${value}T12:00:00`); return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day; }
function localDateKey(date = new Date()) { const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 10); }
function withinBookingWindow(value) { const today = new Date(`${localDateKey()}T12:00:00`); const selected = new Date(`${value}T12:00:00`); const latest = new Date(today); latest.setDate(latest.getDate() + 3); return selected >= today && selected <= latest; }
function serviceDay(value) { const date = new Date(`${value}T12:00:00`); const day = date.getDay(); return day >= 1 && day <= 4; }
function activeAppointment(item) { return !['cancelled', 'no_show'].includes(item.status); }
const attachmentMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']);
function attachmentAccess(request, item) { const user = authenticatedUser(request); if (user && roleLevel[user.role] >= roleLevel.technician) return user; const studentId = account(new URL(request.url, `http://${request.headers.host || 'localhost'}`).searchParams.get('studentId')); return studentId && item.studentId === studentId ? { role: 'guest' } : null; }
function csv(items) { const headers = ['预约编号', '学号', '姓名', '学院', '校区', '联系方式', '设备类型', '品牌', '型号', '故障类型', '日期', '时段', '状态', '维修人员', '维修记录']; const rows = items.map(item => [item.id, item.studentId, item.name, item.college, item.campus, item.phone, item.deviceType, item.brand, item.deviceModel, item.faultType, item.date, item.timeSlot, statusLabels[item.status] || item.status, item.assignedTo, item.repairNote]); const cell = value => { const safe = String(value || '').replaceAll('"', '""'); return `"${/^[=+\-@]/.test(safe) ? "'" : ''}${safe}"`; }; return '\ufeff' + [headers, ...rows].map(row => row.map(cell).join(',')).join('\n'); }

function bearer(request) { const value = request.headers.authorization || ''; return value.startsWith('Bearer ') ? value.slice(7) : ''; }
function authenticatedUser(request) { const claims = verifyToken(bearer(request)); if (!claims) return null; const user = database.findUserAuth(claims.sub); if (!user || !user.active || user.role !== claims.role || Number(claims.ver ?? 0) !== Number(user.tokenVersion || 0)) return null; return user; }
function requireRole(request, response, minimum) { const user = authenticatedUser(request); if (!user) { sendJson(response, request, 401, { error: '登录已失效，请重新登录' }); return null; } if ((roleLevel[user.role] ?? -1) < (roleLevel[minimum] ?? 99)) { sendJson(response, request, 403, { error: '没有执行此操作的权限' }); return null; } return user; }
function loginAllowed(request) { const key = request.headers['x-real-ip'] || request.socket.remoteAddress || 'unknown'; const now = Date.now(); const recent = (loginAttempts.get(key) || []).filter(time => now - time < 15 * 60 * 1000); if (recent.length >= 20) return false; recent.push(now); loginAttempts.set(key, recent); return true; }
function guestRequestAllowed(request, limit = 120) { const key = request.headers['x-real-ip'] || request.socket.remoteAddress || 'unknown'; const now = Date.now(); const recent = (guestAttempts.get(key) || []).filter(time => now - time < 60 * 1000); if (recent.length >= limit) return false; recent.push(now); guestAttempts.set(key, recent); return true; }
function visibleAppointments(user) { const items = database.listAppointments(); return roleLevel[user.role] > 0 ? items : items.filter(item => item.studentId === user.account); }

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, request, 200, { ok: true, service: 'pioneer-repair-api', database: 'sqlite' });
  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    if (!loginAllowed(request)) return sendJson(response, request, 429, { error: '登录尝试过于频繁，请稍后再试' });
    const input = await readBody(request); const user = database.findUserAuth(account(input.account));
    if (typeof input.password !== 'string' || input.password.length > 128 || !user || !user.active || !verifyPassword(input.password, user.passwordHash)) return sendJson(response, request, 401, { error: '账号或密码不正确' });
    return sendJson(response, request, 200, { account: user.account, role: user.role, permissions: Object.keys(roleLevel).filter(role => roleLevel[role] <= roleLevel[user.role]), token: signToken(user), expiresIn: 8 * 60 * 60 });
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const user = authenticatedUser(request); if (!user) return sendJson(response, request, 401, { error: '登录已失效，请重新登录' });
    database.revokeUserTokens(user.account); return sendJson(response, request, 200, { ok: true });
  }
  if (request.method === 'GET' && url.pathname === '/api/auth/me') { const user = requireRole(request, response, 'student'); if (!user) return; return sendJson(response, request, 200, { account: user.account, name: user.name, role: user.role, campus: user.campus }); }

  if (request.method === 'GET' && url.pathname === '/api/appointments') { const user = requireRole(request, response, 'student'); if (!user) return; return sendJson(response, request, 200, { items: visibleAppointments(user) }); }
  if (request.method === 'POST' && url.pathname === '/api/appointments') {
    if (!guestRequestAllowed(request)) return sendJson(response, request, 429, { error: '预约操作过于频繁，请稍后再试' });
    const user = authenticatedUser(request); const input = await readBody(request);
    const required = ['studentId', 'name', 'campus', 'social', 'deviceType', 'brand', 'deviceModel', 'warranty', 'date', 'timeSlot', 'faultType', 'agreementAt']; if (required.some(key => !input[key])) return sendJson(response, request, 400, { error: '缺少必填字段', required });
    if (Number.isNaN(Date.parse(String(input.agreementAt))) || String(input.agreementVersion || 'v1.0').length > 20) return sendJson(response, request, 400, { error: '协议记录不正确' });
    if (!/^\d{6,20}$/.test(account(input.studentId)) || text(input.name, 80).length < 2 || (text(input.phone, 30) && !/^[0-9+()\-\s]{6,30}$/.test(text(input.phone, 30)))) return sendJson(response, request, 400, { error: '学号、姓名或联系方式格式不正确' });
    const lengthLimits = [['设备类型', input.deviceType, 80], ['品牌', input.brand, 80], ['设备型号', input.deviceModel, 120], ['学院/专业', input.college, 120], ['QQ/微信', input.social, 120], ['序列号', input.serial, 120], ['备注', input.note, 500]];
    const tooLong = lengthLimits.find(([, value, max]) => rawText(value).length > max);
    if (tooLong) return sendJson(response, request, 400, { error: `${tooLong[0]}不能超过 ${tooLong[2]} 个字符` });
    if (user?.role === 'student' && account(input.studentId) !== user.account) return sendJson(response, request, 403, { error: '只能为当前登录学生提交预约' });
    if (user?.role === 'student' && text(input.name, 80) !== user.name) return sendJson(response, request, 403, { error: '预约姓名必须与当前账号一致' });
    if (!validDate(input.date) || !withinBookingWindow(input.date)) return sendJson(response, request, 400, { error: '预约日期必须为今天起 3 天内' });
    if (!serviceDay(input.date)) return sendJson(response, request, 400, { error: '预约日期必须为周一至周四' });
    const normalizedTimeSlot = normalizeTimeSlot(input.timeSlot); if (!normalizedTimeSlot) return sendJson(response, request, 400, { error: '预约时段不正确，请选择 19:00–20:00 或 20:00–21:00' });
    if (!['南湖', '浑南'].includes(input.campus)) return sendJson(response, request, 400, { error: '校区不正确' });
    const all = database.listAppointments(); const duplicate = all.some(item => item.studentId === account(input.studentId) && item.date === input.date && item.timeSlot === normalizedTimeSlot && activeAppointment(item)); if (duplicate) return sendJson(response, request, 409, { error: '同一时段已经存在预约' });
    const used = all.filter(item => item.campus === input.campus && item.date === input.date && item.timeSlot === normalizedTimeSlot && activeAppointment(item)).length; if (used >= SLOT_CAPACITY) return sendJson(response, request, 409, { error: '该校区该时段已满' });
    const item = { ...input, studentId: account(input.studentId), name: text(input.name, 80), college: text(input.college, 120), phone: text(input.phone, 30), social: text(input.social, 120), deviceType: text(input.deviceType, 80), brand: text(input.brand, 80), deviceModel: text(input.deviceModel, 120), serial: text(input.serial, 120), warranty: text(input.warranty, 20), faultType: text(input.faultType, 80), issue: rawText(input.issue), liquidDrop: text(input.liquidDrop, 20), note: text(input.note, 500), timeSlot: normalizedTimeSlot, agreementAt: new Date().toISOString(), agreementVersion: text(input.agreementVersion || 'v1.0', 20) };
    try { return sendJson(response, request, 201, database.createAppointment(item, { capacity: SLOT_CAPACITY })); } catch (error) { if (error.code === 'DUPLICATE_APPOINTMENT' || error.code === 'SLOT_FULL' || String(error.code || '').includes('CONSTRAINT')) return sendJson(response, request, 409, { error: error.message || '预约冲突，请刷新后重试' }); throw error; }
  }
  if (request.method === 'GET' && url.pathname === '/api/appointments/lookup') {
    if (!guestRequestAllowed(request)) return sendJson(response, request, 429, { error: '查询操作过于频繁，请稍后再试' });
    const appointmentId = text(url.searchParams.get('appointmentId'), 40); const studentId = account(url.searchParams.get('studentId'));
    if (!appointmentId || !/^\d{6,20}$/.test(studentId)) return sendJson(response, request, 400, { error: '请提供正确的预约编号和学号' });
    const item = database.getAppointment(appointmentId);
    if (!item || item.studentId !== studentId) return sendJson(response, request, 404, { error: '预约编号或学号不匹配' });
    return sendJson(response, request, 200, { ...item, attachments: database.listAttachments(appointmentId) });
  }
  const attachmentMatch = url.pathname.match(/^\/api\/appointments\/([^/]+)\/attachments(?:\/([^/]+))?$/);
  if (attachmentMatch && request.method === 'POST') {
    if (!guestRequestAllowed(request, 30)) return sendJson(response, request, 429, { error: '附件上传过于频繁，请稍后再试' });
    const appointmentId = decodeURIComponent(attachmentMatch[1]); const item = database.getAppointment(appointmentId); if (!item) return sendJson(response, request, 404, { error: '预约不存在' });
    const user = authenticatedUser(request); const body = await readJsonBody(request, 8 * 1024 * 1024); const studentId = account(body.studentId); if (!user && item.studentId !== studentId) return sendJson(response, request, 404, { error: '预约编号或学号不匹配' }); if (user && roleLevel[user.role] < roleLevel.technician && user.account !== item.studentId) return sendJson(response, request, 403, { error: '没有上传此预约附件的权限' });
    const filename = path.basename(rawText(body.filename)).slice(0, 160); const mimeType = rawText(body.mimeType).toLowerCase(); const data = rawText(body.data); if (!filename || !attachmentMime.has(mimeType) || !/^([A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return sendJson(response, request, 400, { error: '附件格式不支持' });
    const buffer = Buffer.from(data, 'base64'); if (!buffer.length || buffer.length > 5 * 1024 * 1024) return sendJson(response, request, 400, { error: '附件大小不能超过 5 MB' });
    const id = crypto.randomUUID(); const extension = path.extname(filename).replace(/[^.a-z0-9]/gi, '').slice(0, 10); const storagePath = path.join(attachmentRoot, `${id}${extension}`); fs.writeFileSync(storagePath, buffer, { flag: 'wx' }); let attachment; try { attachment = database.addAttachment({ id, appointmentId, filename, mimeType, size: buffer.length, storagePath }); } catch (error) { fs.rmSync(storagePath, { force: true }); throw error; } return sendJson(response, request, 201, { ...attachment, url: `/api/appointments/${encodeURIComponent(appointmentId)}/attachments/${encodeURIComponent(id)}?studentId=${encodeURIComponent(item.studentId)}` });
  }
  if (attachmentMatch && request.method === 'GET' && attachmentMatch[2]) {
    const appointmentId = decodeURIComponent(attachmentMatch[1]); const item = database.getAppointment(appointmentId); const attachment = database.getAttachment(decodeURIComponent(attachmentMatch[2])); if (!item || !attachment || attachment.appointmentId !== appointmentId || !attachmentAccess(request, item)) return sendJson(response, request, 404, { error: '附件不存在' }); if (!fs.existsSync(attachment.storagePath)) return sendJson(response, request, 404, { error: '附件文件不存在' }); response.statusCode = 200; response.setHeader('Content-Disposition', `inline; filename="${attachment.filename.replace(/"/g, '')}"`); writeHeaders(response, attachment.mimeType, request); return fs.createReadStream(attachment.storagePath).pipe(response);
  }
  if (attachmentMatch && request.method === 'GET') { const appointmentId = decodeURIComponent(attachmentMatch[1]); const item = database.getAppointment(appointmentId); if (!item || !attachmentAccess(request, item)) return sendJson(response, request, 404, { error: '预约不存在' }); return sendJson(response, request, 200, { items: database.listAttachments(appointmentId) }); }
  const appointmentMatch = url.pathname.match(/^\/api\/appointments\/([^/]+)\/status$/);
  if (request.method === 'PATCH' && appointmentMatch) {
    const user = authenticatedUser(request);
    const id = decodeURIComponent(appointmentMatch[1]); const item = database.getAppointment(id); if (!item) return sendJson(response, request, 404, { error: '预约不存在' });
    const patch = await readBody(request);
    const guestCancel = !user && patch.status === 'cancelled' && /^\d{6,20}$/.test(account(patch.studentId)) && item.studentId === account(patch.studentId);
    if (!user && !guestCancel) return sendJson(response, request, 401, { error: '请使用预约编号和学号查询后再操作' });
    const studentCancel = user?.role === 'student' && item.studentId === user.account && patch.status === 'cancelled';
    if (!studentCancel && !guestCancel && (roleLevel[user?.role] ?? -1) < roleLevel.technician) return sendJson(response, request, 403, { error: '没有执行此操作的权限' });
    if (patch.status && !allowedStatuses.has(patch.status)) return sendJson(response, request, 400, { error: '状态不正确' });
    if ((studentCancel || guestCancel) && !['pending', 'awaiting_claim'].includes(item.status)) return sendJson(response, request, 409, { error: '当前状态不能取消' });
    if (patch.repairNote && String(patch.repairNote).length > 3000) return sendJson(response, request, 400, { error: '维修记录过长' });
    if (patch.assignedTo !== undefined && patch.assignedTo !== '') {
      const assignee = database.findUser(account(patch.assignedTo)) || database.listUsers().find(candidate => candidate.name === text(patch.assignedTo, 80));
      if (!assignee || !assignee.active || !['technician', 'admin'].includes(assignee.role)) return sendJson(response, request, 400, { error: '维修人员账号不存在或未启用' });
      patch.assignedTo = assignee.account;
    }
    if (user?.role === 'technician') {
      const ownsItem = item.assignedTo === user.account || item.assignedTo === user.name;
      const claiming = patch.status === 'claimed' && !item.assignedTo && (!patch.assignedTo || patch.assignedTo === user.account);
      if (!ownsItem && !claiming) return sendJson(response, request, 403, { error: '只能处理自己接单的预约' });
      if (patch.assignedTo && patch.assignedTo !== user.account) return sendJson(response, request, 403, { error: '维修人员不能转派其他账号' });
      if (patch.status === 'cancelled') return sendJson(response, request, 403, { error: '维修人员不能取消预约，请联系管理者' });
      const transitions = { pending: ['claimed', 'awaiting_claim'], awaiting_claim: ['claimed'], claimed: ['in_progress', 'completed', 'no_show', 'no_repair'], in_progress: ['completed', 'no_show', 'no_repair'] };
      if (patch.status && patch.status !== item.status && !(transitions[item.status] || []).includes(patch.status)) return sendJson(response, request, 409, { error: '当前状态不能直接跳转到目标状态' });
    }
    const changes = studentCancel || guestCancel ? { status: 'cancelled' } : { ...patch };
    if (user?.role === 'technician' && changes.status === 'claimed' && !changes.assignedTo) changes.assignedTo = user.account;
    return sendJson(response, request, 200, database.updateAppointment(id, changes));
  }

  if (request.method === 'GET' && url.pathname === '/api/live/summary') { if (!guestRequestAllowed(request)) return sendJson(response, request, 429, { error: '查询操作过于频繁，请稍后再试' }); const appointmentId = url.searchParams.get('appointmentId'); if (appointmentId) { const item = database.getAppointment(appointmentId); if (!item || item.studentId !== account(url.searchParams.get('studentId'))) return sendJson(response, request, 404, { error: '预约不存在' }); } return sendJson(response, request, 200, database.liveSummary(database.listAppointments(), Object.fromEntries(url.searchParams.entries()))); }
  if (request.method === 'GET' && (url.pathname === '/api/stats/summary' || url.pathname === '/api/stats/fault-types')) { const user = requireRole(request, response, 'admin'); if (!user) return; const range = url.searchParams.get('range') || 'all'; const day = url.searchParams.get('day') || ''; if (!['7', '30', 'all'].includes(range) || (day && !validDate(day))) return sendJson(response, request, 400, { error: '统计范围或日期不正确' }); const stats = database.makeStats(database.listAppointments(), range, day); return sendJson(response, request, 200, url.pathname.endsWith('fault-types') ? stats.faults : stats); }
  if (request.method === 'GET' && url.pathname === '/api/users') { const user = requireRole(request, response, 'admin'); if (!user) return; return sendJson(response, request, 200, { items: database.listUsers() }); }
  if (request.method === 'POST' && url.pathname === '/api/users') { const user = requireRole(request, response, 'admin'); if (!user) return; const input = await readBody(request); const newAccount = account(input.account); const name = text(input.name, 80); const campus = text(input.campus, 20); if (!/^\d{6,20}$/.test(newAccount) || name.length < 2 || String(input.password || '').length < 8 || String(input.password || '').length > 128 || !['南湖', '浑南'].includes(campus) || database.findUser(newAccount)) return sendJson(response, request, 400, { error: '学号、姓名、密码或校区不符合要求，或学号已存在' }); return sendJson(response, request, 201, database.createUser({ account: newAccount, name, campus, role: 'student', passwordHash: hashPassword(input.password), active: true })); }
  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (request.method === 'PATCH' && userMatch) {
    const actor = requireRole(request, response, 'admin'); if (!actor) return;
    const target = database.findUser(decodeURIComponent(userMatch[1]));
    if (!target) return sendJson(response, request, 404, { error: '账号不存在' });
    if ((roleLevel[target.role] ?? 99) >= roleLevel[actor.role] || target.protected) return sendJson(response, request, 403, { error: '权限不足：只能管理权限低于自己的账号' });
    const patch = await readBody(request);
    if (patch.password !== undefined) {
      if (String(patch.password).length < 8 || String(patch.password).length > 128) return sendJson(response, request, 400, { error: '密码长度应为 8 至 128 位' });
      patch.passwordHash = hashPassword(patch.password); delete patch.password;
    }
    if (patch.active !== undefined && typeof patch.active !== 'boolean') return sendJson(response, request, 400, { error: '账号状态必须是布尔值' });
    if (patch.name !== undefined && text(patch.name, 80).length < 2) return sendJson(response, request, 400, { error: '姓名格式不正确' });
    if (patch.campus !== undefined && !['南湖', '浑南', '南湖 / 浑南'].includes(text(patch.campus, 20))) return sendJson(response, request, 400, { error: '校区不正确' });
    if (patch.role !== undefined) {
      const allowed = actor.role === 'superadmin'
        ? ['student', 'technician', 'admin']
        : target.role === 'student' && patch.role === 'technician' ? ['technician'] : [];
      if (!allowed.includes(patch.role)) return sendJson(response, request, 403, { error: '权限不足：当前账号只能将学生提升为维修人员' });
    }
    return sendJson(response, request, 200, database.updateUser(target.account, patch));
  }
  if (request.method === 'DELETE' && userMatch) { const actor = requireRole(request, response, 'admin'); if (!actor) return; const target = database.findUser(decodeURIComponent(userMatch[1])); if (!target) return sendJson(response, request, 404, { error: '账号不存在' }); if (target.protected || (roleLevel[target.role] ?? 99) >= roleLevel[actor.role]) return sendJson(response, request, 403, { error: '权限不足：只能删除权限低于自己的账号' }); if (!database.deleteUser(target.account)) return sendJson(response, request, 404, { error: '账号不存在或无法删除' }); return sendJson(response, request, 200, { ok: true, account: target.account, message: '账号已删除，历史预约记录保留' }); }
  if (request.method === 'GET' && url.pathname === '/api/export/appointments.csv') { const user = requireRole(request, response, 'admin'); if (!user) return; response.statusCode = 200; response.setHeader('Content-Disposition', 'attachment; filename="appointments.csv"'); writeHeaders(response, 'text/csv; charset=utf-8', request); return response.end(csv(database.listAppointments())); }
  return sendJson(response, request, 404, { error: 'API 路径不存在' });
}

function serveStatic(response, request, url) { const requested = url.pathname === '/' ? '/index.html' : url.pathname; const file = path.resolve(frontendRoot, `.${requested}`); if (!(file === frontendRoot || file.startsWith(frontendRoot + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendJson(response, request, 404, { error: '页面不存在' }); response.statusCode = 200; writeHeaders(response, mimeTypes[path.extname(file)] || 'application/octet-stream', request); fs.createReadStream(file).pipe(response); }
const server = http.createServer(async (request, response) => { const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`); if (request.method === 'OPTIONS') { response.statusCode = 204; writeHeaders(response, 'text/plain; charset=utf-8', request); return response.end(); } try { if (url.pathname.startsWith('/api/')) await handleApi(request, response, url); else serveStatic(response, request, url); } catch (error) { const clientError = error.message === '请求体过大' || ['请求体不是有效 JSON', '请求体必须是 JSON 对象'].includes(error.message); if (!clientError) console.error(error); if (!response.headersSent) { const status = error.message === '请求体过大' ? 413 : clientError ? 400 : 500; sendJson(response, request, status, { error: status === 500 ? '服务器内部错误' : error.message }); } } });
server.listen(port, host, () => console.log(`先锋维修预约系统运行于 http://${host}:${port}`));
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
