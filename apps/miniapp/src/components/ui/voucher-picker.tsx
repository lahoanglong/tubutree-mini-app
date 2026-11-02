import type { PickerRow } from '@tubutree/app-core/commerce/voucher-picker';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { VoucherTicket } from './voucher-ticket';

export interface VoucherPickerProps {
  rows: readonly PickerRow[];
  onUse: (code: string) => void;
  onRemove: () => void;
  /** Có thao tác đang chạy hoặc trang chứa đang đổi mã: mọi nút `aria-busy`, không bấm được (hai lần đổi mã không chồng nhau). */
  busy?: boolean;
  /** Mã đang được áp: chỉ nút của mã đó `aria-busy` khi `busy` không bật. */
  pendingCode?: string | null;
}

const NOOP = () => undefined;

/**
 * Danh sách chọn mã ở giỏ và thanh toán, một bản cho Mini App (sheet) và web (sheet dưới md, panel từ md): mỗi mã là một `VoucherTicket`
 * hàng, nhãn nút và lý do do `pickerRows` (app-core) chọn sẵn. Phiếu chưa dùng được không bị làm mờ cả thẻ: chữ lý do giữ đủ tương phản,
 * nút khoá `aria-disabled` (vẫn Tab tới được, đọc được lý do).
 */
export function VoucherPicker({ rows, onUse, onRemove, busy = false, pendingCode = null }: VoucherPickerProps) {
  return (
    <ul aria-label={fillCopy('coupon.pickMine')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
      {rows.map((r) => (
        <li key={r.coupon.code}>
          <VoucherTicket
            variant="row"
            voucher={r.view}
            selected={r.applied}
            saving={r.saving ?? undefined}
            reason={r.reason ?? undefined}
            primary={{
              label: r.label,
              ariaLabel: r.ariaLabel,
              busy: busy || pendingCode === r.coupon.code,
              onClick: r.action === 'use' ? () => onUse(r.coupon.code) : r.action === 'remove' ? onRemove : NOOP,
            }}
          />
        </li>
      ))}
    </ul>
  );
}
