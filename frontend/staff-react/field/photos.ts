import { uploadImage } from '../../../shared/image-compress.js';
import { inspectImage } from '../../../shared/image-input.js';

async function photoError(file: File): Promise<string> {
  try {
    await inspectImage(file);
    return '';
  } catch (error) {
    return error.message;
  }
}

export async function supplementalPhotoError(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) return '请选择照片文件';
  return photoError(file);
}

export async function intakePhotoError(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return '请选择 JPEG、PNG 或 WebP 照片';
  return photoError(file);
}

// Keep the original for preview; every uploaded copy goes through compression.
export async function intakePhoto(file: File): Promise<File> {
  const error = await intakePhotoError(file);
  if (error) throw new Error(error);
  return uploadImage(file);
}
