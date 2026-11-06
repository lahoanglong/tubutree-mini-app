/** Phần của sự kiện phím cần cho các luật dưới đây; `KeyboardEvent` của DOM (React: `e.nativeEvent`) khớp sẵn. */
export interface KeyFacts {
  key: string;
  keyCode?: number;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/**
 * Enter mà bộ gõ tiếng Việt đang dùng để chốt chữ ghép dở: `isComposing`, hoặc `keyCode` 229 (Safari, WKWebView của Zalo bắn
 * Enter sau `compositionend` với 229). Enter này không được gửi form hay bấm nút.
 */
export function isImeEnter(e: KeyFacts): boolean {
  return e.key === 'Enter' && (e.isComposing === true || e.keyCode === 229);
}

/** Ctrl+Enter hoặc ⌘+Enter trong ô soạn chữ nhiều dòng: gửi. Enter thường vẫn xuống dòng; Enter của bộ gõ không tính. */
export function isSubmitShortcut(e: KeyFacts): boolean {
  return e.key === 'Enter' && (e.ctrlKey === true || e.metaKey === true) && !isImeEnter(e);
}
