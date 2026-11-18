'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CheckoutPickupQuote, PickupOptionsResponse } from '@tubutree/shared-types';
import {
  PICKUP_QTY_MAX,
  defaultReturnWeightGrams,
  draftFromRequestLines,
  draftUsingRequest,
  pickupConfirmState,
  returnWeightChips,
  setItemQty,
  type PickupDraft,
} from '@tubutree/app-core/checkout-pickup-state';
import {
  pickupCardView,
  pickupConfirmReasonLabel,
  pickupExistingLine,
  pickupItemList,
  pickupProgressView,
  pickupWeightView,
} from '@tubutree/app-core/checkout-pickup-view';
import { pickupNudgeView, type ReturnNudge } from '@tubutree/app-core/return-packaging';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Badge, Button, Chip, PriceTag, ProgressBar, QuantitySelector, Skeleton, Text } from '@/components/mini';
import { BottomSheet } from '@/components/mini/bottom-sheet';

interface PickupSectionProps {
  /** `undefined` = báo giá đang tải lại: giữ thẻ như lần trước để thẻ và tấm không biến mất giữa chừng. */
  pickup: CheckoutPickupQuote | null | undefined;
  /** Phí giao hiện tại của kiện Tubu; undefined khi báo giá chưa về. */
  tubuShippingFee: number | undefined;
  applied: PickupDraft | null;
  options: PickupOptionsResponse | undefined;
  optionsLoading: boolean;
  optionsError: boolean;
  onRetryOptions: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (draft: PickupDraft) => void;
  onClear: () => void;
  maxOpenError?: string | null;
  openRequestsHref?: string;
  disabled?: boolean;
  /** Gợi ý gửi lại bao bì (cờ `checkout.return_packaging_nudge_enabled`); null = thẻ như cũ. */
  nudge?: ReturnNudge | null;
  /** Gọi sau khi công tắc áp gợi ý bằng một chạm (đo phễu). */
  onNudgeApplied?: () => void;
  /** Gọi một lần khi gợi ý hiện lần đầu (đo phễu). */
  onNudgeShown?: () => void;
}

/**
 * Một thẻ duy nhất cho "Đổi rác kèm đơn": đóng là một hàng (chữ + công tắc), mở ra tấm chọn món/kg với đúng một nút Xong.
 * Thay mục "Thu kèm rác" cũ (gắn phiếu có sẵn): phiếu mở có sẵn được chọn sẵn trong tấm qua `existingRequest`. Cùng luật với Mini App.
 * Có gợi ý bao bì (`nudge`): hàng nêu đúng bao bì khách đang giữ; đủ điểm thì bật công tắc là áp luôn, không thì công tắc mở tấm đã điền sẵn.
 */
export function PickupSection({
  pickup,
  tubuShippingFee,
  applied,
  options,
  optionsLoading,
  optionsError,
  onRetryOptions,
  open,
  onOpenChange,
  onApply,
  onClear,
  maxOpenError,
  openRequestsHref = '/doi-rac/yeu-cau',
  disabled = false,
  nudge = null,
  onNudgeApplied,
  onNudgeShown,
}: PickupSectionProps) {
  const lastPickup = useRef<CheckoutPickupQuote | null>(null);
  const lastFee = useRef(0);
  if (pickup !== undefined) lastPickup.current = pickup;
  if (tubuShippingFee !== undefined) lastFee.current = tubuShippingFee;

  const [draft, setDraft] = useState<PickupDraft | null>(null);
  useEffect(() => {
    if (!open) {
      setDraft(null);
      return;
    }
    if (!options || draft) return;
    const weight = applied?.returnWeightGrams ?? defaultReturnWeightGrams(returnWeightChips(options.maxReturnWeightGrams));
    if (applied) setDraft({ ...applied, qty: { ...applied.qty } });
    else if (nudge) setDraft({ ...nudge.draft, qty: { ...nudge.draft.qty } });
    else if (options.existingRequest) setDraft(draftUsingRequest(options.existingRequest, weight));
    else setDraft({ requestId: null, qty: {}, returnWeightGrams: weight });
  }, [open, options, draft, applied, nudge]);

  const view = pickupCardView({ pickup: lastPickup.current, applied: applied !== null, tubuShippingFee: lastFee.current });
  const nudgeVisible = !!view && !view.disabled && !disabled && applied === null && nudge !== null;
  // Phễu chỉ đếm gợi ý bao bì từ đơn, mỗi lần vào trang một lần; phiếu đã đăng ký thì không phải gợi ý mới.
  const fromOrder = nudge?.source === 'ORDER';
  const nudgeSeen = useRef(false);
  const nudgeTaken = useRef(false);
  useEffect(() => {
    if (!nudgeVisible || !fromOrder || nudgeSeen.current) return;
    nudgeSeen.current = true;
    onNudgeShown?.();
  }, [nudgeVisible, fromOrder, onNudgeShown]);
  if (!view) return null;

  const locked = view.disabled || disabled;
  const isApplied = applied !== null;
  const openSheet = () => {
    if (!locked) onOpenChange(true);
  };
  const nudgeView = nudgeVisible && nudge ? pickupNudgeView(nudge) : null;
  const turnOn = () => {
    if (!nudge?.oneTap || !nudgeView) return openSheet();
    onApply({ ...nudge.draft, qty: { ...nudge.draft.qty } });
    if (fromOrder && !nudgeTaken.current) {
      nudgeTaken.current = true;
      onNudgeApplied?.();
    }
  };

  return (
    <section
      aria-label={view.title}
      data-testid="checkout-pickup"
      data-nudge={nudgeView ? 'true' : undefined}
      className="mt-3 border-t border-[var(--color-border-subtle)] pt-3 tabular-nums"
    >
      <div className={`flex min-h-14 items-center gap-3 ${nudgeView ? 'rounded-card bg-[var(--color-status-success-bg)] p-2' : ''}`}>
        <button
          type="button"
          aria-label={nudgeView?.ariaLabel ?? view.ariaLabel}
          aria-disabled={locked || undefined}
          onClick={openSheet}
          className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 text-left"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <Text variant="body-sm" style={{ fontWeight: 600 }}>{view.title}</Text>
            {view.badge && <Badge tone="success" size="sm">{view.badge}</Badge>}
          </span>
          {nudgeView ? (
            <span className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere]" data-testid="checkout-pickup-nudge">
              <Text variant="caption" tone="primary" as="span" numeric>{nudgeView.lead}</Text>
              <Text variant="caption" tone="success" as="span" numeric style={{ fontWeight: 600 }}>
                {nudgeView.benefit}
              </Text>
            </span>
          ) : (
            <Text variant="caption" tone={view.subTone === 'warn' ? 'warning' : 'secondary'} className="truncate" numeric>
              {view.sub}
            </Text>
          )}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={isApplied}
          aria-label={nudgeView?.oneTap ? nudgeView.benefit : view.title}
          aria-disabled={locked || undefined}
          onClick={() => {
            if (locked) return;
            if (isApplied) onClear();
            else turnOn();
          }}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center"
        >
          <span aria-hidden="true" className={`relative h-6 w-11 rounded-full transition-colors ${isApplied ? 'bg-[var(--color-action-primary-bg)]' : 'bg-[var(--color-border-strong)]'}`}>
            <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-[var(--color-bg-surface)] shadow-card transition-transform ${isApplied ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </span>
        </button>
      </div>
      {maxOpenError && (
        <div role="alert" data-testid="checkout-pickup-max-open" className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Text variant="caption" tone="danger" as="span">
            {maxOpenError}
          </Text>
          <Link href={openRequestsHref} className="inline-flex min-h-11 items-center text-caption font-semibold text-[var(--color-text-link)] underline">
            {fillCopy('checkout.pickup.maxOpenLink')}
          </Link>
        </div>
      )}
      <BottomSheet
        open={open}
        onClose={() => onOpenChange(false)}
        title={fillCopy('checkout.pickup.sheetTitle')}
        footer={
          <SheetFooter
            draft={draft}
            options={options}
            onDone={() => {
              if (!draft) return;
              onApply(draft);
              onOpenChange(false);
            }}
          />
        }
      >
        <div className="flex flex-col gap-3 tabular-nums" data-testid="checkout-pickup-sheet">
          {optionsError ? (
            <>
              <Text variant="body-sm" tone="danger">{fillCopy('checkout.pickup.loadFailed')}</Text>
              <Button variant="secondary" onPress={onRetryOptions}>Thử lại</Button>
            </>
          ) : optionsLoading || !options || !draft ? (
            <>
              <Skeleton height={56} />
              <Skeleton height={56} />
            </>
          ) : (
            <SheetBody draft={draft} options={options} setDraft={setDraft} />
          )}
        </div>
      </BottomSheet>
    </section>
  );
}

function SheetFooter({ draft, options, onDone }: { draft: PickupDraft | null; options: PickupOptionsResponse | undefined; onDone: () => void }) {
  const state = draft && options ? pickupConfirmState(draft, options) : null;
  const reason = state ? pickupConfirmReasonLabel(state) : null;
  return (
    <div className="flex flex-col gap-2">
      {reason && (
        <Text variant="caption" tone="secondary" as="div" className="text-center">
          {reason}
        </Text>
      )}
      <Button fullWidth disabled={!state?.ok} onPress={onDone}>
        {fillCopy('checkout.pickup.done')}
      </Button>
    </div>
  );
}

function SheetBody({ draft, options, setDraft }: { draft: PickupDraft; options: PickupOptionsResponse; setDraft: (fn: (d: PickupDraft | null) => PickupDraft | null) => void }) {
  const state = pickupConfirmState(draft, options);
  const progress = pickupProgressView(state.points, options.minPoints);
  const weight = pickupWeightView(options.maxReturnWeightGrams);
  const list = pickupItemList(options.items, draft.qty);
  const existing = draft.requestId && options.existingRequest?.id === draft.requestId ? options.existingRequest : null;
  const update = (fn: (d: PickupDraft) => PickupDraft) => setDraft((d) => (d ? fn(d) : d));

  return (
    <>
      {existing ? (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Text variant="body-sm" className="min-w-0 truncate" style={{ fontWeight: 600 }}>{pickupExistingLine(existing)}</Text>
          <Button variant="ghost" onPress={() => update((d) => draftFromRequestLines(existing, d.returnWeightGrams))}>
            {fillCopy('checkout.pickup.change')}
          </Button>
        </div>
      ) : (
        <div>
          {list.rows.map((row) => {
            const item = options.items.find((i) => i.id === row.id)!;
            return (
              <div key={row.id} data-blocked={row.blocked || undefined} className="flex min-h-14 items-center justify-between gap-3 border-t border-[var(--color-border-subtle)] py-1 first:border-t-0 data-[blocked]:opacity-50">
                <div className="min-w-0 flex-1 break-words">
                  <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>{row.name}</Text>
                  <Text variant="caption" tone="tertiary" as="div" numeric>{row.detail}</Text>
                </div>
                <QuantitySelector
                  size="sm"
                  min={0}
                  max={PICKUP_QTY_MAX}
                  value={row.qty}
                  disabled={row.blocked}
                  itemLabel={row.name}
                  onChange={(n) => update((d) => setItemQty(d, item, n))}
                />
              </div>
            );
          })}
          {list.blockedNote && (
            <Text variant="caption" tone="warning" as="p" className="mt-2">
              {list.blockedNote}
            </Text>
          )}
        </div>
      )}
      <ProgressBar value={state.points} max={Math.max(1, options.minPoints)} label={progress.label} />
      <Text variant="label" tone="secondary" as="div">{fillCopy('checkout.pickup.kgTitle')}</Text>
      <div className="flex flex-wrap gap-2" role="group" aria-label={fillCopy('checkout.pickup.kgTitle')}>
        {weight.chips.map((c) => (
          <Chip key={c.grams} variant="choice" selected={draft.returnWeightGrams === c.grams} onPress={() => update((d) => ({ ...d, returnWeightGrams: c.grams }))}>
            {c.label}
          </Chip>
        ))}
      </div>
      <Text variant="caption" tone="secondary" as="p">{weight.note}</Text>
    </>
  );
}

/** Giá trị dòng phí giao khi được miễn vì đổi rác kèm đơn: số 0đ, phí gốc gạch ngang (PriceTag) và một câu nêu lý do. */
export function WaivedShippingValue({ originalFee, note }: { originalFee: number; note: string }) {
  return (
    <span className="flex min-w-0 flex-col items-end text-right tabular-nums" data-testid="ship-waived">
      <PriceTag value={0} compareAt={originalFee} size="sm" />
      <Text variant="caption" tone="success">{note}</Text>
    </span>
  );
}
