'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronRight, Truck, type LucideIcon } from 'lucide-react';
import type { SubscriptionDTO } from '@tubutree/app-core/api/subscriptions';
import { activeOrderCountQuery, ordersHomeStripQuery } from '@tubutree/app-core/queries/orders';
import { subscriptionsQuery } from '@tubutree/app-core/queries/subscriptions';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatDate } from '@/lib/format-date';
import { homeText } from '@/lib/home-text';
import { Skeleton } from '@/components/ui/skeleton';

const PLACEHOLDER_ROW_HEIGHT = 78;

export function nextActiveSubscription(subs: SubscriptionDTO[]): SubscriptionDTO | undefined {
  return subs
    .filter((s) => s.status === 'ACTIVE' && !Number.isNaN(Date.parse(s.nextRunAt)))
    .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))[0];
}

/** dd/MM theo giờ Việt Nam (formatDate là dd/MM/yyyy, bỏ năm). */
export function formatDayMonth(iso: string): string {
  return formatDate(iso).slice(0, 5);
}

function StripRow({ href, icon: Icon, title, subtitle }: { href: string; icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <Link href={href} className="flex min-h-11 items-center gap-3 rounded-control p-2 transition hover:bg-stone-50">
      <Icon className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-stone-900">{title}</span>
        <span className="block truncate text-xs text-stone-600">{subtitle}</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-stone-500" aria-hidden="true" />
    </Link>
  );
}

/**
 * Dải "đơn đang giao / kỳ định kỳ kế tiếp" (spec 5b.1). Danh sách đơn chỉ tải khi badge đơn đang xử lý (cùng query với
 * thanh điều hướng) > 0. Khách chưa đăng nhập / không có gì / lỗi → ẩn.
 *
 * Placeholder CHỈ giữ chỗ khi đang tải danh sách đơn SHIPPING (badge > 0 → nhiều khả năng có dòng "đang giao"). Cố ý KHÔNG
 * giữ chỗ chỉ vì query định kỳ đang tải: đa số khách không có dải nào, giữ chỗ cho họ sẽ kéo nội dung bên dưới nhích lên.
 */
export function OrderStrip() {
  const authed = useAuthPhase() === 'authenticated';
  const count = useQuery({ ...activeOrderCountQuery(coreHttp), enabled: authed, staleTime: 30_000, retry: false });
  const shippingEnabled = authed && (count.data ?? 0) > 0;
  const shipping = useQuery({ ...ordersHomeStripQuery(coreHttp), enabled: shippingEnabled, staleTime: 30_000, retry: false });
  const subs = useQuery({ ...subscriptionsQuery(coreHttp), enabled: authed, retry: false });
  if (!authed) return null;

  if (shippingEnabled && shipping.isLoading) {
    return (
      <div data-testid="order-strip-loading" aria-hidden="true" className="py-2">
        <Skeleton height={PLACEHOLDER_ROW_HEIGHT} rounded="rounded-card" />
      </div>
    );
  }

  const order = shipping.data?.data[0];
  const nextSub = nextActiveSubscription(subs.data ?? []);
  if (!order && !nextSub) return null;

  return (
    <section aria-label={homeText.strip.title} className="py-2">
      <div className="rounded-card border border-stone-200 bg-stone-0 p-1">
        {order && (
          <StripRow
            href={`/tai-khoan/don-hang/${encodeURIComponent(order.code)}`}
            icon={Truck}
            title={homeText.strip.shipping(order.code)}
            subtitle={homeText.strip.shippingHint}
          />
        )}
        {nextSub && (
          <StripRow
            href="/tai-khoan/don-hang?tab=subscriptions"
            icon={CalendarClock}
            title={homeText.strip.nextSubscription(formatDayMonth(nextSub.nextRunAt))}
            subtitle={nextSub.productName}
          />
        )}
      </div>
    </section>
  );
}
