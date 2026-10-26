'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Leaf, Ticket, Truck, type LucideIcon } from 'lucide-react';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import type { NewCustomerOffer } from '@tubutree/app-core/api/loyalty';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { newCustomerOfferQuery } from '@tubutree/app-core/queries/loyalty';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase, useAuthRestoring } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { homeText } from '@/lib/home-text';
import { earnPctOf, percentLabel } from '@/lib/points-boost';
import { Card, Heading, Icon, Text } from '@/components/mini';

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
      text: first.minSubtotal > 0 ? homeText.newGift.freeShipFirstFrom(formatVnd(first.minSubtotal)) : homeText.newGift.freeShipFirst,
    });
  } else {
    out.push({ icon: Truck, text: homeText.newGift.freeShipFrom(formatVnd(cfg.freeshipThreshold)) });
  }
  const earnPct = cfg.loyalty ? earnPctOf(cfg.loyalty) : null;
  if (cfg.loyalty && earnPct != null) {
    out.push({ icon: Leaf, text: homeText.newGift.points(percentLabel(earnPct), formatVnd(cfg.loyalty.vndPerPointRedeem)) });
  }
  out.push({ icon: CalendarClock, text: homeText.newGift.subscribe(Math.round(cfg.subscribeDiscountPct * 100)) });
  return out;
}

function voucherTitle(v: NonNullable<NewCustomerOffer['welcomeVoucher']>): string {
  if (v.type === 'PERCENT') return homeText.newGift.voucherPercent(v.value);
  if (v.type === 'FREESHIP') return homeText.newGift.voucherFreeship;
  return homeText.newGift.voucherAmount(formatVnd(v.value));
}

/**
 * Khối "Quà khách mới" ở Trang chủ (D2-07b): voucher chào mừng của khách (nếu có) và 3 lợi ích mua trực tiếp. Chỉ khách chưa có
 * đơn theo định nghĩa đơn đầu của API (GET /me/new-customer-offer); khách chưa đăng nhập thì chỉ thấy phần lợi ích.
 * Đang tải, lỗi tải hay thiếu cấu hình → không vẽ gì: đây là khối quảng bá phụ, không đáng một khung chờ hay thẻ lỗi và không được hiện số suy đoán.
 */
export function NewCustomerGift({ initialConfig }: { initialConfig?: PublicConfig } = {}) {
  const phase = useAuthPhase();
  const restoring = useAuthRestoring();
  const authed = phase === 'authenticated';
  const userId = useAuth().user?.id;
  // Cùng queryKey/hàm với usePublicConfig → một cache; cần trạng thái lỗi riêng để ẩn khối thay vì hiện giá trị dự phòng.
  // placeholderData (không phải initialData): HTML server vẫn có khối này, nhưng bản dựng ISR có thể cũ tới vài phút nên trình duyệt phải tải
  // cấu hình thật; initialData làm cache coi bản dựng sẵn là mới và các khối khác (lối tắt Đổi rác...) đọc nhầm cấu hình cũ.
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000, ...(initialConfig ? { placeholderData: initialConfig } : {}) });
  const offerQ = useQuery({ ...newCustomerOfferQuery(coreHttp, userId), enabled: authed, retry: false });

  // Đang khôi phục một phiên đã có (có cờ phiên) hoặc mất mạng lúc khôi phục thì không hiện bản dành cho khách vãng lai rồi biến mất khi phiên về.
  // 'loading' mà không có cờ phiên là khách vãng lai thật (HTML server dựng sẵn bản này nên Danh mục không nhảy sau hydrate).
  if (restoring || phase === 'unavailable') return null;
  // Chưa biết có phải khách mới thì không chiếm chỗ: khung chờ cố định sẽ làm trang nhảy với mọi khách đã có đơn rồi mới biến mất.
  if (cfgQ.isError || cfgQ.isPending || (authed && (offerQ.isError || offerQ.isPending))) return null;
  if (authed && offerQ.data?.isNewCustomer !== true) return null;

  const voucher = authed ? (offerQ.data?.welcomeVoucher ?? null) : null;
  const benefits = directBenefits(cfgQ.data!);
  const voucherDetail = voucher
    ? [voucher.minOrder ? homeText.newGift.voucherMinOrder(formatVnd(voucher.minOrder)) : null, homeText.newGift.voucherExpires(formatDate(voucher.endAt))]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <section aria-label={homeText.newGift.title} style={{ padding: '8px 0 12px' }}>
      <Card variant="flat" padding={16}>
        <Heading variant="title-sm" as="h2">
          {homeText.newGift.title}
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
          {homeText.newGift.benefitsTitle}
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
          <Link href="/san-pham" className="zaui-btn zaui-btn-secondary tubu-btn" style={CTA_STYLE}>
            <span>{homeText.newGift.cta}</span>
          </Link>
        </div>
      </Card>
    </section>
  );
}

/** Link dựng như Button secondary của Mini App (cùng lớp zaui-btn, cao 44, bo theo token) để mở thẳng /san-pham như một liên kết thật. */
const CTA_STYLE = {
  minWidth: 0,
  minHeight: 44,
  borderRadius: 'var(--radius-control)',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
} as const;
