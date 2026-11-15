import { uploadImage } from '../../../shared/image-compress.js';

export function intakePhotoError(file: File): string {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)
    return '请选择不超过 5 MB 的 JPEG、PNG 或 WebP 照片';
  if (!file.size) return '照片文件为空，请重新选择';
  return '';
}

// Keep the original for preview; every uploaded copy goes through compression.
export async function intakePhoto(file: File): Promise<File> {
  const error = intakePhotoError(file);
  if (error) throw new Error(error);
  return uploadImage(file);
}
