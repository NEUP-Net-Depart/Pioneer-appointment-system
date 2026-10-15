// Keep the original preview for verification; resize only the uploaded copy.
// This respects the existing intake endpoint's 2 MB limit.
export async function intakePhoto(file: File): Promise<File> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("请选择不超过 5 MB 的 JPEG、PNG 或 WebP 照片");
  if (file.size <= 2 * 1024 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= 2 * 1024 * 1024)
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
          type: "image/jpeg",
        });
    }
    throw new Error("照片压缩后仍过大，请选择较小的照片");
  } finally {
    bitmap.close();
  }
}
