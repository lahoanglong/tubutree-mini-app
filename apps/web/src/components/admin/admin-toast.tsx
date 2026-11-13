'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { NOTICE_CLASS } from './ui';

export type AdminToastTone = 'success' | 'info' | 'danger';
export interface AdminMsg {
  ok: boolean;
  text: string;
}

interface ToastItem {
  id: number;
  tone: AdminToastTone;
  text: string;
}

const MAX_VISIBLE = 4;
// Lỗi không tự tắt: admin đang bận ở hàng khác của bảng thì lỗi biến mất là mất luôn dấu vết việc chưa làm được. Thành công thì tự tắt.
const AUTO_DISMISS_MS: Record<AdminToastTone, number | null> = { success: 5000, info: 5000, danger: null };

const AdminToastContext = createContext<{ show: (text: string, tone?: AdminToastTone) => void } | null>(null);

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  // Rê chuột hoặc đưa focus vào thẻ thì dừng đếm: đang đọc dở không bị cuốn mất.
  const [paused, setPaused] = useState(false);
  const ms = AUTO_DISMISS_MS[item.tone];
  useEffect(() => {
    if (ms === null || paused) return;
    const timer = setTimeout(() => onDismiss(item.id), ms);
    return () => clearTimeout(timer);
  }, [ms, paused, item.id, onDismiss]);
  return (
    <div
      data-admin-toast={item.tone}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`pointer-events-auto flex items-start gap-2 break-words rounded-control border px-3 py-2 text-sm leading-relaxed shadow-raised ${NOTICE_CLASS[item.tone === 'danger' ? 'danger' : item.tone === 'success' ? 'success' : 'info']}`}
    >
      <span className="min-w-0 flex-1 py-1">{item.text}</span>
      <button
        type="button"
        aria-label="Đóng thông báo"
        onClick={() => onDismiss(item.id)}
        className="-my-1 -mr-1 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-control hover:brightness-90 sm:min-h-8 sm:min-w-8"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Vùng thông báo nổi cho khu quản trị. Phản hồi inline đứng đầu tab nằm ngoài tầm mắt khi admin bấm ở hàng cuối bảng hay lưu trong ngăn kéo dài:
 * toast bám khung nhìn nên luôn thấy. Điện thoại đặt ở TRÊN (đáy là nơi nút Lưu/Đóng dính của ngăn kéo); từ `sm` về góc dưới phải.
 *
 * Vùng `aria-live="polite"` có mặt sẵn từ lúc dựng trang, vì trình đọc màn hình chỉ đọc nội dung thêm vào một vùng đã có.
 * Dựng trong app/admin/layout.tsx; thiếu provider thì `useAdminToast` trả `active: false` và nơi gọi giữ thông báo inline.
 */
export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);
  const show = useCallback((text: string, tone: AdminToastTone = 'info') => {
    const id = nextId.current++;
    setItems((cur) => [...cur, { id, tone, text }].slice(-MAX_VISIBLE));
  }, []);
  const ctx = useMemo(() => ({ show }), [show]);
  return (
    <AdminToastContext.Provider value={ctx}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        data-admin-toast-region
        className="pointer-events-none fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] z-[105] flex flex-col gap-2 sm:inset-x-auto sm:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:right-4 sm:top-auto sm:w-96"
      >
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </AdminToastContext.Provider>
  );
}

const noop = () => {};

/** `active`: có AdminToastProvider bên trên (thiếu thì `show` không làm gì). */
export function useAdminToast(): { show: (text: string, tone?: AdminToastTone) => void; active: boolean } {
  const ctx = useContext(AdminToastContext);
  return useMemo(() => ({ show: ctx?.show ?? noop, active: !!ctx }), [ctx]);
}

/**
 * Đẩy thông báo `{ ok, text }` của tab lên toast và trả phần CÒN LẠI để vẽ inline: có toast thì `null` (không đọc hai lần), không có provider thì trả
 * nguyên `msg` như cũ. `successOnly`: chỉ chuyển thành công; lỗi vẫn inline (ngăn kéo có chân dính ngay cạnh nút Lưu, nơi lỗi đứng cạnh việc cần sửa).
 * Mỗi lần `setMsg` tạo đối tượng mới nên cùng một chữ bấm lần hai vẫn hiện lại.
 */
export function useToastedMessage(msg: AdminMsg | null, opts: { successOnly?: boolean } = {}): AdminMsg | null {
  const { show, active } = useAdminToast();
  const mirrored = active && !!msg && (!opts.successOnly || msg.ok);
  const lastShown = useRef<AdminMsg | null>(null);
  useEffect(() => {
    if (!mirrored || !msg || lastShown.current === msg) return;
    lastShown.current = msg;
    show(msg.text, msg.ok ? 'success' : 'danger');
  }, [mirrored, msg, show]);
  return mirrored ? null : msg;
}
