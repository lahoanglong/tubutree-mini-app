/**
 * Sao chép văn bản, trả về việc nó có THẬT SỰ vào clipboard hay không (cùng ý với apps/miniapp/src/utils/clipboard.ts).
 *
 * Trình duyệt trong app (Zalo, Facebook) hay chặn `navigator.clipboard`; báo "đã chép" khi chưa chép được thì khách dán
 * nội dung cũ trong clipboard vào app ngân hàng, sai số tài khoản. `execCommand('copy')` là phương án hai cho webview cũ.
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
  // Ngoài màn hình nhưng vẫn focus được: `display:none` thì execCommand không chép được gì.
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
