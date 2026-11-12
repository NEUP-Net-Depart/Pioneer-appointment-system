import { apiJson } from '../../../shared/api.js';
import { uploadAttachments } from '../../../shared/attachments.js';
import { intakePhoto } from './photos';
import type { Appointment } from './types';

export type PhotoProgress = { value?: number; label: string };
type Snapshot = {
  files: Record<string, File>;
  uploaded: Record<string, string>;
  progress: Record<string, PhotoProgress>;
  uploading: boolean;
  linking: boolean;
  canSkip: boolean;
  error: string;
};
const sides = ['front', 'back'];
const jobs = new Map<string, ReturnType<typeof createUpload>>();

// A job belongs to the login session and order, not to a modal's lifetime.
export function intakeUpload(id: string, onSaved: () => void) {
  const token = sessionStorage.getItem('pioneerToken');
  const key = `${token}:${id}`;
  let job = jobs.get(key);
  if (!job) {
    job = createUpload(id, token, onSaved);
    jobs.set(key, job);
  }
  return job;
}

function createUpload(id: string, token: string, onSaved: () => void) {
  let state: Snapshot = {
    files: {},
    uploaded: {},
    progress: {},
    uploading: false,
    linking: false,
    canSkip: false,
    error: ''
  };
  const listeners = new Set<() => void>();
  let task: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deferred = false;
  let linkTask: Promise<void> | undefined;
  let linkAgain = false;
  const update = (patch: Partial<Snapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const session = () => {
    if (!token || sessionStorage.getItem('pioneerToken') !== token)
      throw new Error('登录状态已改变，请重新打开工单后补传照片。');
  };
  const photoIds = () => ({
    frontPhotoId: state.uploaded.front || undefined,
    backPhotoId: state.uploaded.back || undefined
  });
  function confirm(item: Appointment) {
    const files = { ...state.files },
      uploaded = { ...state.uploaded };
    for (const side of sides) {
      const saved = item[`${side}PhotoId`];
      if (saved) {
        uploaded[side] = saved;
        delete files[side];
      }
    }
    update({ files, uploaded });
    deferred = !!item.canSupplement;
    if (!deferred) {
      clearTimeout(timer);
      update({ canSkip: false });
    }
  }
  function link() {
    if (!deferred) return Promise.resolve();
    linkAgain = true;
    if (linkTask) return linkTask;
    update({ linking: true });
    linkTask = (async () => {
      while (linkAgain && deferred) {
        linkAgain = false;
        // A repair can advance while photos are in flight. Always read its
        // current revision and never replace photos already associated by it.
        for (let attempt = 0; attempt < 2; attempt++) {
          session();
          const item: Appointment = await apiJson(
            `/api/field/appointments/${encodeURIComponent(id)}`
          );
          session();
          const missing = Object.fromEntries(
            sides.flatMap((side) =>
              !item[`${side}PhotoId`] && state.uploaded[side]
                ? [[`${side}PhotoId`, state.uploaded[side]]]
                : []
            )
          );
          if (!Object.keys(missing).length) {
            confirm(item);
            break;
          }
          if (!item.canSupplement)
            throw new Error('当前账号不能补传本单照片，请由首次接收经办人处理。');
          try {
            const saved: Appointment = await apiJson(
              `/api/appointments/${encodeURIComponent(id)}/photos`,
              {
                method: 'POST',
                json: { ...missing, revision: item.revision, requestId: crypto.randomUUID() }
              }
            );
            session();
            confirm(saved);
            onSaved();
            break;
          } catch (error) {
            if (error.status !== 409 || attempt) throw error;
          }
        }
      }
    })()
      .catch((error) => {
        update({ error: `照片关联工单失败：${error.message} 已上传照片会保留，可重试补传。` });
      })
      .finally(() => {
        linkTask = undefined;
        update({ linking: false });
      });
    return linkTask;
  }
  async function upload(partial = false) {
    if (task) {
      await task;
      return;
    }
    session();
    if (!partial && sides.some((side) => !state.files[side] && !state.uploaded[side]))
      throw new Error('请先拍摄正反面两张照片');
    const selected = sides.filter((side) => state.files[side] && !state.uploaded[side]);
    if (!selected.length) return;
    clearTimeout(timer);
    update({ uploading: true, canSkip: false, error: '' });
    // This timer only unlocks the workflow; it never aborts the upload.
    timer = setTimeout(() => update({ canSkip: true }), 30000);
    task = (async () => {
      const failures: string[] = [];
      await Promise.all(
        selected.map(async (side) => {
          const progress = (value: PhotoProgress) =>
            update({ progress: { ...state.progress, [side]: value } });
          try {
            progress({ label: '正在压缩' });
            const file = await intakePhoto(state.files[side]);
            session();
            progress({ value: 0, label: '正在上传' });
            const [attachment] = await uploadAttachments({ id }, [file], `intake_${side}`, {
              onProgress: ({ loaded, total }) =>
                progress({
                  value: Math.min(99, Math.floor((loaded / Math.max(1, total)) * 100)),
                  label: loaded >= total ? '等待保存' : '正在上传'
                })
            });
            session();
            update({ uploaded: { ...state.uploaded, [side]: attachment.id } });
            progress({ value: 100, label: '已上传' });
            void link();
          } catch (error) {
            const message = `${side === 'front' ? '正面' : '背面'}：${error.message || '照片上传失败，请重试。'}`;
            failures.push(message);
            progress({ value: state.progress[side]?.value ?? 0, label: '上传失败' });
            update({ error: failures.join('；') });
          }
        })
      );
      if (!failures.length) {
        clearTimeout(timer);
        update({ canSkip: false });
      }
    })().finally(() => {
      task = undefined;
      update({ uploading: false });
    });
    await task;
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => state,
    photoIds,
    seed(item: Appointment) {
      const uploaded = { ...state.uploaded };
      for (const side of sides)
        if (!state.files[side] && item[`${side}PhotoId`]) uploaded[side] = item[`${side}PhotoId`];
      update({ uploaded });
    },
    select(side: string, file: File) {
      if (state.uploading || state.linking) return;
      clearTimeout(timer);
      update({
        files: { ...state.files, [side]: file },
        uploaded: { ...state.uploaded, [side]: '' },
        progress: { ...state.progress, [side]: { value: 0, label: '待上传' } },
        canSkip: false,
        error: ''
      });
    },
    upload,
    confirmed(item: Appointment) {
      confirm(item);
      void link();
    },
    async supplement() {
      update({ error: '' });
      if (!sides.some((side) => state.files[side] || state.uploaded[side]))
        throw new Error('请选择首次接收时保存的照片');
      deferred = true;
      await upload(true);
      await link();
      if (state.error) throw new Error(state.error);
    }
  };
}
