import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Sheet } from 'zmp-ui';
import { X } from 'lucide-react';
import { Heading, Text } from './text';
import { IconButton } from './icon-button';

/** Lớn hơn ANIMATION_DURATION (200ms) trong zmp-ui/esm/components/sheet/content.js. */
const REOPEN_REMOUNT_MS = 300;

export type BottomSheetSize = 'auto' | 'half' | 'full';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Chỉ sheet mở sau cùng (trên cùng) nhận Esc/Tab; sheet chồng nhau không đóng cùng một lúc.
const openStack: symbol[] = [];

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

interface SheetSizeConfig {
  height?: string;
  autoHeight?: boolean;
}

// 'auto' phải HUG nội dung: ZaUI Sheet mặc định `min-height:50%` (xem sheet.css) dù không truyền
// `height`, nên nếu không bật `autoHeight` thì "auto" vẫn hở nửa màn hình cho sheet ngắn. Bật
// `autoHeight` gắn class `zaui-sheet-content-hug-content` (height:auto;min-height:unset).
const SIZE_CONFIG: Record<BottomSheetSize, SheetSizeConfig> = {
  auto: { autoHeight: true },
  half: { height: '50vh' },
  full: { height: '92vh' },
};

/**
 * Sheet chuẩn của design system — thay cho 48 chỗ tự dựng `<Sheet>` của ZaUI rải rác khắp app.
 *
 * AN TOÀN VÙNG (safe-area) — audit A4-20:
 * Đã đọc trực tiếp mã nguồn thật của `zmp-ui@1.11.14` (không suy đoán từ brief):
 *   - `node_modules/zmp-ui/sheet/styles/sheet.css`:
 *     `.zaui-sheet-content{ ...padding-bottom:var(--zaui-safe-area-inset-bottom) }`
 *     — đây là div NGOÀI CÙNG do `Sheet` tự dựng (bọc handler + header + toàn bộ `children`,
 *     xem `esm/components/sheet/content.js`), nên padding này áp dụng đúng MỘT LẦN, sau tất cả
 *     nội dung (kể cả `footer` bên dưới) — không cần và KHÔNG ĐƯỢC tự cộng thêm safe-area nữa.
 *   - `node_modules/zmp-ui/app/styles/app.css` (`:root`):
 *     `--zaui-safe-area-inset-bottom: env(safe-area-inset-bottom, 0px)` — CÙNG công thức với
 *     `--safe-bottom` của app (`apps/miniapp/src/css/tokens.css`), chỉ khác tên biến.
 *   → Xác nhận audit A4-20 ĐÚNG: ZaUI Sheet tự thêm safe-area. 20/48 sheet cũ (vd `share-sheet.tsx`,
 *     `checkout/voucher-sheet.tsx`) tự cộng thêm `calc(16px + var(--safe-bottom))` NGOÀI phần này
 *     → hở đáy gấp đôi trên iPhone có home indicator.
 * Wrapper này CHỦ Ý không có bất kỳ `safe-bottom`/`env(safe-area-inset-bottom)` nào trong style —
 * chỉ padding cố định (16px). Nếu sau này thấy sheet hở đáy, đừng thêm safe-area ở đây; kiểm tra
 * lại CSS gốc của ZaUI trước (có thể đã đổi hành vi ở version khác).
 *
 * API thật của ZaUI `Sheet` (đọc `node_modules/zmp-ui/sheet/index.d.ts`, KHÔNG đoán): props đúng
 * là `visible`/`onClose`/`height` như brief giả định (khớp cách `share-sheet.tsx` và
 * `checkout/voucher-sheet.tsx` đã dùng) — không có `open`/`onDismiss` nào khác.
 *
 * VÒNG ĐỜI ĐÓNG/MỞ: KHÔNG `if (!open) return null` — làm vậy sẽ unmount cả cây DOM ngay trong
 * cùng 1 render, bỏ qua animation trượt-xuống mà ZaUI tự chạy khi đóng (mọi sheet hiện có trong
 * app, vd `share-sheet.tsx`/`voucher-sheet.tsx`, đều giữ `<Sheet visible>` mounted và chỉ đổi
 * `visible` để animation này chạy). Thay vào đó truyền `unmountOnClose` cho `Sheet` — đọc
 * `esm/components/sheet/sheet.js`: khi `unmountOnClose`, `contentVisible` khởi tạo `false` nên
 * lần đầu `open=false` Sheet tự trả `null` (không có gì trong DOM, giống hệt hành vi trước đây),
 * còn khi `open` chuyển true→false thì Sheet vẫn giữ nội dung mounted đủ lâu để chạy hết animation
 * trượt xuống (200ms, `ANIMATION_DURATION`) rồi mới thực sự gỡ khỏi DOM.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'auto',
  dismissible = true,
  children,
}: BottomSheetProps) {
  const sizeConfig = SIZE_CONFIG[size];
  const titleId = `${useId()}-title`;
  // Nội dung ZaUI có thể dựng muộn một nhịp sau `open`, nên khung lấy bằng callback ref chứ không dùng ref + effect theo `open`.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  // Nhớ nơi đang focus lúc mở và trả lại khi đóng (WCAG 2.4.3): chạy trước effect chuyển focus vào khung.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    return () => opener?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open || !panel) return;
    const id = Symbol('bottom-sheet');
    openStack.push(id);
    const items = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    (items()[0] ?? panel).focus();

    const onKey = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id) return;
      if (e.key === 'Escape' && dismissibleRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
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
    };
  }, [open, panel]);

  // ZaUI hẹn setTimeout(200ms) sau khi đóng để gỡ nội dung và không huỷ hẹn giờ đó khi mở lại: mở lại trong
  // khoảng này thì nội dung bị gỡ trong lúc `open` vẫn true (sheet biến mất, nút mở bấm không còn tác dụng).
  // Mở lại khi hẹn giờ cũ có thể còn treo → dựng Sheet mới, hẹn giờ cũ chỉ chạm bản đã gỡ.
  const [prevOpen, setPrevOpen] = useState(open);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const [instance, setInstance] = useState(0);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setClosedAt(Date.now());
    else if (closedAt !== null && Date.now() - closedAt < REOPEN_REMOUNT_MS) setInstance((n) => n + 1);
  }
  return (
    <Sheet
      key={instance}
      visible={open}
      unmountOnClose
      onClose={dismissible ? onClose : undefined}
      maskClosable={dismissible}
      swipeToClose={dismissible}
      height={sizeConfig.height}
      autoHeight={sizeConfig.autoHeight}
    >
      {/* ZaUI Sheet không có role/aria/focus: hộp thoại dựng ở đây. Là flex dọc để header/thân/chân giữ bố cục như khi còn là con trực tiếp của .zaui-sheet-content. */}
      <div
        ref={setPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, outline: 'none' }}
      >
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {title && <Heading variant="title-md" as="h2" id={titleId}>{title}</Heading>}
            {/* dismissible=false phải chặn CẢ nút X, không chỉ mask-tap/swipe — nút X vẫn hiện mà
                vẫn gọi được onClose thì "dismissible" chỉ là nửa vời, phá vỡ đúng mục đích của prop. */}
            {dismissible && <IconButton icon={X} label="Đóng" onPress={onClose} />}
          </div>
          {description && <Text variant="body-sm" tone="secondary">{description}</Text>}
        </div>
        <div data-testid="bottom-sheet-body" style={{ padding: '0 16px 16px', overflowY: 'auto' }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: 16, borderTop: '1px solid var(--color-border-subtle)' }}>{footer}</div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Cùng API với `BottomSheet` — dùng cho xác nhận/cảnh báo ngắn.
 *
 * Lưu ý: `zmp-ui@1.11.14` THỰC SỰ có component `Modal` riêng (`node_modules/zmp-ui/modal/`) có
 * thể dựng dialog nổi giữa màn hình thật, nhưng nằm NGOÀI phạm vi task này (task chỉ sửa lỗi
 * double-padding an toàn vùng của `Sheet`, audit A4-20). Theo đúng quyết định trong brief, tái
 * dùng `BottomSheet` (size='auto') làm `Dialog` là đủ cho nhu cầu hiện tại — không cần modal giữa
 * màn hình. Nếu sau này cần Dialog thật sự nổi giữa màn hình (desktop-style), nên tách riêng dựa
 * trên ZaUI `Modal` thay vì mở rộng component này.
 */
export const Dialog = BottomSheet;
