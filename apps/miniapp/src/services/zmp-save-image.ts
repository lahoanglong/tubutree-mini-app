import { saveImageToGallery } from 'zmp-sdk/apis';

/**
 * Lưu ảnh từ URL vào thư viện ảnh của máy (Zalo mobile từ bản 2.16). Ngoài Zalo hoặc bị từ chối thì reject.
 * Tách file riêng và nạp lười: chỉ màn chuyển khoản dùng, không nằm trong gói đầu.
 */
export async function saveImageFromUrl(url: string): Promise<void> {
  await Promise.race([
    saveImageToGallery({ imageUrl: url }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('saveImageToGallery timeout')), 30_000)),
  ]);
}
