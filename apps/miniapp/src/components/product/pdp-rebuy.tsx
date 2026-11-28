import { fillCopy } from '@tubutree/app-core/shop-copy';
import '../../css/declutter.css';

export interface PdpRebuyRowProps {
  /** "dd/mm" của lần mua (đơn đã giao) gần nhất, từ `pdpRebuy`. */
  dateLabel: string;
  /** Tên phân loại lần trước, để nhãn đọc nói rõ nút thêm phân loại nào. */
  variationName: string;
  busy: boolean;
  /** Một lệnh ghi giỏ khác của trang đang chạy (chung khoá): báo bằng aria-disabled, không `disabled`, để nút đang giữ focus không rớt focus. */
  blocked: boolean;
  onRebuy: () => void;
}

/**
 * Một dòng nhỏ "Bạn đã mua ngày dd/mm · Mua lại" (w47-01: nút chữ, không còn nút viền): một chạm thêm đúng phân loại lần trước, số lượng 1. Không tranh với
 * nút mua ở thanh dưới; gói Refill và Đặt định kỳ nằm ở dải chọn cách mua ngay sau dòng này (`PdpBuyModes`).
 */
export function PdpRebuyRow({ dateLabel, variationName, busy, blocked, onRebuy }: PdpRebuyRowProps) {
  return (
    <div data-pdp-block="rebuy" className="tubu-rebuy">
      <p className="tubu-rebuy-text">{fillCopy('pdp.rebuyLine', { date: dateLabel })}</p>
      <button
        type="button"
        className="tubu-rebuy-cta tubu-press tubu-hit-44"
        aria-busy={busy || undefined}
        aria-disabled={blocked || busy || undefined}
        aria-label={fillCopy('pdp.rebuySpoken', { name: variationName, date: dateLabel })}
        onClick={() => {
          if (blocked || busy) return;
          onRebuy();
        }}
      >
        {fillCopy('pdp.rebuyCta')}
      </button>
    </div>
  );
}
