import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { CalendarClock, ChevronDown, ChevronUp, Gift, Leaf, Ticket, Truck, type LucideIcon } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { HOME_HERO_HEIGHT } from '@tubutree/app-core/home-layout';
import { getNewCustomerOffer, type NewCustomerOffer } from '../../services/account-api';
import { fetchOrders, getPublicConfig, type PublicConfig } from '../../services/shop-api';
import { useAuthStore } from '../../store/auth';
import { isGuestUser } from '../coupon-claim-gate';
import { vi } from '../../i18n/vi';
import { formatDate, formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { earnPctOf, percentLabel } from '../../utils/loyalty-copy';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Icon } from '../ui/icon';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';

const SECTION_PAD = '0 16px 12px';

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
  const earnPct = cfg.loyalty ? earnPctOf(cfg.loyalty) : null;
  if (cfg.loyalty && earnPct != null) {
    out.push({ icon: Leaf, text: vi.home.newGift.points(percentLabel(earnPct), formatVnd(cfg.loyalty.vndPerPointRedeem)) });
  }
  out.push({ icon: CalendarClock, text: vi.home.newGift.subscribe(Math.round(cfg.subscribeDiscountPct * 100)) });
  return out;
}

function voucherAmountText(v: NonNullable<NewCustomerOffer['welcomeVoucher']>): string {
  if (v.type === 'PERCENT') return `${v.value}%`;
  if (v.type === 'FREESHIP') return 'freeship';
  return formatVnd(v.value);
}

function voucherTitle(v: NonNullable<NewCustomerOffer['welcomeVoucher']>): string {
  if (v.type === 'PERCENT') return vi.home.newGift.voucherPercent(v.value);
  if (v.type === 'FREESHIP') return vi.home.newGift.voucherFreeship;
  return vi.home.newGift.voucherAmount(formatVnd(v.value));
}

/**
 * Khối "Quà khách mới" ở Trang chủ (D2-07b): voucher chào mừng của khách (nếu có) và 3 lợi ích mua trực tiếp. Chỉ khách chưa có
 * đơn theo định nghĩa đơn đầu của API (GET /me/new-customer-offer); khách chưa đăng nhập thì chỉ thấy phần lợi ích.
 * Đang tải, lỗi tải hay thiếu cấu hình → không vẽ gì: đây là khối quảng bá phụ, không đáng một khung chờ hay thẻ lỗi và không được hiện số suy đoán.
 */
export function NewCustomerGift() {
  const navigate = useNavigate();
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const userId = useAuthStore((s) => s.user?.id);
  const user = useAuthStore((s) => s.user);
  const ensurePhone = useAuthStore((s) => s.ensurePhone);
  // Tài khoản khách (vào bằng thiết bị, chưa liên kết Zalo): máy chủ cố ý trả isNewCustomer=false để không hứa quà nó không phát.
  // Đây lại là nhóm cần mồi nhất, nên vẫn hiện lợi ích và mời liên kết Zalo để nhận quà; quà chỉ vào ví sau khi liên kết.
  const guestAccount = authed && user ? isGuestUser(user) : false;
  const [expanded, setExpanded] = useState(false);
  const [linking, setLinking] = useState<'idle' | 'busy' | 'failed'>('idle');
  // Cùng queryKey/hàm với usePublicConfig → một cache; cần trạng thái lỗi riêng để ẩn khối thay vì hiện giá trị dự phòng.
  const cfgQ = useQuery({ queryKey: ['public-config'], queryFn: getPublicConfig, staleTime: 5 * 60_000 });
  const offerQ = useQuery({
    queryKey: ['new-customer-offer', userId],
    queryFn: getNewCustomerOffer,
    enabled: authed && !guestAccount,
    retry: false,
  });

  // Máy chủ không phân biệt được tài khoản khách đã có đơn (luôn trả isNewCustomer=false), nên hỏi thẳng danh sách đơn: đã có đơn thì
  // không hứa quà chào mừng dành cho khách chưa mua.
  const ordersQ = useQuery({ queryKey: ['orders', 'home-has-any', userId], queryFn: () => fetchOrders({}, 1, 1), enabled: guestAccount, retry: false });
  const guestHasOrders = guestAccount && (ordersQ.data?.meta.total ?? 0) > 0;

  // Chưa biết có phải khách mới: giữ chỗ bằng khung chờ cao bằng dải thật (cũng là chiều cao thẻ thành viên) để trang không nhảy.
  // Lỗi tải hay thiếu cấu hình thì thu lại: khối quảng bá phụ, không đáng một thẻ lỗi và không được hiện số suy đoán.
  if (cfgQ.isError || (authed && !guestAccount && offerQ.isError) || (guestAccount && ordersQ.isError)) return null;
  if (cfgQ.isPending || (authed && !guestAccount && offerQ.isPending) || (guestAccount && ordersQ.isPending)) return <NewCustomerGiftSkeleton />;
  if (guestAccount && guestHasOrders) return null;
  if (authed && !guestAccount && offerQ.data?.isNewCustomer !== true) return null;

  const voucher = authed && !guestAccount ? (offerQ.data?.welcomeVoucher ?? null) : null;
  // Khách chưa có mã riêng: nói mệnh giá mã chào mừng từ cấu hình công khai (thiếu thì không hứa số).
  const promised = guestAccount ? (cfgQ.data!.newCustomer?.welcomeVoucher ?? null) : null;
  const benefits = directBenefits(cfgQ.data!);
  // Dòng tóm tắt dưới tiêu đề: mã chào mừng (nếu có) kèm đơn tối thiểu, không thì lợi ích đầu tiên.
  const headline = voucher
    ? [vi.home.newGift.voucherShort(voucherAmountText(voucher)), voucher.minOrder ? vi.home.newGift.voucherMinOrder(formatVnd(voucher.minOrder)).toLowerCase() : null].filter(Boolean).join(' · ')
    : promised && promised.amount > 0
      ? [vi.home.newGift.voucherShort(formatVnd(promised.amount)), promised.minOrder ? vi.home.newGift.voucherMinOrder(formatVnd(promised.minOrder)).toLowerCase() : null].filter(Boolean).join(' · ')
      : benefits[0]!.text;

  const linkZalo = async () => {
    setLinking('busy');
    try {
      const phone = await ensurePhone();
      setLinking(phone ? 'idle' : 'failed');
    } catch {
      setLinking('failed');
    }
  };

  const voucherDetail: ReactNode = voucher
    ? [voucher.minOrder ? vi.home.newGift.voucherMinOrder(formatVnd(voucher.minOrder)) : null, vi.home.newGift.voucherExpires(formatDate(voucher.endAt))]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <section aria-label={vi.home.newGift.title} style={{ padding: SECTION_PAD }}>
      <Card variant="flat" padding={0}>
        <div style={{ minHeight: HOME_HERO_HEIGHT, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 0 16px' }}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${vi.home.newGift.title}: ${headline}. ${expanded ? vi.home.newGift.collapse : vi.home.newGift.expand}`}
            className="tubu-press"
            onClick={() => {
              haptic('light');
              setExpanded((v) => !v);
            }}
            style={{ flex: 1, minWidth: 0, minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, padding: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <Icon icon={Gift} tone="brand" />
            <span style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" as="div" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {vi.home.newGift.title}
              </Text>
              <Text variant="caption" tone="secondary" as="div" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {headline}
              </Text>
            </span>
            <Icon icon={expanded ? ChevronUp : ChevronDown} size="sm" tone="muted" />
          </button>
          {guestAccount ? (
            <Button
              loading={linking === 'busy'}
              aria-label={homeCopy.guestGift.cta}
              onPress={() => {
                haptic('light');
                return linkZalo();
              }}
              style={{ minWidth: 0, flex: '0 0 auto' }}
            >
              {homeCopy.guestGift.ctaShort}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onPress={() => {
                haptic('light');
                navigate('/browse');
              }}
              style={{ minWidth: 0, flex: '0 0 auto' }}
            >
              {vi.home.newGift.cta}
            </Button>
          )}
        </div>
        {linking === 'failed' && (
          <Text variant="caption" tone="danger" as="p" style={{ margin: 0, padding: '0 16px 8px' }}>
            {homeCopy.guestGift.failed}
          </Text>
        )}
        {expanded && (
          <div style={{ padding: '0 16px 16px' }}>
            {voucher && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
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
            {promised && promised.amount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <Icon icon={Ticket} tone="brand" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="label" as="div">
                    {vi.home.newGift.voucherAmount(formatVnd(promised.amount))}
                  </Text>
                  <Text variant="caption" tone="secondary" as="div">
                    {[promised.minOrder ? vi.home.newGift.voucherMinOrder(formatVnd(promised.minOrder)) : null, guestAccount ? homeCopy.guestGift.ctaHint : null]
                      .filter(Boolean)
                      .join(' · ')}
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
          </div>
        )}
      </Card>
    </section>
  );
}

function NewCustomerGiftSkeleton() {
  return (
    <div data-testid="new-customer-gift-loading" aria-hidden="true" style={{ padding: SECTION_PAD }}>
      <Skeleton height={HOME_HERO_HEIGHT} radius="var(--radius-card)" />
    </div>
  );
}
