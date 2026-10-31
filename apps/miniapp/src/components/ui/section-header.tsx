import type { ElementType, ReactNode } from 'react';
import { ChevronRight, Flame, Gift, Sparkles, Tag, Ticket, Zap, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'zmp-ui';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { haptic } from '../../utils/haptic';

/** Bảng icon nhỏ cho tiêu đề khối: chỉ 6 icon để `SectionHeader` vào gói đầu (Trang chủ) không kéo cả thư viện; icon khác truyền thẳng `LucideIcon`. */
export type IconName = 'zap' | 'flame' | 'tag' | 'sparkles' | 'ticket' | 'gift';
const ICONS: Record<IconName, LucideIcon> = { zap: Zap, flame: Flame, tag: Tag, sparkles: Sparkles, ticket: Ticket, gift: Gift };

export interface SectionHeaderProps {
  title: string;
  /** Để `Section`/`aria-labelledby` trỏ vào tiêu đề. */
  id?: string;
  icon?: IconName | LucideIcon;
  /** promo: chữ `--color-promo-fg`, icon tô đặc (Giờ vàng, khuyến mãi). */
  tone?: 'default' | 'promo';
  /** Đứng sau tiêu đề: `Countdown`, "12 mã". */
  trailing?: ReactNode;
  /** Route của nền tảng đang chạy (Mini: route Mini App). Nhãn mặc định "Xem tất cả". */
  action?: { label?: string; to: string };
  subtitle?: string;
  as?: 'h2' | 'h3';
}

/**
 * Tiêu đề khối trong luồng mua (Q1): Inter 16/700, -0.01em, một dòng. Fraunces chỉ cho tiêu đề trang và số lớn.
 * Hàng cao `--section-header-h` (44px) nên nút "Xem tất cả" có vùng chạm đủ mà không đệm thêm; mép phải thẳng hàng với lưới.
 * Tên đọc của nút gồm tên khối ("Xem tất cả Giờ vàng") vì ba nút cùng chữ trên một trang không phân biệt được.
 */
export function SectionHeader({ title, id, icon, tone = 'default', trailing, action, subtitle, as: Heading = 'h2' }: SectionHeaderProps) {
  const navigate = useNavigate();
  const IconCmp = typeof icon === 'string' ? ICONS[icon] : icon;
  const promo = tone === 'promo';
  const actionLabel = action?.label ?? fillCopy('section.seeAll');
  const H = Heading as ElementType;
  return (
    <div data-testid="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 'var(--section-header-h)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: '1 1 auto' }}>
        {IconCmp && (
          <IconCmp
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
            color={promo ? 'var(--color-flash-solid-bg)' : 'var(--color-text-brand)'}
            fill={promo ? 'var(--color-flash-solid-bg)' : 'none'}
            style={{ flex: '0 0 auto' }}
          />
        )}
        <div style={{ minWidth: 0, flex: '0 1 auto' }}>
          <H
            id={id}
            style={{
              margin: 0,
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--type-title-sm-size)',
              lineHeight: 'var(--type-title-sm-lh)',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: promo ? 'var(--color-promo-fg)' : 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </H>
          {subtitle && (
            <p style={{ margin: 0, fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </p>
          )}
        </div>
        {trailing && <div style={{ flex: '0 0 auto' }}>{trailing}</div>}
      </div>
      {action && (
        <button
          type="button"
          className="tubu-press"
          aria-label={action.label ? `${action.label} ${title}` : fillCopy('section.seeAllSpoken', { title })}
          onClick={() => {
            haptic('light');
            navigate(action.to);
          }}
          style={{
            flex: '0 0 auto',
            minHeight: 44,
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            color: 'var(--color-text-brand)',
            fontSize: 'var(--type-label-size)',
            lineHeight: 'var(--type-label-lh)',
            fontWeight: 600,
          }}
        >
          {actionLabel}
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
