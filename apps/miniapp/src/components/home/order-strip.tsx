import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { CalendarClock, Truck } from 'lucide-react';
import { useActiveOrderCount } from '../../hooks/use-active-order-count';
import { vi } from '../../i18n/vi';
import { fetchOrders } from '../../services/shop-api';
import { getSubscriptions, type SubscriptionDTO } from '../../services/subscriptions-api';
import { useAuthStore } from '../../store/auth';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { ListRow } from '../ui/list-row';
import { Skeleton } from '../ui/skeleton';

// Khung dải: section đệm 4/12 + Card outline (viền 1 + đệm 8) + ListRow đệm 8 (tiêu đề body-sm 14*1.57
// + caption 13*1.54 + 2) ≈ 60px/dòng. Placeholder giữ chỗ MỘT dòng (trường hợp phổ biến); e2e Task 26 đo lại.
const SECTION_PAD = '4px 16px 12px';
const ROW_PADDING = '8px 4px';
const PLACEHOLDER_ROW_HEIGHT = 60;

export function nextActiveSubscription(subs: SubscriptionDTO[]): SubscriptionDTO | undefined {
  return subs
    .filter((s) => s.status === 'ACTIVE' && !Number.isNaN(Date.parse(s.nextRunAt)))
    .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))[0];
}

/** dd/MM theo giờ máy. Không dùng toLocaleDateString('vi-VN'): Node 24/ICU mới trả "15-10". */
export function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Dải "đơn đang giao / kỳ định kỳ kế tiếp" (spec 5b.1, plan 4b Ruling 9). Danh sách đơn chỉ tải khi
 * badge đơn đang xử lý (cùng query với tab bar) > 0. Khách chưa đăng nhập / không có gì / lỗi → ẩn.
 * Đang tải → placeholder giữ chỗ (spec §9) để dữ liệu về không đẩy nội dung bên dưới.
 */
export function OrderStrip() {
  const navigate = useNavigate();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const activeCount = useActiveOrderCount(true);
  const shippingEnabled = authed && activeCount > 0;
  const shipping = useQuery({
    queryKey: ['orders', 'home-strip'],
    queryFn: () => fetchOrders({ status: 'SHIPPING' }, 1, 1),
    enabled: shippingEnabled,
    staleTime: 30_000,
    retry: false,
  });
  // Cùng queryKey với SubscriptionsPanel (tab Định kỳ) → một cache.
  const subs = useQuery({ queryKey: ['subscriptions'], queryFn: getSubscriptions, enabled: authed, retry: false });
  if (!authed) return null;

  if (subs.isLoading || (shippingEnabled && shipping.isLoading)) {
    return (
      <div data-testid="order-strip-loading" aria-hidden="true" style={{ padding: SECTION_PAD }}>
        <Skeleton height={PLACEHOLDER_ROW_HEIGHT + 18} radius="var(--radius-card)" />
      </div>
    );
  }

  const order = shipping.data?.data[0];
  const nextSub = nextActiveSubscription(subs.data ?? []);
  if (!order && !nextSub) return null;

  return (
    <section aria-label={vi.home.strip.title} style={{ padding: SECTION_PAD }}>
      <Card variant="outline" padding={8}>
        {order && (
          <ListRow
            icon={<Icon icon={Truck} tone="brand" />}
            title={vi.home.strip.shipping(order.code)}
            subtitle={vi.home.strip.shippingHint}
            trailing="chevron"
            onPress={() => navigate(`/order/${encodeURIComponent(order.code)}`)}
            style={{ padding: ROW_PADDING }}
          />
        )}
        {nextSub && (
          <ListRow
            icon={<Icon icon={CalendarClock} tone="brand" />}
            title={vi.home.strip.nextSubscription(formatDayMonth(nextSub.nextRunAt))}
            subtitle={nextSub.productName}
            trailing="chevron"
            onPress={() => navigate('/orders?tab=subscriptions')}
            style={{ padding: ROW_PADDING }}
          />
        )}
      </Card>
    </section>
  );
}
