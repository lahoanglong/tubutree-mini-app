/**
 * Sao chép văn bản, trả về việc nó có THẬT SỰ vào clipboard hay không.
 *
 * Trong webview Zalo, `navigator.clipboard.writeText` có thể vắng mặt hoặc bị từ chối quyền.
 * Nhiều màn trước đây gọi kiểu bắn-rồi-quên (`void writeText(...)`) rồi báo "Đã sao chép" ngay —
 * khách tin là đã chép, dán ra nội dung cũ: sai số tài khoản khi chuyển khoản, sai mã giảm giá,
 * sai mã giới thiệu. Có nơi ngược lại: không có clipboard thì `return` im lặng, chạm vào không
 * có gì xảy ra và cũng không nói vì sao.
 *
 * Dùng `execCommand('copy')` làm phương án hai vì webview cũ vẫn hỗ trợ.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* rơi xuống phương án hai */
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const el = document.createElement('textarea');
  el.value = text;
  // Ngoài màn hình nhưng vẫn focus được — `display:none` thì execCommand không chép được gì.
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.top = '-1000px';
  el.style.opacity = '0';
  document.body.appendChild(el);
  try {
    el.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(el);
  }
}
