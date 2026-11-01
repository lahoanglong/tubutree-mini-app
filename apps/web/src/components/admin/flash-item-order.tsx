'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { updateFlashItemOrder } from '@/lib/admin-client';
import { BTN_XS_SECONDARY, FIELD_CLASS, TOUCH_H } from './ui';

const ORDER_MIN = -1000;
const ORDER_MAX = 1000;

/** Chuỗi nhập → số nguyên hợp lệ (cùng biên với API), hoặc null. Ô trống không phải số 0: không lưu nhầm. */
export function parseSortOrder(raw: string): number | null {
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= ORDER_MIN && n <= ORDER_MAX ? n : null;
}

/**
 * Ô "Thứ tự" của một món trong đợt Giờ vàng: số nhỏ lên trước trong khung (mặc định 0, cùng số thì món rẻ trước).
 * Lưu bằng nút, không lưu khi rời ô, để gõ dở rồi bấm sang chỗ khác không đổi thứ tự khách đang thấy.
 */
export function FlashItemOrder({ itemId, sortOrder, label, onSaved }: { itemId: string; sortOrder?: number; label: string; onSaved: () => void }) {
  const saved = sortOrder ?? 0;
  const [value, setValue] = useState(String(saved));
  const [err, setErr] = useState<string | null>(null);
  const parsed = parseSortOrder(value);
  const save = useMutation({
    mutationFn: (n: number) => updateFlashItemOrder(itemId, n),
    onSuccess: () => {
      setErr(null);
      onSaved();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Không lưu được thứ tự'),
  });
  const invalid = value.trim() !== '' && parsed === null;

  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1 text-xs">
      <label className="flex items-center gap-1 text-stone-700">
        Thứ tự
        <input
          type="number"
          step={1}
          min={ORDER_MIN}
          max={ORDER_MAX}
          inputMode="numeric"
          aria-label={`Thứ tự của ${label}`}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setErr(null);
          }}
          className={`${FIELD_CLASS} ${TOUCH_H} w-20`}
        />
      </label>
      <button
        type="button"
        aria-label={`Lưu thứ tự của ${label}`}
        disabled={parsed === null || parsed === saved || save.isPending}
        onClick={() => parsed !== null && save.mutate(parsed)}
        className={BTN_XS_SECONDARY}
      >
        {save.isPending ? 'Đang lưu…' : 'Lưu'}
      </button>
      {invalid && <span className="basis-full text-danger-fg">Nhập số nguyên từ {ORDER_MIN} đến {ORDER_MAX}.</span>}
      {err && (
        <span role="alert" className="basis-full text-danger-fg">
          {err}
        </span>
      )}
    </span>
  );
}
