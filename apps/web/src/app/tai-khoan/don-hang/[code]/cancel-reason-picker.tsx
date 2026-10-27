'use client';

import { useId } from 'react';
import { CANCEL_REASONS, CANCEL_REASON_TEXT_MAX, type CancelReasonCode } from '@tubutree/app-core/cancel-reasons';
import { ui } from '@/lib/guest-ui';

export const CANCEL_REASON_REQUIRED = 'Bạn chọn lý do huỷ giúp Tubu nhé';

interface Props {
  code: CancelReasonCode | null;
  onCode: (c: CancelReasonCode) => void;
  text: string;
  onText: (t: string) => void;
  showError: boolean;
}

/** Lý do huỷ đơn chọn sẵn (như Shopee) + ô viết thêm khi chọn "Lý do khác". Cửa hàng dựa vào đây để biết vì sao khách bỏ đơn. */
export function CancelReasonPicker({ code, onCode, text, onText, showError }: Props) {
  const name = useId();
  return (
    <fieldset className="mt-3">
      <legend className="text-sm font-semibold text-stone-900">Lý do huỷ đơn</legend>
      <div className="mt-1 grid gap-1">
        {CANCEL_REASONS.map((r) => (
          <label key={r.code} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-1">
            <input
              type="radio"
              name={name}
              value={r.code}
              checked={code === r.code}
              onChange={() => onCode(r.code)}
              className="h-4 w-4 flex-none accent-forest-600"
            />
            <span className="text-sm text-stone-900">{r.label}</span>
          </label>
        ))}
      </div>
      {code === 'OTHER' && (
        <textarea
          aria-label="Mô tả lý do huỷ"
          value={text}
          onChange={(e) => onText(e.target.value)}
          maxLength={CANCEL_REASON_TEXT_MAX}
          rows={2}
          placeholder="Bạn cho Tubu biết thêm nhé (không bắt buộc)…"
          className={`${ui.field} mt-2 py-2`}
        />
      )}
      {showError && !code && (
        <p role="alert" className={`mt-1 ${ui.error}`}>
          {CANCEL_REASON_REQUIRED}
        </p>
      )}
    </fieldset>
  );
}
