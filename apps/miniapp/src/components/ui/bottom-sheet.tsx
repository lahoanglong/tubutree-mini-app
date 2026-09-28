import type { ReactNode } from 'react';
import { Sheet } from 'zmp-ui';
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
  if (!open) return null;
  const sizeConfig = SIZE_CONFIG[size];
  return (
    <Sheet
      visible={open}
      onClose={dismissible ? onClose : undefined}
      maskClosable={dismissible}
      swipeToClose={dismissible}
      height={sizeConfig.height}
      autoHeight={sizeConfig.autoHeight}
    >
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {title && <Heading variant="title-md" as="h2">{title}</Heading>}
          <IconButton icon={X} label="Đóng" onPress={onClose} />
        </div>
        {description && <Text variant="body-sm" tone="secondary">{description}</Text>}
      </div>
      <div data-testid="bottom-sheet-body" style={{ padding: '0 16px 16px', overflowY: 'auto' }}>
        {children}
      </div>
      {footer && (
        <div style={{ padding: 16, borderTop: '1px solid var(--color-border-subtle)' }}>{footer}</div>
      )}
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
