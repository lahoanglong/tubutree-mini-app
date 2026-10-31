let installed = false;

/**
 * iOS WebKit (kể cả webview Zalo) chỉ áp `:active` khi phần tử hoặc tổ tiên có listener `touchstart`. Trước đây chỉ vùng cuộn có
 * (pull-to-refresh), nên sheet và thanh dính đáy có thể không co khi nhấn. Một listener passive rỗng ở `document` phủ tất cả,
 * không chặn cuộn. Gọi lại không gắn thêm; trả hàm gỡ.
 */
export function installPressFeedback(doc: Document | null = typeof document === 'undefined' ? null : document): () => void {
  if (!doc || installed) return () => {};
  const noop = () => {};
  doc.addEventListener('touchstart', noop, { passive: true });
  installed = true;
  return () => {
    doc.removeEventListener('touchstart', noop);
    installed = false;
  };
}
