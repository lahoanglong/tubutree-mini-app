'use client';

import Link from 'next/link';
import { useOptionalPathname } from '@/lib/optional-nav';

export interface EcosystemNavPillItem {
  href: string;
  label: string;
  active: boolean;
}

export function EcosystemNavPills({
  items,
  label,
}: {
  items: readonly EcosystemNavPillItem[];
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      data-testid="ecosystem-nav-pills"
      className="tubu-scroll-fade flex items-center gap-1.5 overflow-x-auto rounded-control border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-1"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-3.5 text-sm font-semibold transition-colors ${
            item.active
              ? 'bg-[var(--color-bg-surface)] text-[color:var(--color-text-brand)] [box-shadow:var(--elevation-1)]'
              : 'text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** Thanh chuyển nhanh giữa Đổi rác tích điểm · Kho quà Điểm Xanh · Quà đã đổi của tôi. */
export function RecycleRewardsNavPills() {
  const pathname = useOptionalPathname() ?? '';
  return (
    <EcosystemNavPills
      label="Đổi rác và Kho quà"
      items={[
        {
          href: '/doi-rac',
          label: '♻️ Đổi rác tích điểm',
          active: pathname === '' || pathname === '/doi-rac' || pathname.startsWith('/doi-rac/'),
        },
        {
          href: '/kho-qua',
          label: '🎁 Kho quà Điểm Xanh',
          active: pathname === '/kho-qua',
        },
        {
          href: '/kho-qua/cua-toi',
          label: '🎟️ Quà đã đổi của tôi',
          active: pathname === '/kho-qua/cua-toi' || pathname.startsWith('/kho-qua/cua-toi/'),
        },
      ]}
    />
  );
}

/** Thanh chuyển nhanh giữa Mua chung giá kho · Mua xoay vòng (Định kỳ) · Giờ vàng & Ưu đãi. */
export function GroupCycleDealsNavPills({
  activeOverride,
}: {
  activeOverride?: 'group-buy' | 'subscription' | 'deals';
} = {}) {
  const pathname = useOptionalPathname() ?? '';
  const activeKey =
    activeOverride ??
    (pathname.startsWith('/mua-chung')
      ? 'group-buy'
      : pathname.startsWith('/uu-dai') || pathname.startsWith('/gio-vang')
        ? 'deals'
        : undefined);
  return (
    <EcosystemNavPills
      label="Mua chung, xoay vòng và ưu đãi"
      items={[
        {
          href: '/mua-chung',
          label: 'Mua chung giá kho',
          active: activeKey === 'group-buy',
        },
        {
          href: '/san-pham?filter=subscription',
          label: 'Mua xoay vòng (Định kỳ)',
          active: activeKey === 'subscription',
        },
        {
          href: '/uu-dai',
          label: 'Giờ vàng & Ưu đãi',
          active: activeKey === 'deals',
        },
      ]}
    />
  );
}

/** Thanh chuyển nhanh giữa Đại lý sỉ và Tiếp thị liên kết (CTV). */
export function PartnerEarnNavPills() {
  const pathname = useOptionalPathname() ?? '';
  return (
    <EcosystemNavPills
      label="Kênh đối tác Tubu Tree"
      items={[
        {
          href: '/dai-ly',
          label: 'Đại lý sỉ',
          active: pathname === '/dai-ly' || pathname.startsWith('/dai-ly/'),
        },
        {
          href: '/ctv',
          label: 'Tiếp thị liên kết (CTV)',
          active: pathname === '/ctv' || pathname.startsWith('/ctv/'),
        },
      ]}
    />
  );
}
