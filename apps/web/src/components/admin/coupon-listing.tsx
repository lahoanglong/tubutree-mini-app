'use client';

import { useState } from 'react';
import type { AdminCoupon } from '@/lib/admin-client';
import { BTN_XS_SECONDARY, FIELD_XS } from './ui';

/** Khớp COUPON_TITLE_MAX của API. */
const TITLE_MAX = 60;

/**
 * Hộp "Hiện ở mục Nhận mã" và ô "Tên hiển thị" của một mã. Chỉ mã nhận qua thẻ (phạm vi CLAIM) không thuộc lô thẻ in mới hiện được ở mục Nhận mã: mã
 * khác khoá hộp chọn kèm lý do, vì nếu để bật thì API từ chối (và DB cũng chặn) sau khi admin đã bấm. API vẫn là hàng rào thật; khoá ở đây chỉ để khỏi
 * dẫn admin vào ngõ cụt. Nút Lưu chỉ sáng khi có thay đổi so với giá trị đã lưu; tên rỗng gửi `null` (quay về nhãn tự sinh).
 */
export function CouponListing({ coupon: c, pending, onSave }: { coupon: AdminCoupon; pending: boolean; onSave: (patch: { listed: boolean; title: string | null }) => void }) {
  const listable = c.scope === 'CLAIM' && !c.batch;
  const [listed, setListed] = useState(Boolean(c.listed));
  const [title, setTitle] = useState(c.title ?? '');
  const cleanTitle = title.trim() || null;
  const dirty = listed !== Boolean(c.listed) || cleanTitle !== (c.title ?? null);
  const disabled = !listable || pending || !dirty;
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-stone-100 pt-2 text-xs text-stone-600"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSave({ listed, title: cleanTitle });
      }}
    >
      <label className="flex min-h-[44px] items-center gap-1.5 sm:min-h-0">
        <input type="checkbox" checked={listed} disabled={!listable || pending} onChange={(e) => setListed(e.target.checked)} className="h-4 w-4" />
        Hiện ở mục Nhận mã
      </label>
      <label className="flex items-center gap-1">
        Tên hiển thị
        <input
          type="text"
          aria-label={`Tên hiển thị mã ${c.code}`}
          maxLength={TITLE_MAX}
          value={title}
          disabled={!listable || pending}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Vd: Mừng bạn mới"
          className={`${FIELD_XS} w-44`}
        />
      </label>
      <button type="submit" className={BTN_XS_SECONDARY} disabled={disabled}>
        Lưu
      </button>
      {!listable && <p className="basis-full text-stone-500">Chỉ mã nhận qua thẻ, không thuộc lô thẻ in, mới hiện ở mục Nhận mã.</p>}
    </form>
  );
}
