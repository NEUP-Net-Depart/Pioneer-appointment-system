import { uploadImage } from '../../../shared/image-compress.js';

// Keep the original for preview; every uploaded copy goes through compression.
export async function intakePhoto(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw new Error('请选择不超过 5 MB 的 JPEG、PNG 或 WebP 照片');
  return uploadImage(file);
}
