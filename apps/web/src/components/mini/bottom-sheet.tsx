'use client';

// Nguồn: apps/miniapp/src/components/ui/bottom-sheet.tsx (zmp Sheet thay bằng DOM cùng kiểu, CSS ở mini.css);
// bẫy focus/Esc/khoá cuộn theo apps/web/src/components/ui/sheet.tsx
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Heading, Text } from './text';
import { IconButton } from './icon-button';

export type BottomSheetSize = 'auto' | 'half' | 'full';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  footer?: ReactNode;
  size?: BottomSheetSize;
  dismissible?: boolean;
  children: ReactNode;
}

const SIZE_HEIGHT: Record<BottomSheetSize, string | undefined> = { auto: undefined, half: '50vh', full: '92vh' };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Chỉ sheet trên cùng xử lý bàn phím; bộ đếm khoá cuộn để đóng sai thứ tự không trả overflow sai.
const openStack: symbol[] = [];
let scrollLocks = 0;
let savedOverflow = '';

/**
 * Sheet chuẩn của design system, cùng API với bản Mini App. Safe-area đáy nằm ở khung ngoài một lần (như zmp Sheet),
 * nên phần thân/chân KHÔNG tự cộng thêm. `dismissible=false` chặn cả nút X, Esc và bấm nền. Không dựng khi đóng
 * (không có hoạt ảnh trượt xuống), nên không có nội dung ẩn trong cây truy cập.
 */
export function BottomSheet({ open, onClose, title, description, footer, size = 'auto', dismissible = true, children }: BottomSheetProps) {
  const uid = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const id = Symbol('bottom-sheet');
    openStack.push(id);
    if (scrollLocks++ === 0) savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const items = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (items()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id) return;
      // Hộp modal khác mở sau (portal cuối DOM) giữ bàn phím.
      const modals = document.querySelectorAll('[aria-modal="true"]');
      if (modals[modals.length - 1] !== panel) return;
      if (e.key === 'Escape' && dismissibleRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = openStack.indexOf(id);
      if (at >= 0) openStack.splice(at, 1);
      if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  const titleId = `${uid}-title`;
  const height = SIZE_HEIGHT[size];
  return createPortal(
    <div className="mini-sheet-root">
      <div data-sheet-backdrop className="mini-sheet-mask" onClick={dismissible ? onClose : undefined} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className="mini-sheet-panel"
        data-hug={size === 'auto' ? '' : undefined}
        style={height ? { height } : undefined}
      >
        <div className="mini-sheet-handler" aria-hidden />
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {title && <Heading variant="title-md" as="h2" id={titleId}>{title}</Heading>}
            {dismissible && <IconButton icon={X} label="Đóng" onPress={onClose} style={{ marginLeft: 'auto' }} />}
          </div>
          {description && <Text variant="body-sm" tone="secondary">{description}</Text>}
        </div>
        <div data-testid="bottom-sheet-body" style={{ padding: '0 16px 16px', overflowY: 'auto', flex: '1 1 auto' }}>
          {children}
        </div>
        {footer && <div style={{ padding: 16, borderTop: '1px solid var(--color-border-subtle)' }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Cùng API với `BottomSheet` — dùng cho xác nhận/cảnh báo ngắn (như Mini App). */
export const Dialog = BottomSheet;
