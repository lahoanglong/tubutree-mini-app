import { useEffect, useRef, useState } from 'react';
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
import { BottomSheet } from '../ui/bottom-sheet';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Switch } from '../ui/form';
import { ProgressBar } from '../ui/progress-bar';
import { QuantitySelector } from '../ui/quantity-selector';
import { Skeleton } from '../ui/skeleton';
import { PriceTag } from '../ui/price-tag';
import { Text } from '../ui/text';
import { haptic } from '../../utils/haptic';
import { vi } from '../../i18n/vi';
import '../../css/checkout-pickup.css';

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
  onOpenRequests?: () => void;
  /** Gợi ý gửi lại bao bì (cờ `checkout.return_packaging_nudge_enabled`); null = thẻ như cũ. */
  nudge?: ReturnNudge | null;
  /** Gọi sau khi công tắc áp gợi ý bằng một chạm (đo phễu). */
  onNudgeApplied?: () => void;
  /** Gọi một lần khi gợi ý hiện lần đầu (đo phễu). */
  onNudgeShown?: () => void;
}

/**
 * Một thẻ duy nhất cho "Đổi rác kèm đơn": đóng là một hàng (chữ + công tắc), mở ra tấm chọn món/kg với đúng một nút Xong.
 * Thay luôn mục "Thu kèm rác" cũ (gắn phiếu có sẵn): phiếu mở có sẵn được chọn sẵn trong tấm qua `existingRequest`.
 * Có gợi ý bao bì (`nudge`): hàng nêu đúng bao bì khách đang giữ; đủ điểm thì bật công tắc là áp luôn, không thì công tắc mở tấm đã điền sẵn.
 * Không thêm nút nào: công tắc vẫn là lối duy nhất để bật.
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
  onOpenRequests,
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
  const nudgeVisible = !!view && !view.disabled && applied === null && nudge !== null;
  const nudgeSeen = useRef(false);
  useEffect(() => {
    if (!nudgeVisible || nudgeSeen.current) return;
    nudgeSeen.current = true;
    onNudgeShown?.();
  }, [nudgeVisible, onNudgeShown]);
  if (!view) return null;

  const openSheet = () => {
    if (view.disabled) return;
    haptic('light');
    onOpenChange(true);
  };
  const isApplied = applied !== null;
  const nudgeView = nudgeVisible && nudge ? pickupNudgeView(nudge) : null;
  const turnOn = () => {
    if (!nudge?.oneTap || !nudgeView) return openSheet();
    haptic('medium');
    onApply({ ...nudge.draft, qty: { ...nudge.draft.qty } });
    onNudgeApplied?.();
  };

  return (
    <section className="tubu-pickup" aria-label={view.title} data-testid="checkout-pickup" data-nudge={nudgeView ? 'true' : undefined}>
      <div className="tubu-pickup-row">
        <button
          type="button"
          className="tubu-pickup-body tubu-press"
          aria-label={nudgeView?.ariaLabel ?? view.ariaLabel}
          aria-disabled={view.disabled || undefined}
          onClick={openSheet}
        >
          <span className="tubu-pickup-head">
            <Text variant="body-sm" style={{ fontWeight: 600 }}>{view.title}</Text>
            {view.badge && <Badge tone="success" size="sm">{view.badge}</Badge>}
          </span>
          {nudgeView ? (
            <span className="tubu-pickup-nudge" data-testid="checkout-pickup-nudge">
              <Text variant="caption" tone="primary" as="span" numeric>{nudgeView.lead}</Text>
              <Text variant="caption" tone="success" as="span" numeric style={{ fontWeight: 600 }}>
                {nudgeView.benefit}
              </Text>
            </span>
          ) : (
            <Text variant="caption" tone={view.subTone === 'warn' ? 'warning' : 'secondary'} className="tubu-pickup-sub" numeric>
              {view.sub}
            </Text>
          )}
        </button>
        <Switch
          checked={isApplied}
          disabled={view.disabled}
          aria-label={nudgeView?.oneTap ? nudgeView.benefit : view.title}
          onChange={() => {
            if (isApplied) {
              haptic('light');
              onClear();
            } else turnOn();
          }}
        />
      </div>
      {maxOpenError && (
        <div className="tubu-pickup-max-open" role="alert" data-testid="checkout-pickup-max-open">
          <Text variant="caption" tone="danger" as="span">
            {maxOpenError}
          </Text>
          {onOpenRequests && (
            <button type="button" className="tubu-pickup-link" onClick={onOpenRequests}>
              {fillCopy('checkout.pickup.maxOpenLink')}
            </button>
          )}
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
        <div className="tubu-pickup-sheet" data-testid="checkout-pickup-sheet">
          {optionsError ? (
            <>
              <Text variant="body-sm" tone="danger">{fillCopy('checkout.pickup.loadFailed')}</Text>
              <Button variant="secondary" onPress={onRetryOptions}>{vi.common.retry}</Button>
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
    <div className="tubu-pickup-footer">
      {reason && (
        <Text variant="caption" tone="secondary" className="tubu-pickup-footer-reason" as="div">
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
        <div className="tubu-pickup-existing">
          <Text variant="body-sm" style={{ fontWeight: 600 }}>{pickupExistingLine(existing)}</Text>
          <Button variant="ghost" onPress={() => update((d) => draftFromRequestLines(existing, d.returnWeightGrams))}>
            {fillCopy('checkout.pickup.change')}
          </Button>
        </div>
      ) : (
        <div>
          {list.rows.map((row) => {
            const item = options.items.find((i) => i.id === row.id)!;
            return (
              <div key={row.id} className="tubu-pickup-item" data-blocked={row.blocked || undefined}>
                <div className="tubu-pickup-item-text">
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
            <Text variant="caption" tone="warning" as="p" className="tubu-pickup-note">
              {list.blockedNote}
            </Text>
          )}
        </div>
      )}
      <ProgressBar value={state.points} max={Math.max(1, options.minPoints)} label={progress.label} />
      <Text variant="label" tone="secondary" as="div">{fillCopy('checkout.pickup.kgTitle')}</Text>
      <div className="tubu-pickup-chips" role="group" aria-label={fillCopy('checkout.pickup.kgTitle')}>
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

/** Giá trị dòng phí giao khi được miễn vì đổi rác kèm đơn: số 0đ, phí gốc gạch ngang (PriceTag) và một câu nêu lý do, vẫn trong đúng một dòng KeyValueRow. */
export function WaivedShippingValue({ originalFee, note }: { originalFee: number; note: string }) {
  return (
    <span className="tubu-ship-waived" data-testid="ship-waived">
      <PriceTag value={0} compareAt={originalFee} size="sm" />
      <Text variant="caption" tone="success">{note}</Text>
    </span>
  );
}
