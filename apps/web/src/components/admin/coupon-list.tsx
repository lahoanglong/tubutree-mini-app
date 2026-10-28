'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listCoupons, updateCoupon, type AdminCoupon, type CouponStatusFilter } from '@/lib/admin-client';
import { formatVnd } from '@/lib/shop-client';
import { formatDate } from '@/lib/format-date';
import { useConfirm } from './confirm-dialog';
import { VnDateInput } from './vn-date-input';
import { BTN_SMALL, BTN_XS_SECONDARY, FIELD_CLASS, FIELD_XS, TOUCH_H, ToneBadge, chipClass, LoadError } from './ui';

const PAGE_SIZE = 20;
const STATUS_FILTERS: { value: CouponStatusFilter; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'active', label: 'Đang chạy' },
  { value: 'inactive', label: 'Đã tắt' },
  { value: 'expired', label: 'Hết hạn' },
];


function couponValue(c: AdminCoupon): string {
  if (c.type === 'FREESHIP') return 'Miễn phí ship';
  if (c.type === 'PERCENT') return `Giảm ${c.value}%${c.maxDiscount ? `, tối đa ${formatVnd(c.maxDiscount)}` : ''}`;
  return `Giảm ${formatVnd(c.value)}`;
}

function couponState(c: AdminCoupon, now: number): { label: string; tone: 'success' | 'neutral' | 'danger' | 'warning' } {
  if (!c.isActive) return { label: 'Đã tắt', tone: 'danger' };
  if (new Date(c.endAt).getTime() < now) return { label: 'Hết hạn', tone: 'neutral' };
  if (c.usageLimit != null && c.redeemedCount >= c.usageLimit) return { label: 'Hết lượt', tone: 'warning' };
  if (new Date(c.startAt).getTime() > now) return { label: 'Chưa bắt đầu', tone: 'neutral' };
  return { label: 'Đang chạy', tone: 'success' };
}

/**
 * Đổi hạn dùng: ngày chọn nằm trong state cục bộ và chỉ gửi khi bấm "Lưu hạn" (hoặc Enter). Ô ngày của trình duyệt báo thay đổi
 * sau từng chữ số khi gõ tay, nên gửi theo onChange sẽ ghi một hạn nửa chừng (vd năm 0002) vào mã đang chạy.
 */
function EndDateForm({
  coupon: c,
  pending,
  onCommit,
}: {
  coupon: AdminCoupon;
  pending: boolean;
  onCommit: (c: AdminCoupon, dayKey: string, onDone: () => void) => void;
}) {
  const [day, setDay] = useState('');
  return (
    <form
      className="flex flex-wrap items-center gap-1 text-xs text-stone-600"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) onCommit(c, day, () => setDay(''));
      }}
    >
      <label className="flex items-center gap-1">
        Đổi hạn đến
        <VnDateInput ariaLabel={`Đổi ngày hết hạn mã ${c.code}`} className={FIELD_XS} value={day} disabled={pending} onChange={setDay} />
      </label>
      <button type="submit" className={BTN_XS_SECONDARY} disabled={pending || !day}>
        Lưu hạn
      </button>
    </form>
  );
}

/**
 * Danh sách mã đã tạo (ADMINOPS-8): xem lượt đã dùng, tắt/bật mã bị lộ hay đặt nhầm, gia hạn ngày kết thúc.
 * Voucher cá nhân sinh tự động (chào mừng, sinh nhật, mua chung...) không hiện trừ khi tìm đúng mã.
 */
export function CouponList() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<CouponStatusFilter>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const q = useQuery({
    queryKey: ['admin-coupons', page, keyword, status],
    queryFn: () => listCoupons({ page, limit: PAGE_SIZE, q: keyword, status }),
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof updateCoupon>[1]; done: string }) => updateCoupon(v.id, v.body),
    onSuccess: (_r, v) => {
      setMsg({ ok: true, text: v.done });
      void qc.invalidateQueries({ queryKey: ['admin-coupons'] });
    },
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không cập nhật được mã.' }),
  });

  const toggle = async (c: AdminCoupon) => {
    setMsg(null);
    if (c.isActive) {
      const ok = await confirm({
        title: `Tắt mã ${c.code}`,
        message: 'Khách sẽ không áp được mã này nữa (đơn đã đặt bằng mã vẫn giữ nguyên). Bật lại được bất cứ lúc nào.',
        confirmLabel: 'Tắt mã',
        tone: 'danger',
      });
      if (!ok) return;
    }
    patch.mutate({ id: c.id, body: { isActive: !c.isActive }, done: c.isActive ? `Đã tắt mã ${c.code}.` : `Đã bật lại mã ${c.code}.` });
  };

  const extend = (c: AdminCoupon, dayKey: string, onDone: () => void) => {
    if (!dayKey) return;
    setMsg(null);
    const endAt = new Date(`${dayKey}T23:59:59+07:00`).toISOString();
    patch.mutate({ id: c.id, body: { endAt }, done: `Đã đổi hạn mã ${c.code} đến hết ${formatDate(endAt)}.` }, { onSuccess: onDone });
  };

  const total = q.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const now = Date.now();

  return (
    <section aria-label="Mã đã tạo" className="space-y-2">
      <h2 className="font-display text-sm font-semibold text-stone-900">Mã đã tạo ({total})</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Tìm mã"
          placeholder="Tìm mã"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value.toUpperCase());
            setPage(1);
          }}
          className={`${FIELD_CLASS} ${TOUCH_H} w-full sm:w-48`}
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Lọc trạng thái mã">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              aria-pressed={status === f.value}
              className={chipClass(status === f.value)}
              onClick={() => {
                setStatus(f.value);
                setPage(1);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>{msg.text}</p>}
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải danh sách mã...</p>}
      {q.isError && <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được danh sách mã.</LoadError>}
      {q.data && q.data.data.length === 0 && <p className="text-sm text-stone-500">Chưa có mã nào khớp bộ lọc.</p>}
      <ul className="space-y-2">
        {q.data?.data.map((c) => {
          const st = couponState(c, now);
          return (
            <li key={c.id} className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono font-semibold text-stone-900">{c.code}</span>
                <div className="flex flex-wrap gap-1">
                  {c.scope === 'CLAIM' && <ToneBadge tone="neutral">Ẩn · thẻ hộp hàng</ToneBadge>}
                  {c.newCustomerOnly && <ToneBadge tone="info">Chỉ khách mới</ToneBadge>}
                  <ToneBadge tone={st.tone}>{st.label}</ToneBadge>
                </div>
              </div>
              <p className="mt-1 text-stone-700">
                {couponValue(c)}
                {c.minOrder ? ` · đơn từ ${formatVnd(c.minOrder)}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-stone-500">
                {formatDate(c.startAt)} – {formatDate(c.endAt)}
                {c.claimedCount != null ? ` · Đã nhận ${c.claimedCount}` : ''} · Đã dùng {c.redeemedCount}
                {c.usageLimit != null ? `/${c.usageLimit}` : ''} lượt · {c.perUserLimit > 0 ? `${c.perUserLimit} lượt/khách` : 'không giới hạn/khách'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className={BTN_XS_SECONDARY} disabled={patch.isPending} onClick={() => void toggle(c)}>
                  {c.isActive ? 'Tắt mã' : 'Bật lại'}
                </button>
                <EndDateForm coupon={c} pending={patch.isPending} onCommit={extend} />
              </div>
            </li>
          );
        })}
      </ul>
      {pages > 1 && (
        <div className="flex items-center gap-2 text-xs text-stone-600">
          <button type="button" className={BTN_SMALL} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Trang trước
          </button>
          <span>
            Trang {page}/{pages}
          </span>
          <button type="button" className={BTN_SMALL} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Trang sau
          </button>
        </div>
      )}
      {dialog}
    </section>
  );
}
