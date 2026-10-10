import { apiJson } from './api.js';
export function attachmentSize(size) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
export function attachmentUrl(appointmentId, id) {
  const path = `/api/appointments/${encodeURIComponent(appointmentId)}/attachments/${encodeURIComponent(id)}`;
  return path;
}
export async function uploadAttachments(appointment, files) {
  for (const file of files) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await apiJson(`/api/appointments/${encodeURIComponent(appointment.id)}/attachments`, {
      method: 'POST', headers: { 'X-Appointment-Token':appointment.accessToken }, json: { filename:file.name,mimeType:file.type,data }
    });
  }
}
