import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { CalendarClock, Leaf, Ticket, Truck, type LucideIcon } from 'lucide-react';
import { getNewCustomerOffer, type NewCustomerOffer } from '../../services/account-api';
import { getPublicConfig, type PublicConfig } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { vi } from '../../i18n/vi';
import { formatDate, formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';

// Khung chờ ≈ thẻ thật (tiêu đề + dòng voucher + 3 lợi ích + nút) để khối hiện ra không đẩy phần dưới.
const PLACEHOLDER_HEIGHT = 236;
const SECTION_PAD = '8px 16px 12px';

interface Benefit {
  icon: LucideIcon;
  text: string;
}

/**
 * 3 lợi ích mua trực tiếp, mọi con số lấy từ cấu hình công khai (không viết cứng ở đây). Thiếu số (API cũ chưa trả) thì bỏ
 * dòng đó thay vì hiện con số mặc định.
 */
export function directBenefits(cfg: PublicConfig): Benefit[] {
  const out: Benefit[] = [];
  const first = cfg.newCustomer?.firstOrderFreeShip;
  if (first?.enabled) {
    out.push({
      icon: Truck,
      text: first.minSubtotal > 0 ? vi.home.newGift.freeShipFirstFrom(formatVnd(first.minSubtotal)) : vi.home.newGift.freeShipFirst,
    });
  } else {
    out.push({ icon: Truck, text: vi.home.newGift.freeShipFrom(formatVnd(cfg.freeshipThreshold)) });
  }
  if (cfg.loyalty) {
    out.push({ icon: Leaf, text: vi.home.newGift.points(formatVnd(cfg.loyalty.vndPerPoint), formatVnd(cfg.loyalty.vndPerPointRedeem)) });
  }
  out.push({ icon: CalendarClock, text: vi.home.newGift.subscribe(Math.round(cfg.subscribeDiscountPct * 100)) });
  return out;
}

function voucherTitle(v: NonNullable<NewCustomerOffer['welcomeVoucher']>): string {
  if (v.type === 'PERCENT') return vi.home.newGift.voucherPercent(v.value);
  if (v.type === 'FREESHIP') return vi.home.newGift.voucherFreeship;
  return vi.home.newGift.voucherAmount(formatVnd(v.value));
}

/**
 * Khối "Quà khách mới" ở Trang chủ (D2-07b): voucher chào mừng của khách (nếu có) và 3 lợi ích mua trực tiếp. Chỉ khách chưa có
 * đơn theo định nghĩa đơn đầu của API (GET /me/new-customer-offer); khách chưa đăng nhập thì chỉ thấy phần lợi ích.
 * Lỗi tải hay thiếu cấu hình → ẩn hẳn: đây là khối quảng bá phụ, không đáng một thẻ lỗi và không được hiện số suy đoán.
 */
export function NewCustomerGift() {
  const navigate = useNavigate();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const userId = useAuthStore((s) => s.user?.id);
  // Cùng queryKey/hàm với usePublicConfig → một cache; cần trạng thái lỗi riêng để ẩn khối thay vì hiện giá trị dự phòng.
  const cfgQ = useQuery({ queryKey: ['public-config'], queryFn: getPublicConfig, staleTime: 5 * 60_000 });
  const offerQ = useQuery({
    queryKey: ['new-customer-offer', userId],
    queryFn: getNewCustomerOffer,
    enabled: authed,
    retry: false,
  });

  if (cfgQ.isError || (authed && offerQ.isError)) return null;
  if (cfgQ.isPending || (authed && offerQ.isPending)) {
    return (
      <div data-testid="new-customer-gift-loading" aria-hidden="true" style={{ padding: SECTION_PAD }}>
        <Skeleton height={PLACEHOLDER_HEIGHT} radius="var(--radius-card)" />
      </div>
    );
  }
  if (authed && offerQ.data?.isNewCustomer !== true) return null;

  const voucher = authed ? (offerQ.data?.welcomeVoucher ?? null) : null;
  const benefits = directBenefits(cfgQ.data!);

  const voucherDetail: ReactNode = voucher
    ? [voucher.minOrder ? vi.home.newGift.voucherMinOrder(formatVnd(voucher.minOrder)) : null, vi.home.newGift.voucherExpires(formatDate(voucher.endAt))]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <section aria-label={vi.home.newGift.title} style={{ padding: SECTION_PAD }}>
      <Card variant="flat" padding={16}>
        <Heading variant="title-sm" as="h2">
          {vi.home.newGift.title}
        </Heading>
        {voucher && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <Icon icon={Ticket} tone="brand" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" as="div">
                {voucherTitle(voucher)}
              </Text>
              <Text variant="caption" tone="secondary" as="div">
                {voucherDetail}
              </Text>
            </div>
          </div>
        )}
        <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 12 }}>
          {vi.home.newGift.benefitsTitle}
        </Text>
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {benefits.map((b) => (
            <li key={b.text} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <Icon icon={b.icon} size="sm" tone="brand" style={{ flex: '0 0 auto', marginTop: 3 }} />
              <Text variant="body-sm" tone="secondary">
                {b.text}
              </Text>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 12 }}>
          <Button
            variant="secondary"
            onPress={() => {
              haptic('light');
              navigate('/browse');
            }}
            style={{ minWidth: 0 }}
          >
            {vi.home.newGift.cta}
          </Button>
        </div>
      </Card>
    </section>
  );
}
