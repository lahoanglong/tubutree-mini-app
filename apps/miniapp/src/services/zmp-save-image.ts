import { saveImageToGallery } from 'zmp-sdk/apis';

/**
 * Lưu ảnh từ URL vào thư viện ảnh của máy (Zalo mobile từ bản 2.16). Ngoài Zalo hoặc bị từ chối thì reject.
 * Tách file riêng và nạp lười: chỉ màn chuyển khoản dùng, không nằm trong gói đầu.
 */
export async function saveImageFromUrl(url: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      saveImageToGallery({ imageUrl: url }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('saveImageToGallery timeout')), 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
