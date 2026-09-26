'use client';

import { Recycle } from 'lucide-react';
import { RECYCLING_NOTE_MAX, recyclingBookedAfterPayment } from '@/lib/recycling';

/**
 * Lựa chọn "Gửi lại vật liệu tái chế" ở checkout web — cùng nội dung với miniapp (checkout.tsx). Trang
 * cha CHỈ render khi GET /config/public trả recyclingEnabled === true (không hứa thu gom khi không có
 * ai đi thu), và chỉ gửi hasRecyclingPickup/recyclingNote khi khách bật (recyclingCheckoutFields).
 */
export function RecyclingCheckoutSection({
  selected,
  onSelectedChange,
  note,
  onNoteChange,
  paymentMethod,
  disabled,
}: {
  selected: boolean;
  onSelectedChange: (v: boolean) => void;
  note: string;
  onNoteChange: (v: string) => void;
  paymentMethod: string;
  disabled?: boolean;
}) {
  return (
    <section id="checkout-recycling" className="rounded-lg border border-neutral-100 bg-white p-4">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-leaf-50">
            <Recycle className="h-5 w-5 text-leaf-600" aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-semibold text-neutral-900">Gửi lại vật liệu tái chế (Bảo vệ môi trường)</span>
            <span className="block text-xs font-medium text-leaf-700">Bưu tá nhận lại vật liệu ngay khi giao hàng</span>
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Gửi lại vật liệu tái chế"
          aria-checked={selected}
          checked={selected}
          disabled={disabled}
          onChange={(e) => onSelectedChange(e.target.checked)}
          className="h-5 w-5 accent-leaf-600"
        />
      </label>

      {selected && (
        <div className="mt-3 space-y-2">
          <p className="rounded-md border border-leaf-200 bg-leaf-50 p-3 text-xs leading-relaxed text-leaf-900">
            Chúng tôi sẽ thu gom lại các vật liệu tái chế được đóng gói gọn gàng như bọc nilong, hoặc quần áo cũ, pin, vỏ sữa làm
            sạch → giúp bảo vệ môi trường. Số kg thu gom tối đa bằng số kg của đơn hàng.
          </p>
          {recyclingBookedAfterPayment(paymentMethod) && (
            <p className="text-xs leading-relaxed text-neutral-600">Lịch thu gom được đặt sau khi Tubu nhận được thanh toán của đơn.</p>
          )}
          <textarea
            aria-label="Ghi chú vật liệu tái chế"
            placeholder="Ghi chú loại vật dụng muốn gửi (vd: 3 cục pin, vỏ hộp sữa...)"
            value={note}
            maxLength={RECYCLING_NOTE_MAX}
            rows={2}
            disabled={disabled}
            onChange={(e) => onNoteChange(e.target.value)}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm"
          />
          <div className="text-right text-[11px] text-neutral-400">
            {note.length}/{RECYCLING_NOTE_MAX}
          </div>
        </div>
      )}
    </section>
  );
}
