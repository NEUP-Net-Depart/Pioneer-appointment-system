import { initAppointmentSearch } from './appointment-search.js';
import { $, $$, showToast } from '/shared/utils.js';
import { apiJson, apiFetch } from '/shared/api.js';
import { uploadAttachments, attachmentUrl, attachmentSize } from '/shared/attachments.js';
import { createPhotoInput } from '/shared/photo-input.js';
import { drawSignature, validSignature } from '/shared/signature.js';
import { createScanner } from './scanner.js';
import { renderScanDetails } from './scan-details.js';
import { terminalStatuses,statusLabels,expirationMessage } from '/shared/constants.js';

export function initScan() {
  let item, active = false, ready = false, busy = false, generation = 0, legacyCount = 0, onsiteRequest;
  let strokes = [], pointer;
  let cameraPaused = false, pageActive = true;
  const root = $('#scan-view'), form = $('#scan-onsite-form'), canvas = $('#onsite-signature');
  const suggestions = initAppointmentSearch({ isActive: () => active, onSelect: id => resolve({ id }) });
  const account = () => sessionStorage.getItem('pioneerAccount');
  const owns = value => value.assignedTo === account() || !!value.assignedMemberId && value.assignedMemberId === sessionStorage.getItem('pioneerMemberId');
  const key = suffix => `pioneerScan:${account()}:${suffix}`;
  const read = suffix => { try { return JSON.parse(localStorage.getItem(key(suffix)) || 'null'); } catch { return null; } };
  function write(suffix, value) {
    try { if (value === null) localStorage.removeItem(key(suffix)); else localStorage.setItem(key(suffix), JSON.stringify(value)); return true; }
    catch { return false; }
  }
  const message = text => { $('#scan-message').textContent = text; };
  const photoInputs = Object.fromEntries(['front','back'].map(side => [side, createPhotoInput({
    input: $('#scan-'+side), preview: $('#scan-'+side+'-preview'), meta: $('#scan-'+side+'-state'), progress: $('#scan-'+side+'-progress'),
    getContext: () => `${generation}:${account()}:${item?.id}`,
    onChange() {
      if (!item) return;
      const uploaded = photos(); delete uploaded[side]; write(`photos:${item.id}`, uploaded);
    },
    async upload(file) {
      const [attachment] = await uploadAttachments(item, [file], 'intake_' + side);
      return attachment;
    },
    onUploaded(file) {
      const uploaded = photos(); uploaded[side] = file.id; write(`photos:${item.id}`, uploaded);
    },
  })]));
  const canStartCamera = () => active && ready && !cameraPaused && pageActive && !document.hidden && !$('#scan-home').hidden;
  const scanner = createScanner({ video: $('#scan-video'), torch: $('#scan-torch'), switchCamera: $('#scan-switch-camera'), canStart: canStartCamera, onCode: code => resolve({ code }), onState(state) {
    $('.scanner-frame').dataset.cameraState = state;
    $('#scan-camera').hidden = false;
    $('#scan-camera').textContent = ['running','opening'].includes(state) ? '关闭摄像头' : '开启摄像头';
    $('#scan-camera').setAttribute('aria-pressed', String(['running','opening'].includes(state)));
  } });
  function panels(id) {
    suggestions.clear();
    scanner.stop();
    const changingPanel = id && $('#'+id).hidden;
    for (const panel of ['scan-home','scan-manual-form','scan-detail','scan-onsite-form']) $('#'+panel).hidden = panel !== id;
    if (changingPanel) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      if (active) $('#'+id).querySelector('h1')?.focus({ preventScroll: true });
    }
  }
  function photos() { return read(`photos:${item.id}`) || {}; }
  function resetPreviews() {
    for (const photo of Object.values(photoInputs)) photo.reset();
  }
  function resetRegistration() {
    onsiteRequest = undefined; write('onsiteRequest', null); form.reset(); strokes = []; pointer = undefined; drawSignature(canvas, strokes);
  }
  function showItem(value) {
    if (item?.id !== value.id || value.status !== 'booked') resetPreviews();
    item = value; write('selected', item.id); panels('scan-detail');
    renderScanDetails($('#scan-detail-info'), item);
    $('#scan-intake-form').hidden = item.status !== 'booked';
    $('#scan-cancel-onsite').hidden = item.status !== 'booked' || item.source !== 'onsite';
    $('#scan-result-form').hidden = item.status !== 'in_progress' || !owns(item);
    $('#scan-detail-back').hidden = item.status === 'in_progress' && owns(item);
    $('#scan-files-section').hidden = item.status === 'booked';
    $('#scan-signed').hidden = !item.signature;
    if (item.signature) { try { drawSignature($('#scan-signed'), JSON.parse(item.signature)); } catch { $('#scan-signed').hidden = true; } }
    if (item.status !== 'booked') loadFiles();
    $('#scan-thermal-advice').hidden = item.faultType !== '清灰换硅脂';
    $('#scan-legacy-notice').hidden = legacyCount < 2;
    const draft = read(`draft:${item.id}`);
    $('#scan-note').value = draft?.note ?? item.repairNote ?? '';
    $('#scan-outcome').value = draft?.outcome || '';
    $('#scan-draft-state').textContent = draft ? '已恢复此账号在本机保存的维修草稿。' : '';
    for (const side of ['front','back']) if (photos()[side]) photoInputs[side].setStatus('照片已上传，可直接重试签到');
    message(item.status === 'in_progress' ? '维修进行中，完成后请填写结果。' : item.status === 'expired' ? expirationMessage : terminalStatuses.includes(item.status) ? `此工单${statusLabels[item.status]}。` : '');
  }
  async function loadFiles() {
    const selected = item, current = generation;
    $('#scan-files').textContent = '正在读取附件…';
    try {
      const result = await apiJson(`/api/appointments/${encodeURIComponent(selected.id)}/attachments`);
      if (current !== generation || selected !== item) return;
      $('#scan-files').replaceChildren();
      if (!result.items.length) $('#scan-files').textContent = '暂无附件';
      for (const file of result.items) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'attachment-link';
        button.textContent = `${file.purpose === 'intake_front' ? '签到正面 · ' : file.purpose === 'intake_back' ? '签到反面 · ' : ''}${file.filename} · ${attachmentSize(file.size)}`;
        button.addEventListener('click', () => run(async epoch => {
          const response = await apiFetch(attachmentUrl(selected.id, file.id));
          if (!response.ok) throw new Error('附件暂时无法读取');
          const blob = await response.blob(); if (epoch !== generation) return;
          const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = file.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        }));
        $('#scan-files').append(button);
      }
    } catch (error) { if (current === generation && selected === item) $('#scan-files').textContent = error.message; }
  }
  async function home() {
    const current = generation;
    ready = false; scanner.stop(); message('正在检查未完成维修…');
    const result = await apiJson('/api/scan/current');
    if (current !== generation) return false;
    ready = true; legacyCount = result.items.length;
    if (result.items.length) { showItem(result.items[0]); return true; }
    item = undefined; resetPreviews(); write('selected', null); panels('scan-home'); message('准备接待下一台设备');
    if (active && !document.hidden) scanner.start();
    return false;
  }
  async function restore() {
    const current = ++generation; ready = false; scanner.stop(); message('正在恢复当前维修…');
    resetPreviews();
    const selected = read('selected');
    try {
      const registrationRequestId = onsiteRequest || read('onsiteRequest');
      const query = registrationRequestId ? '?' + new URLSearchParams({ registrationRequestId }) : '';
      const result = await apiJson('/api/scan/current' + query);
      if (current !== generation) return false;
      if (result.registration) resetRegistration();
      ready = true; legacyCount = result.items.length;
      if (result.items.length) { showItem(result.items[0]); return true; }
      if (result.pending && !selected) { showItem(result.pending); return true; }
      if (selected) {
        const selectedItem = await apiJson('/api/scan/resolve', { method: 'POST', json: { id: selected } }).catch(error => {
          if ([403,404].includes(error.status)) { write('selected', null); return { status: 'completed' }; }
          throw error;
        });
        if (current !== generation) return false;
        if (!terminalStatuses.includes(selectedItem.status)) { showItem(selectedItem); return true; }
        write(`draft:${selected}`, null); write(`photos:${selected}`, null);
      }
      item = undefined; write('selected', null); panels('scan-home'); message('准备接待下一台设备');
      return false;
    } catch (error) {
      if (current === generation) { ready = false; panels(''); message(`${error.message}。请重新读取当前工单后继续。`); }
      return false;
    }
  }
  async function run(operation) {
    if (busy) return;
    busy = true; const current = generation;
    root.setAttribute('aria-busy', 'true');
    const controls = [...root.querySelectorAll('button,input,select,textarea')].map(element => [element, element.disabled]);
    controls.forEach(([element]) => element.disabled = true);
    try { await operation(current); }
    catch (error) { if (current === generation) { message(`${error.message}。操作未确认，可重试或重新读取当前工单。`); showToast(error.message); } }
    finally { if (current === generation) { busy = false; root.removeAttribute('aria-busy'); controls.forEach(([element,disabled]) => element.disabled = disabled); } }
  }
  async function resolve(input) {
    return run(async current => {
      if (!ready) throw new Error('请先重新读取当前工单');
      scanner.stop();
      const result = await apiJson('/api/scan/resolve', { method: 'POST', json: input });
      if (current === generation) showItem(result);
    });
  }
  async function update(input, current) {
    const updated = await apiJson(`/api/appointments/${encodeURIComponent(item.id)}/status`, { method: 'PATCH', json: { ...input, revision: item.revision } });
    if (current === generation) showItem(updated);
    return updated;
  }
  function saveDraft() {
    if (!item) return;
    const saved = write(`draft:${item.id}`, { note: $('#scan-note').value, outcome: $('#scan-outcome').value });
    $('#scan-draft-state').textContent = saved ? '' : '本机无法保存草稿，请保持页面打开并尽快提交。';
  }
  $('#scan-note').addEventListener('input', saveDraft); $('#scan-outcome').addEventListener('change', saveDraft);
  $('#scan-reload-files').addEventListener('click', loadFiles);
  $('#scan-upload-files').addEventListener('click', () => run(async current => {
    const files = [...$('#scan-add-files').files];
    if (!files.length) throw new Error('请先选择附件');
    await uploadAttachments(item, files);
    if (current === generation) { $('#scan-add-files').value = ''; await loadFiles(); message('维修附件已保存'); }
  }));
  $('#scan-manual').addEventListener('click', () => { if (ready) { panels('scan-manual-form'); $('#scan-number').focus(); } });
  $('#scan-manual-form').addEventListener('submit', event => { event.preventDefault(); suggestions.clear(); resolve({ id: $('#scan-number').value.trim() }); });
  $('#scan-camera').addEventListener('click', () => {
    if (['running','opening'].includes($('.scanner-frame').dataset.cameraState)) {
      cameraPaused = true; scanner.stop();
    } else {
      cameraPaused = false; scanner.start();
    }
  });
  $('#scan-image').addEventListener('change', async event => {
    if (!ready || busy) return;
    const file = event.target.files[0]; if (!file) return;
    try { await scanner.image(file); } catch (error) { message(error.message); } finally { event.target.value = ''; }
  });
  $('#scan-recover').addEventListener('click', () => { if (!busy) restore().then(() => { if (ready && active && !item) scanner.start(); }); });
  for (const button of [...$$('[data-scan-back]'), $('#scan-detail-back')]) button.addEventListener('click', () => run(home));
  $('#scan-intake-form').addEventListener('submit', event => {
    event.preventDefault(); run(async current => {
      if (!item || item.status !== 'booked') throw new Error('当前工单不能签到，请重新读取当前工单');
      const uploaded = photos();
      const [frontPhotoId, backPhotoId] = await Promise.all(['front','back'].map(async side =>
        uploaded[side] || (await photoInputs[side].getUploaded()).id));
      if (current !== generation) return;
      await update({ status: 'in_progress', frontPhotoId, backPhotoId }, current);
      if (current === generation) showToast('照片已保存，已签到并开始维修');
    });
  });
  $('#scan-cancel-onsite').addEventListener('click', () => {
    if (!item || !window.confirm('确认取消这条尚未签到的临时登记？')) return;
    run(async current => {
      const id = item.id;
      await update({ status: 'cancelled' }, current);
      if (current !== generation) return;
      write(`draft:${id}`, null); write(`photos:${id}`, null); write('selected', null);
      await home();
      if (current === generation) showToast('临时登记已取消');
    });
  });
  $('#scan-save-note').addEventListener('click', () => run(async current => {
    await update({ repairNote: $('#scan-note').value.trim() }, current);
    if (current === generation) message('维修说明已保存到服务器');
  }));
  $('#scan-result-form').addEventListener('submit', event => {
    event.preventDefault(); saveDraft(); run(async current => {
      const id = item.id;
      await update({ status: 'completed', outcome: $('#scan-outcome').value, repairNote: $('#scan-note').value.trim() }, current);
      if (current !== generation) return;
      write(`draft:${id}`, null); write(`photos:${id}`, null); write('selected', null);
      await home();
      if (current === generation) showToast('维修结果已保存');
    });
  });
  $('#scan-onsite').addEventListener('click', () => {
    if (!ready) return;
    panels('scan-onsite-form'); onsiteRequest ||= read('onsiteRequest') || crypto.randomUUID(); write('onsiteRequest', onsiteRequest);
    const allowed = JSON.parse(sessionStorage.getItem('pioneerCampuses') || '[]');
    for (const option of form.elements.campus.options) option.disabled = !!option.value && !allowed.includes(option.value);
    if (allowed.length === 1) form.elements.campus.value = allowed[0];
  });
  const point = event => { const rect = canvas.getBoundingClientRect(); return [Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))]; };
  canvas.addEventListener('pointerdown', event => { if (busy || pointer !== undefined) return; pointer = event.pointerId; canvas.setPointerCapture(pointer); strokes.push([point(event)]); });
  canvas.addEventListener('pointermove', event => { if (busy || pointer !== event.pointerId) return; strokes.at(-1).push(point(event)); drawSignature(canvas, strokes); });
  function finish(event) { if (pointer !== event.pointerId) return; if (strokes.at(-1).length < 2) strokes.pop(); pointer = undefined; }
  canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish);
  $('#onsite-clear-signature').addEventListener('click', () => { strokes = []; pointer = undefined; drawSignature(canvas, strokes); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    // Capture before run disables inputs; disabled fields do not appear in FormData.
    const input = Object.fromEntries(new FormData(form));
    run(async current => {
      if (!validSignature(strokes)) throw new Error('请机主完整手写本人姓名');
      const result = await apiJson('/api/scan/onsite', { method: 'POST', json: { ...input, signature: strokes, requestId: onsiteRequest } });
      if (current !== generation) return;
      resetRegistration(); showItem(result);
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) scanner.stop();
    else if (active && ready && !busy && !$('#scan-home').hidden) scanner.start();
  });
  window.addEventListener('pagehide', () => { pageActive = false; scanner.stop(); });
  window.addEventListener('pageshow', () => { pageActive = true; if (canStartCamera()) scanner.start(); });
  window.addEventListener('blur', () => { pageActive = false; scanner.stop(); });
  window.addEventListener('focus', () => { pageActive = true; if (canStartCamera()) scanner.start(); });
  window.addEventListener('offline', () => { if (active) message('网络已断开，填写内容会保留。联网后可重试提交或重新读取工单。'); });
  window.addEventListener('online', () => { if (active) message('网络已恢复，可以重试提交或重新读取当前工单。'); });
  return {
    restore,
    refresh() {},
    activate(value) {
      active = value;
      if (!active) suggestions.clear();
      if (active && ready && !$('#scan-home').hidden && !document.hidden) scanner.start(); else scanner.stop();
    },
    clear() {
      cameraPaused = false;
      generation++; active = ready = busy = false; item = undefined; onsiteRequest = undefined; scanner.stop(); resetPreviews();
      root.removeAttribute('aria-busy'); root.querySelectorAll('button,input,select,textarea').forEach(element => element.disabled = false);
      $('#scan-torch').disabled = true; $('#scan-detail-info').replaceChildren(); $('#scan-files').replaceChildren(); $('#scan-add-files').value = ''; $('#scan-note').value = ''; $('#scan-outcome').value = ''; form.reset();
      strokes = []; pointer = undefined; drawSignature(canvas, strokes); panels(''); message('');
    }
  };
}
