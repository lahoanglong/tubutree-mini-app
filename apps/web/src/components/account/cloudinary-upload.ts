// Next chỉ nhúng biến NEXT_PUBLIC_* khi viết nguyên dạng `process.env.NEXT_PUBLIC_X`, nên không gom vào một hàm đọc theo tên.
const cloudName = () => (process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '').trim();
const uploadPreset = () => (process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? '').trim();

/** Bản build có dịch vụ lưu ảnh (Cloudinary) không. Ảnh đại diện chỉ lưu được dạng URL nên cần có nó. */
export const isCloudinaryConfigured = (): boolean => Boolean(cloudName() && uploadPreset());

/** Ảnh gốc quá lớn thì không đưa lên (cùng ngưỡng với Mini App). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Tải một ảnh lên Cloudinary (preset unsigned) → secure_url; chưa cấu hình hoặc lỗi thì null để nơi gọi tự báo. */
export async function uploadToCloudinary(file: File | Blob): Promise<string | null> {
  if (!isCloudinaryConfigured()) return null;
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', uploadPreset());
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName()}/image/upload`, { method: 'POST', body: form });
    if (!res.ok) return null;
    const data = (await res.json()) as { secure_url?: string };
    return data.secure_url ?? null;
  } catch {
    return null;
  }
}
