/**
 * Lưu một ảnh về máy. Ảnh QR VietQR nằm ở tên miền khác nên thuộc tính `download` của thẻ <a> bị trình duyệt bỏ qua;
 * tải qua fetch thành blob thì mới đặt được tên file. Nếu máy chủ ảnh không cho đọc chéo miền (CORS) hay mất mạng thì
 * mở ảnh ở tab mới để khách nhấn giữ lưu — vẫn hơn là không có đường nào.
 */
export type SaveImageResult = 'saved' | 'opened';

export async function saveImage(url: string, filename: string): Promise<SaveImageResult> {
  try {
    const res = await fetch(url);
    if (!res.ok || typeof URL.createObjectURL !== 'function') throw new Error('không tải được ảnh');
    const objectUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Trình duyệt chưa kịp đọc blob nếu thu hồi ngay trong cùng tick.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    return 'saved';
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
    return 'opened';
  }
}
