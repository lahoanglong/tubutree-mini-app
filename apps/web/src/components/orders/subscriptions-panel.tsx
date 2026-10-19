'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sprout } from 'lucide-react';
import { setSubscriptionStatus, skipSubscriptionCycle, type SubscriptionDTO } from '@tubutree/app-core/api/subscriptions';
import { subscriptionsQuery } from '@tubutree/app-core/queries/subscriptions';
import { addressesQuery } from '@tubutree/app-core/queries/checkout';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { LineItemSkeleton } from '@/components/ui/skeleton';
import { Sheet } from '@/components/ui/sheet';
import { coreHttp } from '@/lib/core-http';
import { useAuthPhase } from '@/lib/auth-phase';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { mini, miniGhostDanger } from '@/components/order-mobile/mobile-ui';
import { subscriptionCycleView } from './subscription-price';
import { SubscriptionEditSheet } from './subscription-edit-sheet';
import { PAY_SHORT, addressText } from './subscription-options';

type SubStatus = SubscriptionDTO['status'];
const STATUS_TONE: Record<SubStatus, BadgeTone> = { ACTIVE: 'success', PAUSED: 'warning', CANCELLED: 'neutral' };
const STATUS_LABEL: Record<SubStatus, string> = { ACTIVE: 'Đang chạy', PAUSED: 'Tạm dừng', CANCELLED: 'Đã hủy' };
/** Chỉ để hiện lời giới thiệu khi chưa có lịch nào; máy chủ vẫn là nơi quyết định % giảm khi tính tiền. */
const FALLBACK_DISCOUNT_PCT = 0.12;

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Có lỗi xảy ra. Vui lòng thử lại.');

/**
 * Nội dung "Đặt định kỳ": tab "Định kỳ" của trang Đơn hàng. Tạm dừng/tiếp tục, sửa số lượng/địa chỉ/cách trả, huỷ qua sheet giữ chân
 * (tạm dừng / bỏ qua kỳ / vẫn huỷ), như Mini App.
 */
export function SubscriptionsPanel() {
  const qc = useQueryClient();
  // /me/subscriptions cần đăng nhập: gọi trước khi khôi phục xong phiên sẽ 401 và kẹt.
  const authed = useAuthPhase() === 'authenticated';
  const subsQ = useQuery({ ...subscriptionsQuery(coreHttp), enabled: authed });
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000 });
  const subs = subsQ.data ?? [];
  // % thực tế đang áp (thang bậc) thắng % cấu hình chung khi đã có lịch.
  const subscribePct = Math.round((subs[0]?.effectiveDiscountPct ?? cfgQ.data?.subscribeDiscountPct ?? FALLBACK_DISCOUNT_PCT) * 100);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Nhiều gói cùng SP chỉ khác nhau ở địa chỉ, nên thẻ phải hiện địa chỉ để khách phân biệt.
  const addrQ = useQuery({ ...addressesQuery(coreHttp), enabled: authed && subs.length > 0 });
  const addressById = new Map((addrQ.data ?? []).map((a) => [a.id, a]));

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SubStatus }) => setSubscriptionStatus(coreHttp, id, status),
    onMutate: () => setNotice(null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['subscriptions'] }),
  });
  const skipMut = useMutation({
    mutationFn: (id: string) => skipSubscriptionCycle(coreHttp, id),
    onMutate: () => setNotice(null),
    onSuccess: () => {
      setNotice('Đã bỏ qua kỳ này, hẹn kỳ sau nhé');
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      setCancelTarget(null);
    },
  });

  const targetSub = subs.find((s) => s.id === cancelTarget) ?? null;
  const editSub = subs.find((s) => s.id === editTarget) ?? null;
  const pending = statusMut.isPending ? statusMut.variables?.status : undefined;
  const changeFromSheet = (status: SubStatus) => {
    if (!cancelTarget) return;
    statusMut.mutate({ id: cancelTarget, status }, { onSuccess: () => setCancelTarget(null) });
  };
  const actionError = statusMut.isError ? errText(statusMut.error) : skipMut.isError ? errText(skipMut.error) : null;

  return (
    <div className="flex flex-col gap-3 pb-6 pt-1 max-md:px-1">
      <div>
        <p className="text-sm text-stone-700">{`Tự động đặt lại sản phẩm bạn dùng thường xuyên — tiết kiệm ${subscribePct}% mỗi đơn, hủy bất kỳ lúc nào.`}</p>
        {subs[0] && <p className="mt-1 text-xs font-medium text-forest-700">{`Đang giảm ${Math.round(subs[0].effectiveDiscountPct * 100)}% cho đơn định kỳ`}</p>}
      </div>

      {notice && (
        <p role="status" className="text-sm font-medium text-success-fg">
          {notice}
        </p>
      )}
      {actionError && !cancelTarget && (
        <p role="alert" className={ui.error}>
          {actionError}
        </p>
      )}

      {!authed || subsQ.isLoading ? (
        <>
          <LineItemSkeleton />
          <LineItemSkeleton />
        </>
      ) : subsQ.isError ? (
        <ErrorState message={errText(subsQ.error)} onRetry={() => void subsQ.refetch()} />
      ) : subs.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {subs.map((s) => (
            <SubscriptionCard
              key={s.id}
              sub={s}
              busy={statusMut.isPending}
              address={s.addressId ? addressById.get(s.addressId) : undefined}
              onEdit={() => setEditTarget(s.id)}
              onToggle={() => statusMut.mutate({ id: s.id, status: s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })}
              onCancel={() => {
                statusMut.reset();
                skipMut.reset();
                setCancelTarget(s.id);
              }}
            />
          ))}
        </ul>
      ) : (
        <section aria-label="Chưa có lịch đặt định kỳ" className={`p-6 text-center ${ui.card}`}>
          <h2 className="font-display text-base font-semibold text-stone-900">Chưa có lịch đặt định kỳ</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">{'Mở một sản phẩm và chọn "Đặt định kỳ" để bắt đầu.'}</p>
          <Link href="/san-pham" className={`${ui.btnPrimary} mt-4`}>
            Khám phá sản phẩm
          </Link>
        </section>
      )}

      {editSub && (
        <SubscriptionEditSheet key={editSub.id} sub={editSub} onClose={() => setEditTarget(null)} onSaved={setNotice} />
      )}

      <Sheet
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="Giữ lại lịch định kỳ?"
        description="Tạm dừng hoặc bỏ qua kỳ này, thay vì hủy hẳn nhé."
      >
        <div className="flex flex-col gap-2.5">
          {actionError && (
            <p role="alert" className={ui.error}>
              {actionError}
            </p>
          )}
          <button
            type="button"
            className={ui.btnPrimary}
            disabled={statusMut.isPending}
            onClick={() => changeFromSheet('PAUSED')}
          >
            {pending === 'PAUSED' ? 'Đang xử lý…' : 'Tạm dừng'}
          </button>
          {targetSub?.status === 'ACTIVE' && (
            <button
              type="button"
              className={ui.btnSecondary}
              disabled={skipMut.isPending}
              onClick={() => cancelTarget && skipMut.mutate(cancelTarget)}
            >
              {skipMut.isPending ? 'Đang xử lý…' : 'Bỏ qua kỳ này'}
            </button>
          )}
          <button
            type="button"
            className={`${ui.btnSecondary} border-danger-fg text-danger-fg`}
            disabled={statusMut.isPending}
            onClick={() => changeFromSheet('CANCELLED')}
          >
            {pending === 'CANCELLED' ? 'Đang xử lý…' : 'Vẫn hủy'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function SubscriptionCard({
  sub: s,
  busy,
  address,
  onEdit,
  onToggle,
  onCancel,
}: {
  sub: SubscriptionDTO;
  busy: boolean;
  address?: Parameters<typeof addressText>[0];
  onEdit: () => void;
  onToggle: () => void;
  onCancel: () => void;
}) {
  const cycle = subscriptionCycleView(s);
  return (
    <li className={`p-3 ${ui.card} ${mini.card}`}>
      <div className="flex gap-3">
        <div className={`flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-control bg-stone-100 ${mini.thumb}`}>
          {s.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.thumbnail} alt={s.productName} className="h-full w-full object-cover" />
          ) : (
            <Sprout className="h-5 w-5 text-forest-600" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-stone-900">{s.productName}</div>
          <div className="text-xs text-stone-600">{`${s.variationName} · SL ${s.quantity}`}</div>
          <div className="text-xs font-semibold text-forest-700">{`Mỗi ${s.intervalWeeks} tuần · ${formatVnd(cycle.goods)}`}</div>
          {cycle.discount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <s className="text-xs text-stone-600">{formatVnd(cycle.subtotal)}</s>
              <Badge tone="success" size="sm">{`Tiết kiệm ${cycle.savePct}%`}</Badge>
            </div>
          )}
          <div className="text-xs text-stone-600">{`Thanh toán: ${PAY_SHORT[s.paymentMethod ?? 'COD']}`}</div>
          {address && <div className="break-words text-xs text-stone-600">{`Giao tới: ${addressText(address)}`}</div>}
        </div>
        <Badge tone={STATUS_TONE[s.status]} size="sm" className="self-start">
          {STATUS_LABEL[s.status]}
        </Badge>
      </div>
      <div className="mt-2.5 text-xs text-stone-700">
        {s.status === 'ACTIVE' ? (s.nextRunAt ? `Lần kế: ${formatDate(s.nextRunAt)}` : 'Đang lên lịch') : 'Đang tạm dừng'}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onEdit} className={`${ui.btnSecondary} ${mini.secondary} min-w-max flex-1`}>
          Sửa
        </button>
        <button type="button" disabled={busy} onClick={onToggle} className={`${ui.btnSecondary} ${mini.secondary} min-w-max flex-1`}>
          {s.status === 'ACTIVE' ? 'Tạm dừng' : 'Tiếp tục'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={miniGhostDanger}>
          Hủy
        </button>
      </div>
    </li>
  );
}
