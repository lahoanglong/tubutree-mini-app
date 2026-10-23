import type { KeyboardEvent } from 'react';

function activateOnKey(e: KeyboardEvent<HTMLElement>, keys: readonly string[]) {
  // Chỉ phím bấm TRÊN hàng: phím từ nút/ô nhập lồng bên trong tự xử lý, tránh bắn đôi.
  if (e.target !== e.currentTarget || e.repeat) return;
  if (keys.includes(e.key)) {
    e.preventDefault();
    e.currentTarget.click();
  }
}

/** Props bàn phím cho hàng tự làm `role="radio"|"checkbox"|"switch"` có `onClick` ở chính hàng.
 * Hàng thành điểm dừng Tab và Enter/Space gọi lại đúng `onClick` của nó, nên mọi logic chọn/bật tắt
 * giữ nguyên ở một chỗ. Cần khi chấm chọn Checkbox/Radio/Switch bên trong không có tên (bị ẩn khỏi Tab,
 * xem `form.tsx`), vì khi đó hàng cha là control duy nhất mà người dùng bàn phím tới được. */
export function rowKeyboardProps() {
  return { tabIndex: 0, onKeyDown: (e: KeyboardEvent<HTMLElement>) => activateOnKey(e, ['Enter', ' ']) } as const;
}

/** Như `rowKeyboardProps` nhưng cho `role="link"`: liên kết chỉ kích hoạt bằng Enter, Space để trình duyệt cuộn trang. */
export function linkKeyboardProps() {
  return { tabIndex: 0, onKeyDown: (e: KeyboardEvent<HTMLElement>) => activateOnKey(e, ['Enter']) } as const;
}
