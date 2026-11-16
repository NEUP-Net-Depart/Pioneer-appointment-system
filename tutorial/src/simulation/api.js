import { createSimulation } from './engine.js';
import { prepareWorkflow } from './fixtures.js';
import { tutorialProfiles, journeysFor } from '../journeys.js';

const params = new URLSearchParams(location.search);
if (!params.has('lesson')) {
  if (params.has('profile') && !tutorialProfiles.some((item) => item.id === params.get('profile')))
    params.set('profile', 'head');
  const paths = journeysFor({ id: params.get('profile') || 'head' });
  if (params.has('journey') && !paths.some((item) => item.id === params.get('journey')))
    params.set('journey', paths[0].id);
  params.delete('mode');
  params.delete('speed');
  if (`?${params}` !== location.search && params.size)
    history.replaceState(null, '', `${location.pathname}?${params}`);
}
export const simulation = createSimulation(
  params.get('profile') || 'head',
  params.get('lesson') || ''
);
simulation.state.activeOrderId = simulation.state.orders[0].id;
simulation.state.activeMemberId = 'demo-chen';
prepareWorkflow(simulation.state, params.get('journey'));
if (['repairs', 'duty-repair', 'reception'].includes(params.get('journey')))
  simulation.state.orders[0].serial = '';

export function useStaffSession() {}
export function clearSession() {
  sessionStorage.removeItem('pioneerToken');
}

export async function apiJson(path, options = {}) {
  const { method = 'GET', json, body, signal } = options;
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  try {
    const payload = await simulation.request(
      path,
      method,
      json ?? (typeof body === 'string' ? JSON.parse(body) : body) ?? {}
    );
    if (method === 'POST' && path === '/api/scan/onsite')
      simulation.state.activeOrderId = payload.id;
    if (method === 'POST' && /\/appointments\/[^/]+\/link$/.test(path))
      simulation.state.activeOrderId = payload.id;
    if (method === 'POST' && path === '/api/members')
      simulation.state.activeMemberId = payload.member.memberId;
    window.dispatchEvent(
      new CustomEvent('tutorial-request', {
        detail: { path: new URL(path, location.origin).pathname, method, payload }
      })
    );
    return payload;
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent('tutorial-api-error', {
        detail: { path, message: error.message, code: error.code }
      })
    );
    throw error;
  }
}

let sampleBlob;
export async function samplePhoto() {
  if (sampleBlob) return sampleBlob;
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 600;
  const context = canvas.getContext('2d');
  context.fillStyle = '#e9eee8';
  context.fillRect(0, 0, 960, 600);
  context.fillStyle = '#26352f';
  context.beginPath();
  context.roundRect(190, 85, 580, 360, 20);
  context.fill();
  context.fillStyle = '#b8c9b8';
  context.fillRect(210, 105, 540, 310);
  context.fillStyle = '#26352f';
  context.font = '32px sans-serif';
  context.fillText('PIONEER · DEMO DEVICE', 265, 265);
  context.fillStyle = '#7a8e80';
  context.beginPath();
  context.roundRect(145, 445, 670, 35, 10);
  context.fill();
  context.fillStyle = '#4b6352';
  context.font = '20px sans-serif';
  context.fillText('S/N: PF4DEMO26', 365, 545);
  sampleBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  return sampleBlob;
}

export async function apiFetch(path, options = {}) {
  const data = await apiJson(path, options);
  if (data?.sampleImage)
    return new Response(await samplePhoto(), { headers: { 'Content-Type': 'image/jpeg' } });
  if (data?.csv)
    return new Response(data.csv, { headers: { 'Content-Type': 'text/csv;charset=utf-8' } });
  return Response.json(data);
}

export async function apiBlob(path, options = {}) {
  return (await apiFetch(path, options)).blob();
}

export async function apiUpload(path, { body, headers = {}, onProgress, signal } = {}) {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  if (simulation.state.failNext) {
    simulation.state.failNext = false;
    throw new Error('演示：照片上传失败，请重试。');
  }
  const orderId = path.split('/')[3];
  const id = crypto.randomUUID();
  onProgress?.({ loaded: Math.round(body.size / 2), total: body.size });
  await new Promise((resolve) => setTimeout(resolve, 180));
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  const attachment = {
    id,
    appointmentId: orderId,
    filename: decodeURIComponent(headers['X-Attachment-Filename'] || body.name || '演示照片.jpg'),
    size: body.size,
    purpose: headers['X-Attachment-Purpose'] || 'general'
  };
  simulation.state.attachments[orderId] ||= [];
  simulation.state.attachments[orderId].push(attachment);
  onProgress?.({ loaded: body.size, total: body.size });
  window.dispatchEvent(
    new CustomEvent('tutorial-request', { detail: { path, method: 'POST', payload: attachment } })
  );
  return attachment;
}
