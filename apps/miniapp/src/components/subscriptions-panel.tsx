import { useRef, useState } from 'react';
import { useSnackbar } from 'zmp-ui';
import { useSmartNavigate } from '../lib/smart-nav';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSubscriptions,
  runSubscriptionNow,
  setSubscriptionStatus,
  isStaleSubscriptionError,
  skipSubscriptionCycle,
  type SubscriptionDTO,
} from '../services/subscriptions-api';
import { canActOnCycle, nextTierText, runNowConfirmBody, runNowDoneText, selfServeCopy, skipDoneText } from '@tubutree/app-core/subscription-self-serve';
import { subscriptionCycleView } from '../utils/subscription-price';
import { subscriptionPauseView, SUBSCRIPTION_PAUSED_GENERIC } from '@tubutree/app-core/subscription-pause-copy';
import { getAddresses } from '../services/shop-api';
import { getErrorMessage, getLoadErrorMessage, isServerRejection } from '../services/api';
import { useAuthStore } from '../store/auth';
import { usePublicConfig } from '../hooks/use-public-config';
import { formatDate, formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { closeAfterFresh, settleWithin } from '../utils/settle-within';
import { joinDetailParts, variationLabel } from '../utils/variation-label';
import { viSubscriptions } from '../i18n/vi-subscriptions';
import { Badge, type BadgeTone } from './ui/badge';
import { BottomSheet } from './ui/bottom-sheet';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { ConfirmSheet } from './ui/confirm-sheet';
import { EmptyState, ErrorState } from './ui/empty-state';
import { LineItemSkeleton } from './ui/skeleton';
import { Text } from './ui/text';
import { useLockedMutation } from './game/use-locked-mutation';
import { SubscriptionEditSheet } from './subscription-edit-sheet';
import { addressText } from './subscription-options';
import { ProductThumb } from './ui/product-thumb';
import type { SubscriptionSuggestion } from '@tubutree/app-core/commerce/green-box';
import { hasLiveSubscription } from '../hooks/use-has-subscription';
import { SubscriptionSuggestionRow, SuggestedSubscribe, useSubscriptionSuggestion } from './reorder/subscription-suggestion';

type SubStatus = SubscriptionDTO['status'];
const STATUS_TONE: Record<SubStatus, BadgeTone> = { ACTIVE: 'success', PAUSED: 'warning', CANCELLED: 'neutral' };

/**
 * Nội dung "Đặt định kỳ" — nhúng làm tab "Định kỳ" của trang Đơn hàng (spec 4a.2): tạm dừng/tiếp tục,
 * sửa số lượng/chu kỳ/ngày giao kỳ tới/địa chỉ/cách trả (C-015), bỏ qua kỳ này và "Đặt kỳ này ngay" ngay trên thẻ gói đang chạy,
 * viên bậc giảm kế tiếp, huỷ qua sheet giữ chân (tạm dừng / bỏ qua kỳ / vẫn huỷ). Cùng web `components/orders/subscriptions-panel.tsx`.
 */
export function SubscriptionsPanel() {
  const goSmart = useSmartNavigate();
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  // /me/subscriptions cần auth — fetch trước khi restore() xong sẽ 401 và kẹt (retry:false cho 4xx).
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const subsQ = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions, enabled: authed });
  const cfg = usePublicConfig();
  const subs = subsQ.data ?? [];
  // % thực tế đang áp (thang bậc) thắng % cấu hình chung khi đã có lịch.
  const subscribePct = Math.round((subs[0]?.effectiveDiscountPct ?? cfg.subscribeDiscountPct) * 100);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  // "Lần kế" của thẻ lúc mở sheet giữ chân: sheet không hiện ngày, danh sách tải lại nền qua 03:00 thì `targetSub` đã sang kỳ sau và skip sẽ bỏ nhầm kỳ đó.
  const cancelShownRunAt = useRef<string | null>(null);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [runNowTarget, setRunNowTarget] = useState<string | null>(null);
  // Gợi ý định kỳ chỉ khi khách chưa có gói nào đang chạy hay tạm dừng.
  const { suggestion, discountFraction } = useSubscriptionSuggestion(subsQ.isSuccess && !hasLiveSubscription(subs));
  const [subscribeTo, setSubscribeTo] = useState<SubscriptionSuggestion | null>(null);
  // Nhiều gói cùng SP chỉ khác nhau ở địa chỉ, nên thẻ phải hiện địa chỉ để khách phân biệt.
  const addrQ = useQuery({ queryKey: ['addresses'], queryFn: getAddresses, enabled: authed && subs.length > 0 });
  const addressById = new Map((addrQ.data ?? []).map((a) => [a.id, a]));

  // Tạm dừng/Tiếp tục/Huỷ và Bỏ qua kỳ loại trừ nhau trên mọi gói (giao diện cũng khoá hết nút thẻ khi một việc đang chạy): một việc
  // mỗi lúc, khoá ref vì `isPending` chỉ đúng sau lần vẽ kế tiếp (chạm "Tạm dừng" rồi "Vẫn huỷ" sát nhau vẫn gửi cả hai lệnh).
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
  // như lệnh thành công. Lỗi tạm (mạng, 5xx) thì để nguyên danh sách.
  const onActionError = (e: unknown, id: string) => {
    openSnackbar({ text: getErrorMessage(e), type: 'error' });
    const held = isStaleSubscriptionError(e) ? settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] })) : undefined;
    if (!isServerRejection(e)) return held;
    // Sheet giữ chân chỉ có ba lựa chọn, không ô nhập: máy chủ từ chối hẳn (400/404/409/422) thì gói đã khác thẻ, bấm lại nhận đúng lỗi đó nên đóng sheet, SAU khi danh sách mới về để nút báo bận tới lúc đó.
    // Sheet có thể đã đóng rồi mở cho gói khác trong lúc lệnh bay và lúc chờ: chỉ đóng sheet của đúng gói này. Mất mạng, quá hạn, 401, 5xx giữ sheet để thử lại.
    return closeAfterFresh(held, () => setCancelTarget((cur) => (cur === id ? null : cur)));
  };

  const statusMut = useLockedMutation({
    onSettled: releaseActing,
    mutationFn: ({ id, status }: { id: string; status: SubStatus }) => setSubscriptionStatus(id, status),
    // Trả Promise: khoá (và `exclusive`) giữ tới khi danh sách làm mới về (tối đa `settleWithin`), kẻo nút thẻ sáng lại với nhãn/trạng thái cũ
    // trong lúc chờ. Sheet đóng ngay sau lệnh, không chờ danh sách.
    onSuccess: () => {
      haptic('light');
      setCancelTarget(null);
      return settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] }));
    },
    onError: (e, { id }) => onActionError(e, id),
  });

  const skipMut = useLockedMutation({
    onSettled: releaseActing,
    // Gửi kèm "Lần kế" thẻ đang hiện: cron 03:00 vừa ra đơn kỳ đó thì máy chủ trả 409 và danh sách tải lại, không lặng lẽ bỏ qua kỳ sau.
    mutationFn: ({ id, expectedNextRunAt }: { id: string; expectedNextRunAt: string }) => skipSubscriptionCycle(id, expectedNextRunAt),
    onSuccess: (sub) => {
      haptic('light');
      openSnackbar({ text: skipDoneText(sub?.nextRunAt), type: 'success' });
      setCancelTarget(null);
      return settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] }));
    },
    onError: (e, { id }) => onActionError(e, id),
  });

  // "Đặt kỳ này ngay" tạo đơn (Ví Tubu trừ tiền ngay) nên qua tấm xác nhận; tấm giữ nút bận tới khi danh sách gói mới về. Đơn mới vào tab Đơn hàng.
  const runNowMut = useLockedMutation({
    onSettled: releaseActing,
    mutationFn: (id: string) => runSubscriptionNow(id),
    onSuccess: (res) => {
      haptic('light');
      openSnackbar({ text: runNowDoneText(res?.order), type: 'success' });
      setRunNowTarget(null);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      // Gói trả bằng Ví Tubu bị trừ tiền ngay khi ra đơn.
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      return settleWithin(qc.invalidateQueries({ queryKey: ['subscriptions'] }));
    },
    onError: (e, id) => {
      setRunNowTarget(null);
      return onActionError(e, id);
    },
  });

  const targetSub = subs.find((s) => s.id === cancelTarget) ?? null;
  const editSub = subs.find((s) => s.id === editTarget) ?? null;
  const runNowSub = subs.find((s) => s.id === runNowTarget) ?? null;
  const pending = statusMut.isPending ? statusMut.variables?.status : undefined;
  const sheetBusy = statusMut.isPending || skipMut.isPending || runNowMut.isPending;
  const tierText = nextTierText(subs);
  const changeFromSheet = (status: SubStatus) => {
    if (!cancelTarget) return;
    exclusive(() => statusMut.mutate({ id: cancelTarget, status }));
  };

  return (
    <div style={{ padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Text variant="body-sm" tone="secondary" as="p" numeric>
          {viSubscriptions.intro(subscribePct)}
        </Text>
        {subs[0] && (
          <Text variant="caption" tone="brand" as="p" numeric style={{ marginTop: 4 }}>
            {viSubscriptions.discountLine(Math.round(subs[0].effectiveDiscountPct * 100))}
          </Text>
        )}
        {tierText && (
          <div data-testid="subscription-next-tier" style={{ marginTop: 'var(--space-stack-xs)' }}>
            <Badge tone="brand" size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {tierText}
            </Badge>
          </div>
        )}
      </div>

      {suggestion && <SubscriptionSuggestionRow suggestion={suggestion} discountFraction={discountFraction} onAccept={setSubscribeTo} />}
      {subscribeTo && <SuggestedSubscribe suggestion={subscribeTo} onDone={() => setSubscribeTo(null)} />}

      {!authed || subsQ.isLoading ? (
        <>
          <LineItemSkeleton />
          <LineItemSkeleton />
        </>
      ) : subsQ.isError ? (
        <ErrorState variant="inline" message={getLoadErrorMessage(subsQ.error)} onRetry={() => subsQ.refetch()} />
      ) : subs.length > 0 ? (
        subs.map((s) => (
          <SubscriptionCard
            key={s.id}
            sub={s}
            busy={sheetBusy}
            toggling={statusMut.isPending && statusMut.variables?.id === s.id && statusMut.variables.status !== 'CANCELLED' && cancelTarget === null}
            skipping={skipMut.isPending && skipMut.variables?.id === s.id && cancelTarget === null}
            refreshing={subsQ.isFetching}
            address={s.addressId ? addressById.get(s.addressId) : undefined}
            onEdit={() => {
              if (subsQ.isFetching) return;
              setEditTarget(s.id);
            }}
            onToggle={() => exclusive(() => statusMut.mutate({ id: s.id, status: s.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }))}
            onCancel={() => {
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
        ))
      ) : (
        <EmptyState
          variant="inline"
          art="box"
          heading={viSubscriptions.emptyHeading}
          body={viSubscriptions.emptyBody}
          ctaLabel={viSubscriptions.emptyCta}
          onCta={() => goSmart('/browse')}
        />
      )}

      {editSub && <SubscriptionEditSheet key={editSub.id} sub={editSub} onClose={() => setEditTarget(null)} />}

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

      <BottomSheet
        open={cancelTarget !== null}
        onClose={() => {
          if (!sheetBusy) setCancelTarget(null);
        }}
        dismissible={!sheetBusy}
        title={viSubscriptions.saveTitle}
        description={viSubscriptions.saveBody}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button
            fullWidth
            loading={pending === 'PAUSED'}
            disabled={skipMut.isPending || (statusMut.isPending && pending !== 'PAUSED')}
            onPress={() => changeFromSheet('PAUSED')}
          >
            {viSubscriptions.pauseCta}
          </Button>
          {targetSub?.status === 'ACTIVE' && (
            <Button
              fullWidth
              variant="secondary"
              loading={skipMut.isPending}
              disabled={statusMut.isPending}
              onPress={() => {
                if (!targetSub) return;
                exclusive(() => skipMut.mutate({ id: targetSub.id, expectedNextRunAt: cancelShownRunAt.current ?? targetSub.nextRunAt }));
              }}
            >
              {viSubscriptions.skipCta}
            </Button>
          )}
          <Button
            fullWidth
            variant="ghost"
            loading={pending === 'CANCELLED'}
            disabled={skipMut.isPending || (statusMut.isPending && pending !== 'CANCELLED')}
            onPress={() => changeFromSheet('CANCELLED')}
            style={{ color: 'var(--color-text-danger)' }}
          >
            {viSubscriptions.confirmCancelCta}
          </Button>
        </div>
      </BottomSheet>
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
  /** Chính thẻ này đang bỏ qua kỳ bằng nút trên thẻ: nút hiện spinner. */
  skipping: boolean;
  onSkip: () => void;
  onRunNow: () => void;
  /** Chính thẻ này đang đổi Tạm dừng/Tiếp tục: nút đó hiện spinner, không khoá DOM để giữ focus. */
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
    <Card padding={12}>
      <div style={{ display: 'flex', gap: 12 }}>
        <ProductThumb src={s.thumbnail} alt={s.productName} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
            {s.productName}
          </Text>
          <Text variant="caption" tone="tertiary" as="div" numeric>
            {joinDetailParts([variationLabel(s.variationName), `SL ${s.quantity}`])}
          </Text>
          <Text variant="caption" tone="brand" as="div" numeric style={{ fontWeight: 600 }}>
            {viSubscriptions.perCycle(s.intervalWeeks, formatVnd(cycle.goods))}
          </Text>
          {cycle.discount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <Text variant="caption" tone="tertiary" as="s" numeric>
                {formatVnd(cycle.subtotal)}
              </Text>
              <Badge tone="success" size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {viSubscriptions.savePill(cycle.savePct)}
              </Badge>
            </div>
          )}
          <Text variant="caption" tone="tertiary" as="div">
            {viSubscriptions.payLine(viSubscriptions.payShort[s.paymentMethod ?? 'COD'])}
          </Text>
          {address && (
            <Text variant="caption" tone="tertiary" as="div" style={{ overflowWrap: 'anywhere' }}>
              {viSubscriptions.addressLine(addressText(address))}
            </Text>
          )}
        </div>
        <Badge tone={STATUS_TONE[s.status]} size="sm" style={{ alignSelf: 'flex-start' }}>
          {viSubscriptions.statusLabel[s.status]}
        </Badge>
      </div>
      <Text
        variant="caption"
        tone="secondary"
        as="div"
        numeric
        style={{ marginTop: 10, fontWeight: pause && pause.title !== SUBSCRIPTION_PAUSED_GENERIC ? 600 : undefined }}
      >
        {pause ? pause.title : s.nextRunAt ? viSubscriptions.nextRun(formatDate(s.nextRunAt)) : viSubscriptions.scheduling}
      </Text>
      {pause?.hint && (
        <Text variant="caption" tone="tertiary" as="div">
          {pause.hint}
        </Text>
      )}
      {canActOnCycle(s) && (
        // Hai việc của kỳ tới, ngay dưới ngày "Lần kế": nút ghost gọn, không thêm nút chính.
        <div data-testid="subscription-cycle-actions" style={{ display: 'flex', flexWrap: 'wrap', columnGap: 'var(--space-inline-md)' }}>
          <Button variant="ghost" loading={skipping} disabled={(busy || refreshing) && !skipping} onPress={onSkip}>
            {selfServeCopy('skip')}
          </Button>
          <Button variant="ghost" aria-haspopup="dialog" disabled={busy || refreshing} onPress={onRunNow}>
            {selfServeCopy('runNow')}
          </Button>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <Button variant="secondary" disabled={busy || refreshing} onPress={onEdit} style={{ flex: '1 1 auto', minWidth: 'max-content' }}>
          {viSubscriptions.edit}
        </Button>
        <Button variant="secondary" loading={toggling} disabled={busy && !toggling} onPress={onToggle} style={{ flex: '1 1 auto', minWidth: 'max-content' }}>
          {s.status === 'ACTIVE' ? viSubscriptions.pause : viSubscriptions.resume}
        </Button>
        <Button variant="ghost" disabled={busy} onPress={onCancel} style={{ flex: '1 1 auto', minWidth: 'max-content', color: 'var(--color-text-danger)' }}>
          {viSubscriptions.cancel}
        </Button>
      </div>
    </Card>
  );
}
