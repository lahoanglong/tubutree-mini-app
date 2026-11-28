'use client';

import { useId, useState } from 'react';
import { Info } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { BottomSheet } from './bottom-sheet';
import { Button } from './button';

export interface PointsToggleNote {
  /** Khoá ổn định của lưu ý (`cap`, `partner`, `converted`, `lock`, `marketplace`); in ra `data-points-note`. */
  key: string;
  text: string;
}

export interface PointsToggleRowProps {
  /**
   * Dùng được: câu một dòng "Dùng 1.200 Điểm Xanh (-1.200đ)" (`pointsOfferText`), cũng là tên đọc của công tắc.
   * Không dùng được (chưa có điểm, đơn khoá điểm): câu trạng thái, vẽ dưới chữ "Điểm Xanh".
   */
  text: string;
  usable: boolean;
  checked: boolean;
  onToggle: () => void;
  /**
   * Lưu ý trần của đơn, hàng đối tác, điểm quy đổi, điểm đang giữ, điểm từ đơn sàn: nằm trong tấm ⓘ để hàng chỉ còn một dòng. Khi không dùng được,
   * lưu ý `partner` (không có thì `cap`) là lý do khoá: vẽ thành dòng phụ thay vì trong tấm.
   */
  notes: readonly PointsToggleNote[];
  /** Tiền một điểm giảm ("1đ"), cho câu giải thích của tấm ⓘ. */
  rate: string;
}

/**
 * Hàng Điểm Xanh ở thanh toán (w47-01), bản web của `apps/miniapp/src/components/checkout/points-toggle-row.tsx` (cùng lớp `.tubu-points-row*`): một
 * dòng chữ, nút ⓘ mở tấm "Cách dùng Điểm Xanh", công tắc (`.tubu-switch`, vùng chạm 44px là nhãn bọc ô) ở cuối. Không dùng được thì không vẽ công tắc:
 * không còn ô tắt giả khi khách chưa có điểm.
 */
export function PointsToggleRow({ text, usable, checked, onToggle, notes, rate }: PointsToggleRowProps) {
  const [info, setInfo] = useState(false);
  const textId = useId();
  // Đơn khoá điểm: lý do (hàng đối tác, trần của đơn) nằm ngay dưới chữ, không giấu sau nút ⓘ; tấm ⓘ không lặp lại câu đó.
  const reason = usable ? null : (notes.find((n) => n.key === 'partner') ?? notes.find((n) => n.key === 'cap') ?? null);
  const sheetNotes = reason ? notes.filter((n) => n !== reason) : notes;
  return (
    <div data-testid="checkout-points" className="tubu-points-row">
      <p id={textId} className="tubu-points-row-text">
        {usable ? (
          text
        ) : (
          <>
            {fillCopy('checkout.pointsTitle')}
            <span className="tubu-points-row-sub">{text}</span>
            {reason && (
              <span className="tubu-points-row-sub" data-points-reason={reason.key}>
                {reason.text}
              </span>
            )}
          </>
        )}
      </p>
      <button
        type="button"
        className="tubu-points-row-info tubu-press"
        aria-label={fillCopy('checkout.pointsInfo')}
        aria-haspopup="dialog"
        onClick={() => setInfo(true)}
      >
        <Info size={18} aria-hidden="true" />
      </button>
      {usable && (
        <label className="tubu-points-row-switch">
          <input type="checkbox" role="switch" className="tubu-switch" checked={checked} aria-labelledby={textId} onChange={onToggle} />
        </label>
      )}
      <BottomSheet
        open={info}
        onClose={() => setInfo(false)}
        title={fillCopy('checkout.pointsInfo')}
        footer={
          <Button fullWidth onPress={() => setInfo(false)}>
            {fillCopy('checkout.pointsInfoDone')}
          </Button>
        }
      >
        <ul data-testid="checkout-points-info" className="tubu-points-notes">
          <li>{fillCopy('checkout.pointsInfoBody', { rate })}</li>
          {sheetNotes.map((n) => (
            <li key={n.key} data-points-note={n.key}>
              {n.text}
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}
