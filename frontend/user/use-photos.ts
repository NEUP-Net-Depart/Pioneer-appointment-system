import { useEffect, useRef } from 'react';
import { compressImage } from '../../shared/image-compress.js';
import { attachmentSize, uploadAttachments } from '../../shared/attachments.js';
import { failureFrom } from './api';
import { useCurrent } from './use-current';
import type { Attachment, Credential } from './types';

export interface Photo {
  id: string;
  version: number;
  name: string;
  state: 'preparing' | 'ready' | 'error' | 'uploading' | 'uploaded' | 'upload-error';
  message: string;
  progress: number;
  file?: File;
  url?: string;
  attachment?: Attachment;
}

export function usePhotos(existingCount = 0) {
  const [entries, setEntries, current] = useCurrent<Photo[]>([]);
  const [error, setError] = useCurrent('');
  const task = useRef<Promise<void> | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const version = useRef(0);
  const paused = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const revoke = (entry: Photo) => {
    if (entry.url) URL.revokeObjectURL(entry.url);
  };
  useEffect(
    () => () => {
      version.current++;
      controller.current?.abort();
      current.current.forEach(revoke);
    },
    [current]
  );

  function patch(id: string, update: Partial<Photo>) {
    setEntries(current.current.map((entry) => (entry.id === id ? { ...entry, ...update } : entry)));
  }

  async function prepare(entry: Photo, file: File) {
    const revision = entry.version + 1;
    const epoch = version.current;
    const isCurrent = () =>
      epoch === version.current &&
      current.current.some(
        (candidate) => candidate.id === entry.id && candidate.version === revision
      );
    revoke(entry);
    patch(entry.id, {
      version: revision,
      state: 'preparing',
      message: '正在准备照片…',
      file: undefined,
      url: undefined,
      name: file.name,
      progress: 0
    });
    try {
      const prepared = await compressImage(file, {
        strict: true,
        onProgress({ value, label }: { value: number; label: string }) {
          if (isCurrent()) patch(entry.id, { progress: value, message: label });
        }
      });
      if (isCurrent())
        patch(entry.id, {
          file: prepared.file,
          url: URL.createObjectURL(prepared.file),
          state: 'ready',
          message: '照片已准备好 · ' + attachmentSize(prepared.file.size)
        });
    } catch (failure) {
      if (isCurrent()) patch(entry.id, { state: 'error', message: failureFrom(failure).message });
    }
  }

  function add(files: File[]) {
    const remaining =
      4 - existingCount - current.current.filter((entry) => !entry.attachment).length;
    if (files.length > remaining) {
      setError(
        '最多 4 张照片，还可添加 ' + Math.max(0, remaining) + ' 张。请重新选择，没有照片被添加。'
      );
      return;
    }
    setError('');
    for (const file of files) {
      const entry: Photo = {
        id: crypto.randomUUID(),
        version: 0,
        name: file.name,
        state: 'preparing',
        message: '正在准备照片…',
        progress: 0
      };
      setEntries([...current.current, entry]);
      void prepare(entry, file);
    }
  }

  function remove(entry: Photo) {
    revoke(entry);
    setEntries(current.current.filter((photo) => photo.id !== entry.id));
    setError('');
  }

  function validity() {
    const invalid = current.current.find(
      (entry) => entry.state === 'error' || entry.state === 'preparing'
    );
    setError(
      invalid
        ? invalid.state === 'preparing'
          ? '照片正在准备，请稍候再继续。'
          : '有照片准备失败，请替换或删除后继续。'
        : ''
    );
    if (invalid) addButton.current?.focus();
    return !invalid;
  }

  async function uploadAll(appointment: Credential) {
    if (task.current) return task.current;
    paused.current = false;
    const revision = version.current;
    const abort = new AbortController();
    controller.current = abort;
    task.current = (async () => {
      for (const entry of current.current) {
        if (paused.current || revision !== version.current) break;
        if (entry.attachment || !entry.file) continue;
        patch(entry.id, { state: 'uploading', message: '正在上传…' });
        try {
          const [attachment]: Attachment[] = await uploadAttachments(
            appointment,
            [entry.file],
            'student_photo',
            { signal: abort.signal }
          );
          if (revision !== version.current) return;
          patch(entry.id, { attachment, state: 'uploaded', message: '已上传' });
        } catch (failure) {
          if (revision !== version.current) return;
          patch(entry.id, {
            state: 'upload-error',
            message: failureFrom(failure).message || '上传失败，请重试。'
          });
        }
      }
    })();
    try {
      await task.current;
    } finally {
      if (revision === version.current) {
        task.current = undefined;
        controller.current = undefined;
      }
    }
  }

  return {
    entries,
    current,
    error,
    add,
    remove,
    prepare,
    addButton,
    validity,
    uploadAll,
    full: entries.filter((entry) => !entry.attachment).length + existingCount >= 4,
    pauseUpload() {
      paused.current = true;
    },
    reset() {
      version.current++;
      task.current = undefined;
      paused.current = true;
      controller.current?.abort();
      current.current.forEach(revoke);
      setEntries([]);
      setError('');
    }
  };
}

export type Photos = ReturnType<typeof usePhotos>;
