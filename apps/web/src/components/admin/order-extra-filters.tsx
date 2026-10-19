'use client';

import { useState } from 'react';
import type { OrderKind, OrderListExtra, OrderListPlatform, OrderPaymentFilter } from '@/lib/admin-client';
import { paymentStatusLabel } from '@/lib/order-view';
import { BTN_SECONDARY, FIELD_CLASS, TOUCH_H } from './ui';
import type { PickedItem } from './search-picker';
import { UserPicker } from './user-picker';

const ORDER_KIND_OPTIONS: { k: OrderKind; label: string; hint: string }[] = [
  { k: 'retail', label: 'Đơn lẻ', hint: 'Khách tự mua, không qua CTV, gian hàng hay đại lý.' },
  {
    k: 'ctv',
    label: 'Qua CTV',
    hint: 'Đơn có mã người giới thiệu (CTV, đại lý; khách thường chia sẻ link cũng được ghi nhận nhưng không có hoa hồng). Không gồm đơn qua gian hàng hay CTV lên hộ.',
  },
  { k: 'dealer', label: 'Đơn đại lý', hint: 'Đại lý nhập hàng theo giá sỉ.' },
  { k: 'ctv_assisted', label: 'CTV lên đơn hộ', hint: 'CTV đặt thay khách; người mua chính là CTV.' },
  { k: 'storefront', label: 'Qua gian hàng', hint: 'Khách mua từ trang gian hàng của CTV hoặc đối tác.' },
];
const PAYMENT_OPTIONS: OrderPaymentFilter[] = ['UNPAID', 'PAID', 'REFUNDED', 'FAILED'];
const PLATFORM_OPTIONS: { k: OrderListPlatform; label: string }[] = [
  { k: 'miniapp', label: 'Mini App' },
  { k: 'web', label: 'Web' },
];

/** Bỏ khoá không có giá trị để ô "tất cả" trả về đúng object rỗng, không để lại `kind: undefined`. */
const without = (v: OrderListExtra, key: keyof OrderListExtra): OrderListExtra => {
  const { [key]: _drop, ...rest } = v;
  return rest;
};

/**
 * Bộ lọc thêm của tab Đơn hàng (D1-17): loại đơn, tình trạng thanh toán, nền tảng, CTV hoặc gian hàng giới thiệu và thứ tự theo ngày
 * đặt. Cha giữ `value` (đúng tham số API) nên danh sách và nút "Xuất CSV" dùng chung một bộ lọc.
 */
export function OrderExtraFilters({ value, onChange }: { value: OrderListExtra; onChange: (v: OrderListExtra) => void }) {
  const [picked, setPicked] = useState<PickedItem | null>(null);
  const [storeInput, setStoreInput] = useState(value.storefront ?? '');
  const set = <K extends keyof OrderListExtra>(key: K, v: OrderListExtra[K] | '') => onChange(v ? { ...value, [key]: v } : without(value, key));
  const hasFilter = !!(value.kind || value.payment || value.platform || value.referrerUserId || value.storefront);
  const kindHint = ORDER_KIND_OPTIONS.find((o) => o.k === value.kind)?.hint;

  const submitStore = (e: React.FormEvent) => {
    e.preventDefault();
    set('storefront', storeInput.trim());
  };

  return (
    <div className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Lọc đơn theo loại đơn"
          value={value.kind ?? ''}
          onChange={(e) => set('kind', e.target.value as OrderKind | '')}
          className={`${FIELD_CLASS} ${TOUCH_H}`}
        >
          <option value="">Mọi loại đơn</option>
          {ORDER_KIND_OPTIONS.map((o) => (
            <option key={o.k} value={o.k}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Lọc đơn theo tình trạng thanh toán"
          value={value.payment ?? ''}
          onChange={(e) => set('payment', e.target.value as OrderPaymentFilter | '')}
          className={`${FIELD_CLASS} ${TOUCH_H}`}
        >
          <option value="">Mọi tình trạng thanh toán</option>
          {PAYMENT_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {paymentStatusLabel(p)}
            </option>
          ))}
        </select>
        <select
          aria-label="Lọc đơn theo nền tảng đặt"
          value={value.platform ?? ''}
          onChange={(e) => set('platform', e.target.value as OrderListPlatform | '')}
          className={`${FIELD_CLASS} ${TOUCH_H}`}
        >
          <option value="">Mọi nền tảng</option>
          {PLATFORM_OPTIONS.map((p) => (
            <option key={p.k} value={p.k}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Thứ tự sắp xếp theo ngày đặt"
          value={value.order ?? 'desc'}
          onChange={(e) => onChange({ ...value, order: e.target.value as 'asc' | 'desc' })}
          className={`${FIELD_CLASS} ${TOUCH_H}`}
        >
          <option value="desc">Mới nhất trước</option>
          <option value="asc">Cũ nhất trước</option>
        </select>
        {hasFilter && (
          <button
            type="button"
            onClick={() => {
              setPicked(null);
              setStoreInput('');
              onChange(value.order ? { order: value.order } : {});
            }}
            className={`${BTN_SECONDARY} whitespace-nowrap`}
          >
            Xoá bộ lọc
          </button>
        )}
      </div>
      {kindHint && <p className="text-xs text-stone-500">{kindHint}</p>}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] flex-1">
          <UserPicker
            label="Lọc đơn theo CTV giới thiệu"
            value={picked}
            onChange={(p) => {
              setPicked(p);
              set('referrerUserId', p?.id ?? '');
            }}
          />
        </div>
        <form onSubmit={submitStore} className="flex min-w-[240px] flex-1 items-center gap-2">
          <input
            type="text"
            aria-label="Lọc đơn theo gian hàng (slug hoặc tên miền con)"
            placeholder="Gian hàng: slug hoặc tên miền con"
            maxLength={100}
            value={storeInput}
            onChange={(e) => setStoreInput(e.target.value)}
            className={`${FIELD_CLASS} ${TOUCH_H} flex-1`}
          />
          <button type="submit" className={`${BTN_SECONDARY} whitespace-nowrap`}>
            Lọc gian hàng
          </button>
        </form>
      </div>
    </div>
  );
}
