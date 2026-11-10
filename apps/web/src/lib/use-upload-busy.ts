import { useCallback, useState } from 'react';

/**
 * Cờ "đang tải ảnh" cho form có một hay nhiều ô ảnh: nối `onBusyChange` vào mỗi ô, form dùng `busy` để khoá nút Lưu.
 * Mỗi ô báo true rồi false đúng một lần cho mỗi lượt tải, nên ĐẾM lượt đang chạy thay vì giữ một cờ chung: hai ô tải
 * cùng lúc không nhả khoá khi ô đầu xong, và ô bị gỡ rồi dựng lại giữa chừng (lượt cũ vẫn chạy) không làm cờ lệch.
 */
export function useUploadBusy() {
  const [running, setRunning] = useState(0);
  const onBusyChange = useCallback((busy: boolean) => setRunning((n) => Math.max(0, n + (busy ? 1 : -1))), []);
  return { busy: running > 0, onBusyChange };
}
