'use client';

// Nguồn: apps/miniapp/src/components/ui/voucher-ticket.tsx
import { useId, type CSSProperties } from 'react';
import { Store, Tag, Truck, type LucideIcon } from 'lucide-react';
import type { VoucherView } from '@tubutree/app-core/commerce/voucher';
import { fillCopy } from '@tubutree/app-core/shop-copy';

export interface VoucherTicketProps {
  voucher: VoucherView;
  /** ticket: Ưu đãi, Mã giảm giá (~88px) · chip: PDP, giỏ, trang shop · row: chỗ chọn mã ở thanh toán. */
  variant: 'ticket' | 'chip' | 'row';
  /** Nút duy nhất của phiếu: Lưu mã / Dùng ngay. Bỏ qua ở mã đã dùng, hết hạn, hết lượt. */
  primary?: { label: string; onClick: () => void; busy?: boolean };
  /** Có thì phần thân (tiêu đề, điều kiện, hạn) là nút mở chi tiết, đứng cạnh nút chính chứ không bao nó. */
  onDetail?: () => void;
  /** Lý do chưa dùng được ("Mua thêm 50k để dùng"); chỉ hiện ở trạng thái ineligible. */
  reason?: string;
  /** Sắp hết hạn: dòng hạn dùng tông cảnh báo (chữ vẫn là "Còn 2 ngày", không chỉ màu). */
  expiring?: boolean;
}

const KIND: Record<VoucherView['kind'], { icon: LucideIcon; stubBg: string; stubFg: string; bodyBg: string; fg: string; edge: string }> = {
  discount: { icon: Tag, stubBg: 'var(--color-voucher-stub-bg)', stubFg: 'var(--color-voucher-stub-fg)', bodyBg: 'var(--color-voucher-bg)', fg: 'var(--color-voucher-fg)', edge: 'var(--color-voucher-edge)' },
  freeship: { icon: Truck, stubBg: 'var(--color-voucher-ship-bg)', stubFg: 'var(--color-voucher-ship-fg)', bodyBg: 'var(--color-status-success-bg)', fg: 'var(--color-status-success-fg)', edge: 'var(--color-voucher-ship-bg)' },
  shop: { icon: Store, stubBg: 'var(--color-voucher-shop-stub-bg)', stubFg: 'var(--color-voucher-shop-stub-fg)', bodyBg: 'var(--color-voucher-shop-bg)', fg: 'var(--color-voucher-shop-fg)', edge: 'var(--color-voucher-shop-edge)' },
};

const STAMP: Partial<Record<VoucherView['state'], string>> = { used: 'coupon.used', expired: 'coupon.expired', soldout: 'coupon.outOfQuota' };

const TITLE_CLAMP: CSSProperties = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
const TITLE_ONE_LINE: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
// Hai nửa vòng khuyết ở mép trên và dưới cuống (răng cưa vé): hai lớp mask phủ mỗi lớp nửa chiều cao, cộng lại thành một vé liền.
const NOTCH = 'radial-gradient(circle at 72px 0, transparent 6px, #000 6.5px) top / 100% 51% no-repeat, radial-gradient(circle at 72px 100%, transparent 6px, #000 6.5px) bottom / 100% 51% no-repeat';

/**
 * Phiếu mã giảm giá dùng chung (thay ba kiểu vẽ rời: coupon-card, chip PDP, phiếu trang thương hiệu). Một nút chính; răng cưa và
 * vạch đứt chỉ để trang trí (a11y B6), mọi thông tin quan trọng là chữ. Mã không dùng được viết lý do bằng chữ và nút `aria-disabled`
 * (vẫn Tab tới được, đọc được lý do) thay vì `disabled`.
 */
export function VoucherTicket({ voucher: v, variant, primary, onDetail, reason, expiring }: VoucherTicketProps) {
  const uid = useId();
  const palette = KIND[v.kind];
  const inactive = v.state === 'used' || v.state === 'expired' || v.state === 'soldout';
  const ineligible = v.state === 'ineligible';
  const stamp = STAMP[v.state] ? fillCopy(STAMP[v.state]!) : null;
  const meta = [v.condition, v.code].filter(Boolean).join(' · ');
  const showExpiry = !inactive && v.expiry !== '';
  const reasonText = ineligible ? reason || v.condition : '';
  const showPrimary = primary && !inactive;
  const blocked = ineligible || Boolean(primary?.busy);
  const describedBy = ineligible && reasonText ? `${uid}-reason` : undefined;

  const small = variant !== 'ticket';
  const text = inactive ? 'var(--color-text-tertiary)' : palette.fg;
  const body = (
    <>
      <span style={{ ...(small ? TITLE_ONE_LINE : TITLE_CLAMP), fontSize: small ? 'var(--type-label-size)' : 'var(--type-body-sm-size)', lineHeight: small ? 'var(--type-label-lh)' : 'var(--type-body-sm-lh)', fontWeight: 700, color: text }}>
        {v.title}
      </span>
      {meta && (
        <span data-testid="voucher-meta" style={{ display: 'block', fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meta}
        </span>
      )}
      {showExpiry && variant !== 'chip' && (
        <span data-testid="voucher-expiry" style={{ display: 'block', fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: expiring ? 'var(--color-status-warning-fg)' : 'var(--color-text-tertiary)' }}>
          {v.expiry}
        </span>
      )}
      {reasonText && (
        <span id={`${uid}-reason`} data-testid="voucher-reason" style={{ display: 'block', fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-status-warning-fg)' }}>
          {reasonText}
        </span>
      )}
      {stamp && (
        <span data-testid="voucher-stamp" style={{ display: 'block', fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          {stamp}
        </span>
      )}
    </>
  );
  const bodyStyle: CSSProperties = { flex: '1 1 auto', minWidth: 0, textAlign: 'left', padding: variant === 'ticket' ? '10px 12px' : '6px 0' };
  const bodyNode = onDetail ? (
    <button
      type="button"
      data-testid="voucher-body"
      className="tubu-press"
      onClick={onDetail}
      style={{ ...bodyStyle, border: 'none', background: 'transparent', font: 'inherit', cursor: 'pointer', color: 'inherit', alignSelf: 'stretch', minHeight: 44 }}
    >
      {body}
    </button>
  ) : (
    <div data-testid="voucher-body" style={bodyStyle}>
      {body}
    </div>
  );

  const primaryNode = showPrimary && (
    <button
      type="button"
      className="tubu-press tubu-hit-44"
      aria-disabled={blocked || undefined}
      aria-busy={primary.busy || undefined}
      aria-describedby={describedBy}
      onClick={() => {
        if (blocked) return;
        primary.onClick();
      }}
      style={{
        flex: '0 0 auto',
        alignSelf: 'center',
        minHeight: 36,
        minWidth: 44,
        padding: '0 14px',
        border: 'none',
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'inherit',
        fontSize: 'var(--type-label-size)',
        lineHeight: 'var(--type-label-lh)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        cursor: blocked ? 'default' : 'pointer',
        background: blocked ? 'var(--color-action-primary-bg-disabled)' : 'var(--color-action-primary-bg)',
        color: blocked ? 'var(--color-text-secondary)' : 'var(--color-action-primary-fg)',
        marginRight: variant === 'ticket' ? 12 : 0,
      }}
    >
      {primary.label}
    </button>
  );

  const label = [v.title, stamp].filter(Boolean).join(', ');

  if (variant === 'ticket') {
    const Icon = palette.icon;
    return (
      <div
        role="group"
        aria-label={label}
        style={{ display: 'flex', alignItems: 'stretch', minHeight: 88, borderRadius: 'var(--radius-card)', overflow: 'hidden', background: inactive ? 'var(--color-bg-subtle)' : palette.bodyBg, WebkitMask: NOTCH, mask: NOTCH }}
      >
        <div
          data-testid="voucher-stub"
          style={{ flex: '0 0 72px', width: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', background: inactive ? 'var(--color-bg-chip)' : palette.stubBg, color: inactive ? 'var(--color-text-tertiary)' : palette.stubFg }}
        >
          <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div style={{ display: 'flex', flex: '1 1 auto', minWidth: 0, borderLeft: `1px dashed ${inactive ? 'var(--color-border-subtle)' : palette.edge}` }}>
          {bodyNode}
          {primaryNode}
        </div>
      </div>
    );
  }

  if (variant === 'chip') {
    return (
      <div
        role="group"
        aria-label={label}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, maxWidth: '100%', boxSizing: 'border-box', padding: '0 4px 0 12px', borderRadius: 'var(--radius-control)', border: `1px dashed ${inactive ? 'var(--color-border-subtle)' : palette.edge}`, background: inactive ? 'var(--color-bg-subtle)' : palette.bodyBg }}
      >
        {bodyNode}
        {primaryNode}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '6px 0', boxShadow: 'inset 0 -1px 0 var(--color-border-subtle)' }}
    >
      {bodyNode}
      {primaryNode}
    </div>
  );
}
