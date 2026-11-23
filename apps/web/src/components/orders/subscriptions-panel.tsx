'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { runSubscriptionNow, setSubscriptionStatus, skipSubscriptionCycle, type SubscriptionDTO } from '@tubutree/app-core/api/subscriptions';
import { canActOnCycle, nextTierText, runNowConfirmBody, runNowDoneText, selfServeCopy, skipDoneText } from '@tubutree/app-core/subscription-self-serve';
import { subscriptionsQuery } from '@tubutree/app-core/queries/subscriptions';
import { subscriptionPauseView, SUBSCRIPTION_PAUSED_GENERIC } from '@tubutree/app-core/subscription-pause-copy';
import { addressesQuery } from '@tubutree/app-core/queries/checkout';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { LineItemSkeleton } from '@/components/ui/skeleton';
import { Sheet } from '@/components/ui/sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { coreHttp } from '@/lib/core-http';
import { useAuthPhase } from '@/lib/auth-phase';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { settleWithin } from '@/lib/settle-within';
import { isStaleSubscriptionError } from '@/lib/subscription-stale-error';
import { ui } from '@/lib/guest-ui';
import { mini, miniGhostDanger } from '@/components/order-mobile/mobile-ui';
import { subscriptionCycleView } from './subscription-price';
import { SubscriptionEditSheet } from './subscription-edit-sheet';
import { PAY_SHORT, addressText } from './subscription-options';
import { ProductThumb } from '@/components/mini';
import { actionErrorText, loadErrorText } from '@/lib/error-text';
import { joinDetailParts, variationLabel } from '@/lib/variation-label';
import type { SubscriptionSuggestion } from '@tubutree/app-core/commerce/green-box';
import { SubscriptionSuggestionRow, SuggestedSubscribe, useSubscriptionSuggestion } from '@/components/reorder/subscription-suggestion';

type SubStatus = SubscriptionDTO['status'];
const STATUS_TONE: Record<SubStatus, BadgeTone> = { ACTIVE: 'success', PAUSED: 'warning', CANCELLED: 'neutral' };
const STATUS_LABEL: Record<SubStatus, string> = { ACTIVE: 'Đang chạy', PAUSED: 'Tạm dừng', CANCELLED: 'Đã huỷ' };
/** Nút chữ của hai việc kỳ tới trên thẻ (Bỏ qua kỳ này, Đặt kỳ này ngay): chữ màu nút ghost, cao 44px, không nền như Button ghost của Mini App. */
const CYCLE_BTN =
  'inline-flex min-h-11 items-center rounded-control text-sm font-semibold text-[color:var(--color-action-ghost-fg)] hover:underline aria-disabled:opacity-50';
/** Chỉ để hiện lời giới thiệu khi chưa có lịch nào; máy chủ vẫn là nơi quyết định % giảm khi tính tiền. */
const FALLBACK_DISCOUNT_PCT = 0.12;

const errText = loadErrorText;

/**
 * Nội dung "Đặt định kỳ": tab "Định kỳ" của trang Đơn hàng. Tạm dừng/tiếp tục, sửa số lượng/chu kỳ/ngày giao kỳ tới/địa chỉ/cách trả, bỏ qua kỳ này và
 * "Đặt kỳ này ngay" ngay trên thẻ gói đang chạy, viên bậc giảm kế tiếp, huỷ qua sheet giữ chân (tạm dừng / bỏ qua kỳ / vẫn huỷ), như Mini App.
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
  // "Lần kế" của thẻ lúc mở sheet giữ chân: sheet không hiện ngày, danh sách tải lại nền qua 03:00 thì `targetSub` đã sang kỳ sau và skip sẽ bỏ nhầm kỳ đó.
  const cancelShownRunAt = useRef<string | null>(null);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [runNowTarget, setRunNowTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  // Gợi ý định kỳ chỉ khi khách chưa có gói nào đang chạy hay tạm dừng.
  const noOpenSub = subsQ.isSuccess && !subs.some((s) => s.status !== 'CANCELLED');
  const { suggestion, discountFraction } = useSubscriptionSuggestion(noOpenSub);
  const [subscribeTo, setSubscribeTo] = useState<SubscriptionSuggestion | null>(null);
  // Nhiều gói cùng SP chỉ khác nhau ở địa chỉ, nên thẻ phải hiện địa chỉ để khách phân biệt.
  const addrQ = useQuery({ ...addressesQuery(coreHttp), enabled: authed && subs.length > 0 });
  const addressById = new Map((addrQ.data ?? []).map((a) => [a.id, a]));

  // Tạm dừng/Tiếp tục/Huỷ và Bỏ qua kỳ loại trừ nhau trên mọi gói (giao diện cũng khoá hết nút thẻ khi một việc đang chạy): một việc mỗi lúc.
  // Ref vì `isPending` chỉ đúng sau lần vẽ kế (chạm "Tạm dừng" rồi "Vẫn huỷ" sát nhau vẫn gửi cả hai lệnh). Cả hai lệnh trả lời hứa tải lại
  // danh sách nên khoá giữ tới khi trạng thái mới về nhưng có hạn (`settleWithin`), kẻo mạng chậm giữ nút lâu hơn lệnh đã xong; sheet đóng ngay khi lệnh xong
  // để mất mạng lúc tải lại không giữ sheet kẹt.
  const acting = useRef(false);
  const releaseActing = () => {
    acting.current = false;
  };
  const exclusive = (run: () => void) => {
    if (acting.current) return;
    acting.current = true;
    run();
  };

  // Lệnh bị từ chối vì gói đã khác thẻ (cron vừa tạm dừng, máy khác vừa huỷ): tải lại để lần bấm sau dựa trên số thật, và giữ khoá tới lúc đó
  // như lệnh thành công (react-query chờ Promise này trước `onSettled`). Lỗi tạm (mạng, 5xx) thì để nguyên danh sách.
  // `isError` của mutation chỉ bật SAU khi Promise này xong (tối đa 4 giây), nên lời máy chủ nằm ở state riêng để hiện ngay như snackbar của Mini
  // và còn lại khi sheet Sửa tự đóng vì gói đã rời danh sách.
  const onActionError = (e: unknown) => {
    if (!isStaleSubscriptionError(e)) return undefined;
    setRejected(actionErrorText(e));
    return settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] }));
  };

  const statusMut = useLockedMutation({
    mutationFn: ({ id, status }: { id: string; status: SubStatus; from: 'card' | 'sheet' }) => setSubscriptionStatus(coreHttp, id, status),
    onMutate: () => {
      setNotice(null);
      setRejected(null);
    },
    onSuccess: () => {
      setCancelTarget(null);
      return settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] }));
    },
    onError: onActionError,
    onSettled: releaseActing,
  });
  const skipMut = useLockedMutation({
    // Gửi kèm "Lần kế" thẻ đang hiện: cron 03:00 vừa ra đơn kỳ đó thì máy chủ trả 409 và danh sách tải lại, không lặng lẽ bỏ qua kỳ sau.
    mutationFn: ({ id, expectedNextRunAt }: { id: string; expectedNextRunAt: string }) => skipSubscriptionCycle(coreHttp, id, expectedNextRunAt),
    onMutate: () => {
      setNotice(null);
      setRejected(null);
    },
    onSuccess: (sub) => {
      setNotice(skipDoneText(sub?.nextRunAt));
      setCancelTarget(null);
      return settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] }));
    },
    // Sheet giữ chân web không tự đóng khi bị từ chối: khách đã đọc "lịch vừa thay đổi", lần bấm sau theo danh sách vừa tải lại thay vì 409 mãi.
    onError: (e) => {
      if (isStaleSubscriptionError(e)) cancelShownRunAt.current = null;
      return onActionError(e);
    },
    onSettled: releaseActing,
  });
  // "Đặt kỳ này ngay" tạo đơn (Ví Tubu trừ tiền ngay) nên qua tấm xác nhận; tấm giữ nút bận tới khi danh sách gói mới về. Đơn mới vào tab Đơn hàng.
  const runNowMut = useLockedMutation({
    mutationFn: (id: string) => runSubscriptionNow(coreHttp, id),
    onMutate: () => {
      setNotice(null);
      setRejected(null);
    },
    onSuccess: (res) => {
      setNotice(runNowDoneText(res?.order));
      setRunNowTarget(null);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      // Gói trả bằng Ví Tubu bị trừ tiền ngay khi ra đơn.
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      return settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] }));
    },
    onError: (e) => {
      setRunNowTarget(null);
      return onActionError(e);
    },
    onSettled: releaseActing,
  });

  const targetSub = subs.find((s) => s.id === cancelTarget) ?? null;
  const editSub = subs.find((s) => s.id === editTarget) ?? null;
  const runNowSub = subs.find((s) => s.id === runNowTarget) ?? null;
  const pending = statusMut.isPending ? statusMut.variables?.status : undefined;
  const sheetBusy = statusMut.isPending || skipMut.isPending || runNowMut.isPending;
  const tierText = nextTierText(subs);
  const changeFromSheet = (status: SubStatus) => {
    if (!cancelTarget) return;
    exclusive(() => statusMut.mutate({ id: cancelTarget, status, from: 'sheet' }));
  };
  const actionError =
    rejected ??
    (statusMut.isError
      ? actionErrorText(statusMut.error)
      : skipMut.isError
        ? actionErrorText(skipMut.error)
        : runNowMut.isError
          ? actionErrorText(runNowMut.error)
          : null);

  return (
    <div className="flex flex-col gap-3 pb-6 pt-1 max-md:px-1">
      <div>
        <p className="text-sm text-stone-700 tabular-nums">
          {subscribePct > 0
            ? `Tự động đặt lại sản phẩm bạn dùng thường xuyên — tiết kiệm ${subscribePct}% mỗi đơn, huỷ bất kỳ lúc nào.`
            : 'Tự động đặt lại sản phẩm bạn dùng thường xuyên — huỷ bất kỳ lúc nào.'}
        </p>
        {subs[0] && subs[0].effectiveDiscountPct > 0 && (
          <p className="mt-1 text-xs font-medium text-forest-700 tabular-nums">{`Đang giảm ${Math.round(subs[0].effectiveDiscountPct * 100)}% cho đơn định kỳ`}</p>
        )}
        {tierText && (
          <div data-testid="subscription-next-tier" className="mt-1.5">
            <Badge tone="brand" size="sm" className="tabular-nums">
              {tierText}
            </Badge>
          </div>
        )}
      </div>

      {notice && (
        <p role="status" className="text-sm font-medium text-success-fg">
          {notice}
        </p>
      )}
      {actionError && !cancelTarget && !editSub && (
        <p role="alert" className={ui.error}>
          {actionError}
        </p>
      )}

      {suggestion && <SubscriptionSuggestionRow suggestion={suggestion} discountFraction={discountFraction} onAccept={setSubscribeTo} />}
      {subscribeTo && <SuggestedSubscribe suggestion={subscribeTo} onDone={() => setSubscribeTo(null)} />}

      {!authed || subsQ.isLoading ? (
        <>
          <LineItemSkeleton />
          <LineItemSkeleton />
        </>
      ) : subsQ.isError ? (
        <ErrorState variant="inline" message={errText(subsQ.error)} onRetry={() => subsQ.refetch()} />
      ) : subs.length > 0 ? (
        // Từ md hai cột: một gói đứng một mình không dãn hết khung rộng 1150px, thẻ vẫn vừa dòng chữ. Dưới md giữ một cột như Mini App.
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start">
          {subs.map((s) => (
            <SubscriptionCard
              key={s.id}
              sub={s}
              busy={sheetBusy}
              toggling={statusMut.isPending && statusMut.variables?.id === s.id && statusMut.variables.from === 'card'}
              skipping={skipMut.isPending && skipMut.variables?.id === s.id && cancelTarget === null}
              refreshing={subsQ.isFetching}
              address={s.addressId ? addressById.get(s.addressId) : undefined}
              onEdit={() => {
                if (acting.current || subsQ.isFetching) return;
                setEditTarget(s.id);
              }}
              onToggle={() => exclusive(() => statusMut.mutate({ id: s.id, status: s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE', from: 'card' }))}
              onCancel={() => {
                if (acting.current) return;
                statusMut.reset();
                skipMut.reset();
                cancelShownRunAt.current = s.nextRunAt;
                setCancelTarget(s.id);
              }}
              onSkip={() => exclusive(() => skipMut.mutate({ id: s.id, expectedNextRunAt: s.nextRunAt }))}
              onRunNow={() => {
                if (acting.current || subsQ.isFetching) return;
                runNowMut.reset();
                setRunNowTarget(s.id);
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
        <SubscriptionEditSheet
          key={editSub.id}
          sub={editSub}
          onClose={() => {
            setRejected(null);
            setEditTarget(null);
          }}
          onSaved={setNotice}
          onRejected={setRejected}
        />
      )}

      {runNowSub && (
        <ConfirmSheet
          open
          title={selfServeCopy('runNowTitle')}
          message={runNowConfirmBody(runNowSub)}
          confirmLabel={selfServeCopy('runNowConfirm')}
          cancelLabel={selfServeCopy('runNowCancel')}
          loading={runNowMut.isPending}
          onConfirm={() => exclusive(() => runNowMut.mutate(runNowSub.id))}
          onCancel={() => {
            if (!runNowMut.isPending) setRunNowTarget(null);
          }}
        />
      )}

      <Sheet
        open={cancelTarget !== null}
        onClose={() => {
          if (!sheetBusy) setCancelTarget(null);
        }}
        dismissible={!sheetBusy}
        title="Giữ lại lịch định kỳ?"
        description="Tạm dừng hoặc bỏ qua kỳ này, thay vì huỷ hẳn nhé."
      >
        <div className="flex flex-col gap-2.5">
          {actionError && (
            <p role="alert" className={ui.error}>
              {actionError}
            </p>
          )}
          {/* Nút đang chạy giữ aria-busy/aria-disabled chứ không `disabled` DOM: Chromium thả focus về body khi nút đang giữ focus bị disabled. */}
          <button
            type="button"
            className={ui.btnPrimary}
            disabled={sheetBusy && pending !== 'PAUSED'}
            aria-busy={pending === 'PAUSED' || undefined}
            aria-disabled={pending === 'PAUSED' || undefined}
            onClick={() => changeFromSheet('PAUSED')}
          >
            {pending === 'PAUSED' ? 'Đang xử lý…' : 'Tạm dừng'}
          </button>
          {targetSub?.status === 'ACTIVE' && (
            <button
              type="button"
              className={ui.btnSecondary}
              disabled={statusMut.isPending}
              aria-busy={skipMut.isPending || undefined}
              aria-disabled={skipMut.isPending || undefined}
              onClick={() => {
                if (!targetSub) return;
                exclusive(() => skipMut.mutate({ id: targetSub.id, expectedNextRunAt: cancelShownRunAt.current ?? targetSub.nextRunAt }));
              }}
            >
              {skipMut.isPending ? 'Đang xử lý…' : 'Bỏ qua kỳ này'}
            </button>
          )}
          <button
            type="button"
            className={`${ui.btnSecondary} border-danger-fg text-danger-fg`}
            disabled={sheetBusy && pending !== 'CANCELLED'}
            aria-busy={pending === 'CANCELLED' || undefined}
            aria-disabled={pending === 'CANCELLED' || undefined}
            onClick={() => changeFromSheet('CANCELLED')}
          >
            {pending === 'CANCELLED' ? 'Đang xử lý…' : 'Vẫn huỷ'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function SubscriptionCard({
  sub: s,
  busy,
  toggling,
  skipping,
  refreshing,
  address,
  onEdit,
  onToggle,
  onCancel,
  onSkip,
  onRunNow,
}: {
  sub: SubscriptionDTO;
  busy: boolean;
  /** Chính thẻ này đang bỏ qua kỳ bằng nút trên thẻ: nút giữ aria-busy, không `disabled`, để không mất focus. */
  skipping: boolean;
  onSkip: () => void;
  onRunNow: () => void;
  /** Chính thẻ này đang đổi Tạm dừng/Tiếp tục bằng nút trên thẻ (không tính lệnh gửi từ sheet): nút đó giữ aria-busy thay vì `disabled` để không mất focus. */
  toggling: boolean;
  /** Danh sách đang tải lại: "Sửa" chờ, kẻo mở sheet trên số liệu cũ (vừa lưu 3 mà form hiện 2, lần lưu sau ghi đè về 2). */
  refreshing: boolean;
  address?: Parameters<typeof addressText>[0];
  onEdit: () => void;
  onToggle: () => void;
  onCancel: () => void;
}) {
  const cycle = subscriptionCycleView(s);
  // Gói không chạy nói rõ vì sao và cách chạy lại; không biết lý do (gói dừng từ trước, API cũ) thì chỉ dòng chung.
  const pause = s.status === 'ACTIVE' ? null : subscriptionPauseView(s.pausedReason);
  return (
    <li className={`p-3 ${ui.card} ${mini.card}`}>
      <div className="flex gap-3">
        <div className="flex-none">
          <ProductThumb src={s.thumbnail} alt={s.productName} size={56} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-stone-900">{s.productName}</div>
          <div className="text-xs text-stone-600 tabular-nums">{joinDetailParts([variationLabel(s.variationName), `SL ${s.quantity}`])}</div>
          <div className="text-xs font-semibold text-forest-700 tabular-nums">{`Mỗi ${s.intervalWeeks} tuần · ${formatVnd(cycle.goods)}`}</div>
          {cycle.discount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <s className="text-xs text-stone-600 tabular-nums">{formatVnd(cycle.subtotal)}</s>
              <Badge tone="success" size="sm" className="tabular-nums">{`Tiết kiệm ${cycle.savePct}%`}</Badge>
            </div>
          )}
          <div className="text-xs text-stone-600">{`Thanh toán: ${PAY_SHORT[s.paymentMethod ?? 'COD']}`}</div>
          {address && <div className="break-words text-xs text-stone-600">{`Giao tới: ${addressText(address)}`}</div>}
        </div>
        <Badge tone={STATUS_TONE[s.status]} size="sm" className="self-start">
          {STATUS_LABEL[s.status]}
        </Badge>
      </div>
      <div className={`mt-2.5 text-xs text-stone-700 tabular-nums ${pause && pause.title !== SUBSCRIPTION_PAUSED_GENERIC ? 'font-semibold' : ''}`}>
        {pause ? pause.title : s.nextRunAt ? `Lần kế: ${formatDate(s.nextRunAt)}` : 'Đang lên lịch'}
      </div>
      {pause?.hint && <p className="mt-0.5 text-xs text-stone-600">{pause.hint}</p>}
      {canActOnCycle(s) && (
        // Hai việc của kỳ tới, ngay dưới ngày "Lần kế": nút chữ gọn, không thêm nút chính. "Đặt kỳ này ngay" mở tấm xác nhận nên trả focus về đây.
        <div className="mt-1 flex flex-wrap gap-x-3" data-testid="subscription-cycle-actions">
          <button
            type="button"
            aria-busy={skipping || undefined}
            aria-disabled={busy || refreshing || undefined}
            onClick={() => {
              if (!busy && !refreshing) onSkip();
            }}
            className={CYCLE_BTN}
          >
            {skipping ? 'Đang xử lý…' : selfServeCopy('skip')}
          </button>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-disabled={busy || refreshing || undefined}
            onClick={() => {
              if (!busy && !refreshing) onRunNow();
            }}
            className={CYCLE_BTN}
          >
            {selfServeCopy('runNow')}
          </button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {/* "Sửa" và "Huỷ" mở sheet và sheet trả focus về đúng nút này khi đóng: lúc đó lệnh vừa gửi từ sheet còn chờ danh sách mới (busy vẫn true),
            nên khoá bằng aria-disabled (chặn ở onEdit/onCancel) chứ không `disabled`, nếu không focus rơi về body. */}
        <button type="button" aria-disabled={busy || refreshing || undefined} onClick={onEdit} className={`${ui.btnSecondary} ${mini.secondary} min-w-max flex-1`}>
          Sửa
        </button>
        <button
          type="button"
          disabled={busy && !toggling}
          aria-busy={toggling || undefined}
          aria-disabled={toggling || undefined}
          onClick={onToggle}
          className={`${ui.btnSecondary} ${mini.secondary} min-w-max flex-1`}
        >
          {toggling ? 'Đang xử lý…' : s.status === 'ACTIVE' ? 'Tạm dừng' : 'Tiếp tục'}
        </button>
        <button type="button" aria-disabled={busy || undefined} onClick={onCancel} className={miniGhostDanger}>
          Huỷ
        </button>
      </div>
    </li>
  );
}
