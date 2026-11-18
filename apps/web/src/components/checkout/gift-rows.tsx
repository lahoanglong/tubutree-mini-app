'use client';

import { useId, useRef, useState } from 'react';
import type { GiftTrialSummaryDTO, QuotePendingGiftDTO } from '@tubutree/shared-types';
import { giftSectionView } from '@tubutree/app-core/checkout-pickup-view';
import { giftTrialRowView, giftTrialSheetView, type GiftTrialSheetOption } from '@tubutree/app-core/commerce/gift-trial';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Text } from '@/components/mini';
import { BottomSheet } from '@/components/mini/bottom-sheet';
import { CheckMark, miniCheckbox, miniCheckboxGutter, miniCheckboxWrap, miniRadio, miniRadioGutter } from '@/components/order-mobile/mobile-ui';

interface GiftRowsProps {
  gifts: readonly QuotePendingGiftDTO[];
  excluded: readonly string[];
  /** `receive=false` là để quà lại cho đơn sau; `receive=true` chọn quà này cho đơn hiện tại (hành vi radio khi có nhiều quà). */
  onToggle: (id: string, receive: boolean, pending?: readonly QuotePendingGiftDTO[]) => void;
  shortfallVnd?: number;
  disabled?: boolean;
}

/**
 * Quà hiện vật 0đ đi kèm đơn: mỗi quà một dòng, từ 3 quà trở lên gộp một dòng mở tấm nhỏ. Mặc định quà đi cùng đơn;
 * ô "Để đơn sau" chỉ là lối bỏ, không phải nút hành động của màn. Cùng luật với Mini App.
 */
export function GiftRows({ gifts, excluded, onToggle, shortfallVnd = 0, disabled = false }: GiftRowsProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const view = giftSectionView(gifts, excluded, shortfallVnd);
  if (view.layout === 'none') return null;

  const rows = view.rows.map((row) => (
    <div key={row.id} data-testid="checkout-gift-row" className="mt-3 flex min-h-11 items-center justify-between gap-3 tabular-nums first:mt-0">
      <div className={`flex min-w-0 flex-1 flex-col gap-0.5 break-words ${row.receive ? '' : 'opacity-60'}`}>
        <Text variant="body-sm" tone={row.receive ? 'primary' : 'secondary'} as="span" numeric>
          {row.label}
        </Text>
        {row.reason && (
          <Text variant="caption" tone="secondary" as="span" numeric>
            {row.reason}
          </Text>
        )}
      </div>
      {row.canToggle && (
        <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-caption text-[color:var(--color-text-secondary)]">
          <span className={`${miniCheckboxWrap} ${miniCheckboxGutter}`}>
            <input type="checkbox" checked={!row.receive} onChange={() => onToggle(row.id, !row.receive, gifts)} disabled={disabled} className={miniCheckbox} />
            <CheckMark />
          </span>
          {view.deferLabel}
        </label>
      )}
    </div>
  ));
  if (view.layout === 'rows') return <div className="mt-3">{rows}</div>;

  return (
    <>
      <div className="mt-3 flex min-h-11 items-center tabular-nums">
        <button type="button" onClick={() => setSheetOpen(true)} aria-haspopup="dialog" className="min-h-11 min-w-0 flex-1 text-left">
          <Text variant="body-sm" as="span">{view.mergedLabel}</Text>
        </button>
      </div>
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={view.sheetTitle}>
        {rows}
      </BottomSheet>
    </>
  );
}

/** Dòng chỉ đọc ở Giỏ: quà tự thêm ở bước thanh toán; chọn "Để đơn sau" chỉ có ở Thanh toán. */
export function GiftNote() {
  return (
    <p data-testid="cart-gift-note" className="mt-2 flex min-h-11 items-center tabular-nums">
      <Text variant="caption" tone="secondary">{fillCopy('cart.giftNote')}</Text>
    </p>
  );
}

export interface GiftTrialRowProps {
  summary: GiftTrialSummaryDTO | null | undefined;
  /** Giỏ: true (chưa đủ mốc thì nhắc số còn thiếu). Thanh toán: false (chưa đủ mốc thì ẩn). */
  showLocked: boolean;
  /** Khách chọn quà trong tấm; `null` = "Không nhận quà". Nơi gọi lưu lựa chọn rồi đọc lại giỏ/báo giá. */
  onChoose: (variationId: string | null) => void;
  busy?: boolean;
}

/**
 * Quà tặng dùng thử 0đ theo mốc giỏ: một dòng chữ (tên quà, mốc kế) và nút mở tấm "Chọn quà tặng 0đ". Quà là dòng 0đ đi cùng kiện
 * Tubu Tree, không đổi số tiền nào của đơn. Cùng luật và cùng chữ với Mini App.
 */
export function GiftTrialRow({ summary, showLocked, onChoose, busy = false }: GiftTrialRowProps) {
  const [open, setOpen] = useState(false);
  const name = useId();
  // Mũi tên trong nhóm radio gốc vừa dời focus vừa chọn; chọn ở đây là lưu và đóng tấm, nên mũi tên chỉ dời focus (React giữ chấm cũ),
  // Space hay bấm mới chọn.
  const arrowKey = useRef(false);
  const view = giftTrialRowView(summary, { showLocked });
  if (!view || !summary) return null;
  const sheet = giftTrialSheetView(summary);
  return (
    <>
      <div data-testid="gift-trial-row" data-state={view.state} className="mt-2 flex min-h-11 items-center justify-between gap-3 tabular-nums">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 break-words">
          <Text variant="body-sm" as="span" numeric className="line-clamp-2">
            {view.label}
          </Text>
          {view.sub && (
            <Text variant="caption" tone="secondary" as="span" numeric>
              {view.sub}
            </Text>
          )}
        </div>
        {view.action && (
          <button
            type="button"
            data-testid="gift-trial-change"
            aria-haspopup="dialog"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => setOpen(true)}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-end text-[length:var(--type-body-sm-size)] font-semibold text-[color:var(--color-text-brand)] active:opacity-70 disabled:text-[color:var(--color-text-tertiary)]"
          >
            {view.action}
          </button>
        )}
      </div>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={sheet.title}>
        <div
          role="radiogroup"
          aria-label={sheet.title}
          onKeyDown={(e) => {
            arrowKey.current = e.key.startsWith('Arrow');
          }}
          onKeyUp={() => {
            arrowKey.current = false;
          }}
        >
          {sheet.options.map((o) => (
            <GiftTrialOptionRow
              key={o.variationId ?? 'none'}
              name={name}
              option={o}
              onSelect={() => {
                if (arrowKey.current) return;
                setOpen(false);
                onChoose(o.variationId);
              }}
            />
          ))}
        </div>
        {sheet.footer && (
          <Text variant="caption" tone="secondary" as="p" numeric className="mt-3">
            {sheet.footer}
          </Text>
        )}
      </BottomSheet>
    </>
  );
}

function GiftTrialOptionRow({ name, option, onSelect }: { name: string; option: GiftTrialSheetOption; onSelect: () => void }) {
  return (
    <label
      data-testid="gift-trial-option"
      className={`flex min-h-14 items-center gap-3 py-1 tabular-nums ${option.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <input
        type="radio"
        name={name}
        checked={option.checked}
        disabled={option.disabled}
        onChange={() => {
          if (!option.checked && !option.disabled) onSelect();
        }}
        className={`${miniRadio} ${miniRadioGutter}`}
      />
      <span className={`flex min-w-0 flex-1 flex-col gap-0.5 ${option.disabled ? 'opacity-60' : ''}`}>
        <Text variant="body-sm" as="span" numeric className={`line-clamp-2 ${option.checked ? 'font-semibold' : ''}`}>
          {option.title}
        </Text>
        <Text variant="caption" tone={option.disabled ? 'tertiary' : 'secondary'} as="span" numeric>
          {option.hint}
        </Text>
      </span>
    </label>
  );
}
