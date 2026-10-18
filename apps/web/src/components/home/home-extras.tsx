'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Map as MapIcon, MessagesSquare, Search, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { brandsQuery } from '@tubutree/app-core/queries/catalog';
import { useAuth } from '@/lib/auth-context';
import { pointsSummary } from '@/lib/checkout-points';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { homeText } from '@/lib/home-text';
import { browseHref, EMPTY_SEARCH_STATE } from '@/lib/search-state';
import { useAiAdvisorEnabled } from '@/lib/use-public-config';
import { Skeleton } from '@/components/ui/skeleton';

const BRAND_CHIP_SKELETON_COUNT = 5;

function ShortcutCard({ href, icon: Icon, label, ariaLabel }: { href: string; icon: LucideIcon; label: string; ariaLabel: string }) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-card border border-stone-200 bg-stone-0 px-3 py-2.5 text-sm font-semibold text-stone-900 transition hover:border-forest-600/40 hover:bg-forest-50"
    >
      <Icon className="h-4 w-4 flex-none text-forest-600" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}

function RowLink({ href, icon: Icon, title, subtitle, divider }: { href: string; icon: LucideIcon; title: string; subtitle: string; divider?: boolean }) {
  return (
    <Link href={href} className={`flex min-h-11 items-center gap-3 p-3 transition hover:bg-stone-50 ${divider ? 'border-t border-stone-200' : ''}`}>
      <Icon className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-stone-900">{title}</span>
        <span className="block text-xs text-stone-600">{subtitle}</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
    </Link>
  );
}

/**
 * Khối phụ cuối Trang chủ: 2 thẻ nhỏ AI/Mua chung, hero với CTA "Tìm sản phẩm" (A2-33), dải thương hiệu, câu chuyện nguyên liệu, cộng đồng.
 * `initialBrands` là danh sách server đã tải cho trang ISR để dải thương hiệu có trong HTML đầu.
 */
export function HomeExtras({ initialBrands }: { initialBrands?: { brand: string; count: number; slug?: string | null }[] }) {
  const { user } = useAuth();
  const aiEnabled = useAiAdvisorEnabled();
  // Brand chậm đổi (sync Pancake ~15p/lần) → cache 60s.
  const brands = useQuery({ ...brandsQuery(coreHttp), staleTime: 60_000, ...(initialBrands ? { initialData: initialBrands } : {}) });
  const brandList = brands.data ?? [];

  return (
    <div className="flex flex-col gap-3 py-3">
      <div className="flex gap-2.5">
        {aiEnabled && <ShortcutCard href="/tu-van" icon={Sparkles} label={homeText.aiCard} ariaLabel={homeText.aiCardLabel} />}
        <ShortcutCard href="/mua-chung" icon={Users} label={homeText.groupBuyCard} ariaLabel={homeText.groupBuyCard} />
      </div>

      <section aria-label={homeText.heroTitle} className="rounded-card bg-forest-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-forest-700">{homeText.heroKicker}</p>
        <h2 className="mt-1 font-display text-xl font-semibold text-stone-900">{homeText.heroTitle}</h2>
        {user && (
          <p className="mt-1 text-sm text-stone-700">
            {homeText.greeting(user.fullName ?? homeText.greetingFallback)}
            {` · ${homeText.pointsChip(pointsSummary(user).total)}`}
          </p>
        )}
        <div className="mt-3">
          <Link href="/san-pham?focus=search" aria-label={homeText.heroCta} className={ui.btnSecondary}>
            <Search className="mr-2 h-4 w-4" aria-hidden="true" />
            {homeText.heroCta}
          </Link>
        </div>
      </section>

      {(brands.isLoading || brandList.length > 0) && (
        <section aria-label={homeText.brandsTitle}>
          <h2 className="mb-1 font-display text-lg font-semibold text-stone-900">{homeText.brandsTitle}</h2>
          <ul aria-label={homeText.brandsRail} className="flex gap-2 overflow-x-auto py-1.5">
            {brands.isLoading
              ? Array.from({ length: BRAND_CHIP_SKELETON_COUNT }, (_, i) => (
                  <li key={i} data-testid="brand-chip-skeleton" className="flex-none">
                    <Skeleton width={92} height={44} rounded="rounded-full" />
                  </li>
                ))
              : brandList.map((b) => (
                  <li key={b.brand} className="flex-none">
                    <Link
                      href={browseHref({ ...EMPTY_SEARCH_STATE, brands: [b.brand] })}
                      className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-stone-300 bg-stone-0 px-4 text-sm font-medium text-stone-700 transition hover:border-stone-450 hover:bg-stone-50"
                    >
                      {b.brand}
                    </Link>
                  </li>
                ))}
          </ul>
        </section>
      )}

      <div className="overflow-hidden rounded-card border border-stone-200 bg-stone-0">
        <RowLink href="/cau-chuyen" icon={MapIcon} title={homeText.brandStoryTitle} subtitle={homeText.brandStoryBody} />
        <RowLink href="/cong-dong" icon={MessagesSquare} title={homeText.communityTitle} subtitle={homeText.communitySubtitle} divider />
      </div>
    </div>
  );
}
