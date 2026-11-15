'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useOptionalPathname } from '@/lib/optional-nav';

export interface EcosystemNavPillItem {
  href: string;
  label: ReactNode;
  active: boolean;
}

export function EcosystemNavPills({
  items,
  label,
}: {
  items: readonly EcosystemNavPillItem[];
  label: string;
}) {
  const gridColsClass =
    items.length === 2
      ? 'grid-cols-2'
      : items.length === 3
        ? 'grid-cols-3'
        : 'grid-cols-2';

  return (
    <nav
      aria-label={label}
      data-testid="ecosystem-nav-pills"
      className={`grid ${gridColsClass} items-center gap-1 rounded-control border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-1 sm:inline-flex sm:w-auto sm:gap-1.5`}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={`inline-flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-control px-1.5 text-center text-xs font-semibold transition-colors sm:shrink-0 sm:px-3.5 sm:text-sm ${
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
          label: (
            <>
              <span aria-hidden="true" className="hidden sm:inline">♻️ </span>
              Đổi rác
              <span className="hidden sm:inline">&nbsp;tích điểm</span>
            </>
          ),
          active: pathname === '' || pathname === '/doi-rac' || pathname.startsWith('/doi-rac/'),
        },
        {
          href: '/kho-qua',
          label: (
            <>
              <span aria-hidden="true" className="hidden sm:inline">🎁 </span>
              Kho quà
              <span className="hidden sm:inline">&nbsp;Điểm Xanh</span>
            </>
          ),
          active: pathname === '/kho-qua',
        },
        {
          href: '/kho-qua/cua-toi',
          label: (
            <>
              <span aria-hidden="true" className="hidden sm:inline">🎟️ </span>
              Quà&nbsp;<span className="hidden sm:inline">đã đổi&nbsp;</span>của tôi
            </>
          ),
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
          label: (
            <>
              Mua chung<span className="hidden sm:inline">&nbsp;giá kho</span>
            </>
          ),
          active: activeKey === 'group-buy',
        },
        {
          href: '/san-pham?filter=subscription',
          label: (
            <>
              Mua xoay vòng<span className="hidden sm:inline">&nbsp;(Định kỳ)</span>
            </>
          ),
          active: activeKey === 'subscription',
        },
        {
          href: '/uu-dai',
          label: (
            <>
              <span className="hidden sm:inline">Giờ vàng &amp;&nbsp;</span>Ưu đãi
            </>
          ),
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
      label="Đại lý và Cộng tác viên"
      items={[
        {
          href: '/dai-ly',
          label: 'Đại lý sỉ',
          active: pathname === '/dai-ly' || pathname.startsWith('/dai-ly/'),
        },
        {
          href: '/ctv',
          label: (
            <>
              Tiếp thị liên kết<span className="hidden sm:inline">&nbsp;(CTV)</span>
            </>
          ),
          active: pathname === '/ctv' || pathname.startsWith('/ctv/'),
        },
      ]}
    />
  );
}
