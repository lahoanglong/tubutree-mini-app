import { useState } from 'react';
import type { GiftTrialSummaryDTO, QuotePendingGiftDTO } from '@tubutree/shared-types';
import { giftSectionView } from '@tubutree/app-core/checkout-pickup-view';
import { giftTrialRowView, giftTrialSheetView, type GiftTrialSheetOption } from '@tubutree/app-core/commerce/gift-trial';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { BottomSheet } from '../ui/bottom-sheet';
import { Checkbox, Radio } from '../ui/form';
import { rowKeyboardProps } from '../ui/row-keyboard';
import { Text } from '../ui/text';
import { haptic } from '../../utils/haptic';
import '../../css/checkout-pickup.css';

interface GiftRowsProps {
  gifts: readonly QuotePendingGiftDTO[];
  excluded: readonly string[];
  /** `receive=false` là để quà lại cho đơn sau; `receive=true` chọn quà này cho đơn hiện tại (hành vi radio khi có nhiều quà). */
  onToggle: (id: string, receive: boolean, pending?: readonly QuotePendingGiftDTO[]) => void;
  shortfallVnd?: number;
  /** Quà chỉ chờ số điện thoại đã xác minh: hỏi số ngay ở dòng quà (đặt hàng không còn hỏi số). Không truyền thì như cũ. */
  onVerifyPhone?: () => void;
  verifyingPhone?: boolean;
}

/**
 * Quà hiện vật 0đ đi kèm đơn: mỗi quà một dòng, từ 3 quà trở lên gộp một dòng mở tấm nhỏ. Mặc định quà đi cùng đơn;
 * ô "Để đơn sau" chỉ là lối bỏ, không phải nút hành động của màn.
 */
export function GiftRows({ gifts, excluded, onToggle, shortfallVnd = 0, onVerifyPhone, verifyingPhone = false }: GiftRowsProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const view = giftSectionView(gifts, excluded, shortfallVnd);
  if (view.layout === 'none') return null;
  const needsPhone = new Set(gifts.filter((g) => g.blockedReason === 'PHONE_NOT_VERIFIED').map((g) => g.id));

  const rows = view.rows.map((row) => (
    <div key={row.id} className="tubu-gift-row" data-testid="checkout-gift-row">
      <div className="tubu-gift-col" data-dim={row.receive ? undefined : 'true'}>
        <Text variant="body-sm" tone={row.receive ? 'primary' : 'secondary'} as="span" numeric>
          {row.label}
        </Text>
        {row.reason && (
          <Text variant="caption" tone="secondary" as="span" numeric>
            {row.reason}
          </Text>
        )}
        {onVerifyPhone && !row.receive && needsPhone.has(row.id) && (
          <button
            type="button"
            className="tubu-press tubu-hit-44"
            data-testid="checkout-gift-verify-phone"
            disabled={verifyingPhone}
            aria-busy={verifyingPhone || undefined}
            onClick={() => {
              haptic('light');
              onVerifyPhone();
            }}
            style={{ alignSelf: 'flex-start', background: 'none', border: 0, padding: 0, color: 'var(--color-text-brand)', fontWeight: 600, fontSize: 'var(--type-caption-size)' }}
          >
            {fillCopy('checkout.gift.verifyPhone')}
          </button>
        )}
      </div>
      {row.canToggle && (
        <Checkbox
          checked={!row.receive}
          onChange={() => {
            haptic('light');
            onToggle(row.id, !row.receive, gifts);
          }}
          label={view.deferLabel}
        />
      )}
    </div>
  ));
  if (view.layout === 'rows') return <>{rows}</>;

  return (
    <>
      <div className="tubu-gift-row">
        <button type="button" className="tubu-gift-merged tubu-press" onClick={() => setSheetOpen(true)}>
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
    <div className="tubu-gift-note" data-testid="cart-gift-note">
      <Text variant="caption" tone="secondary">{fillCopy('cart.giftNote')}</Text>
    </div>
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
 * Tubu Tree, không đổi số tiền nào của đơn.
 */
export function GiftTrialRow({ summary, showLocked, onChoose, busy = false }: GiftTrialRowProps) {
  const [open, setOpen] = useState(false);
  const view = giftTrialRowView(summary, { showLocked });
  if (!view || !summary) return null;
  const sheet = giftTrialSheetView(summary);
  return (
    <>
      <div className="tubu-gift-row" data-testid="gift-trial-row" data-state={view.state}>
        <div className="tubu-gift-col">
          <Text variant="body-sm" as="span" numeric className="tubu-gift-trial-label">
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
            className="tubu-press tubu-hit-44 tubu-gift-trial-action"
            data-testid="gift-trial-change"
            aria-haspopup="dialog"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              haptic('light');
              setOpen(true);
            }}
          >
            {view.action}
          </button>
        )}
      </div>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={sheet.title}>
        <div role="radiogroup" aria-label={sheet.title}>
          {sheet.options.map((o) => (
            <GiftTrialOptionRow
              key={o.variationId ?? 'none'}
              option={o}
              onSelect={() => {
                setOpen(false);
                onChoose(o.variationId);
              }}
            />
          ))}
        </div>
        {sheet.footer && (
          <Text variant="caption" tone="secondary" as="p" numeric className="tubu-gift-trial-footer">
            {sheet.footer}
          </Text>
        )}
      </BottomSheet>
    </>
  );
}

function GiftTrialOptionRow({ option, onSelect }: { option: GiftTrialSheetOption; onSelect: () => void }) {
  return (
    <div
      role="radio"
      aria-checked={option.checked}
      aria-disabled={option.disabled || undefined}
      {...rowKeyboardProps()}
      className={option.disabled ? 'tubu-gift-trial-option' : 'tubu-gift-trial-option tubu-press'}
      data-testid="gift-trial-option"
      onClick={() => {
        if (option.checked || option.disabled) return;
        haptic('light');
        onSelect();
      }}
    >
      {/* Chấm tròn chỉ để nhìn: chọn nằm ở onClick của hàng (role=radio). */}
      <Radio checked={option.checked} disabled={option.disabled} onChange={() => {}} />
      <div className="tubu-gift-col" data-dim={option.disabled ? 'true' : undefined}>
        <Text variant="body-sm" as="span" numeric className="tubu-gift-trial-label" style={option.checked ? { fontWeight: 600 } : undefined}>
          {option.title}
        </Text>
        <Text variant="caption" tone={option.disabled ? 'tertiary' : 'secondary'} as="span" numeric>
          {option.hint}
        </Text>
      </div>
    </div>
  );
}
