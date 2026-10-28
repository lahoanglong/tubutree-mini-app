'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CalendarClock, ChevronDown, ChevronUp, Gift, Leaf, Ticket, Truck, type LucideIcon } from 'lucide-react';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { HOME_HERO_HEIGHT } from '@tubutree/app-core/home-layout';
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
import { Card, Icon, Skeleton, Text } from '@/components/mini';

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
 * Dải gọn một dòng (cao bằng thẻ thành viên), chi tiết mở bằng "Xem quyền lợi". Đang tải: khung chờ cùng chiều cao; lỗi tải hay thiếu cấu hình: thu lại,
 * không hiện số suy đoán. Khách chưa đăng nhập được hứa mã chào mừng theo cấu hình công khai và nút "Nhận quà" dẫn tới đăng nhập (như Mini App).
 */
export function NewCustomerGift({ initialConfig }: { initialConfig?: PublicConfig } = {}) {
  const [expanded, setExpanded] = useState(false);
  const phase = useAuthPhase();
  const restoring = useAuthRestoring();
  const authed = phase === 'authenticated';
  const userId = useAuth().user?.id;
  // Cùng queryKey/hàm với usePublicConfig → một cache; cần trạng thái lỗi riêng để ẩn khối thay vì hiện giá trị dự phòng.
  // placeholderData (không phải initialData): HTML server vẫn có khối này, nhưng bản dựng ISR có thể cũ tới vài phút nên trình duyệt phải tải
  // cấu hình thật; initialData làm cache coi bản dựng sẵn là mới và các khối khác (lối tắt Đổi rác...) đọc nhầm cấu hình cũ.
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000, ...(initialConfig ? { placeholderData: initialConfig } : {}) });
  const offerQ = useQuery({ ...newCustomerOfferQuery(coreHttp, userId), enabled: authed, retry: false });

  // Mất mạng lúc khôi phục phiên: chưa biết là ai nên không hứa gì. Đang khôi phục một phiên đã có, hay chưa biết có phải khách mới:
  // giữ chỗ bằng khung chờ cao bằng dải thật (cũng là chiều cao thẻ thành viên) để trang không nhảy. 'loading' mà không có cờ phiên là
  // khách vãng lai thật (HTML server dựng sẵn bản này nên Danh mục không nhảy sau hydrate).
  if (phase === 'unavailable') return null;
  if (cfgQ.isError || (authed && offerQ.isError)) return null;
  if (restoring || cfgQ.isPending || (authed && offerQ.isPending)) return <NewCustomerGiftSkeleton />;
  if (authed && offerQ.data?.isNewCustomer !== true) return null;

  const voucher = authed ? (offerQ.data?.welcomeVoucher ?? null) : null;
  // Khách chưa đăng nhập chưa có mã riêng: nói mệnh giá mã chào mừng từ cấu hình công khai (thiếu thì không hứa số), kèm nút đăng nhập để nhận.
  const promised = authed ? null : (cfgQ.data!.newCustomer?.welcomeVoucher ?? null);
  const benefits = directBenefits(cfgQ.data!);
  const minOrderShort = (min: number | null | undefined) => (min ? homeText.newGift.voucherMinOrder(formatVnd(min)).toLowerCase() : null);
  const headline = voucher
    ? [homeText.newGift.voucherShort(voucherAmountText(voucher)), minOrderShort(voucher.minOrder)].filter(Boolean).join(' · ')
    : promised && promised.amount > 0
      ? [homeText.newGift.voucherShort(formatVnd(promised.amount)), minOrderShort(promised.minOrder)].filter(Boolean).join(' · ')
      : benefits[0]!.text;
  const voucherDetail = voucher
    ? [voucher.minOrder ? homeText.newGift.voucherMinOrder(formatVnd(voucher.minOrder)) : null, homeText.newGift.voucherExpires(formatDate(voucher.endAt))]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <section aria-label={homeText.newGift.title} style={{ padding: '0 0 12px' }}>
      <Card variant="flat" padding={0}>
        <div style={{ minHeight: HOME_HERO_HEIGHT, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 0 16px' }}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${homeText.newGift.title}: ${headline}. ${expanded ? homeText.newGift.collapse : homeText.newGift.expand}`}
            className="tubu-press"
            onClick={() => setExpanded((v) => !v)}
            style={{ flex: 1, minWidth: 0, minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, padding: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <Icon icon={Gift} tone="brand" />
            <span style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" as="div" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {homeText.newGift.title}
              </Text>
              <Text variant="caption" tone="secondary" as="div" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {headline}
              </Text>
            </span>
            <Icon icon={expanded ? ChevronUp : ChevronDown} size="sm" tone="muted" />
          </button>
          {promised && promised.amount > 0 ? (
            <Link href="/dang-nhap" aria-label={homeCopy.guestGift.cta} className="zaui-btn zaui-btn-primary tubu-btn" style={CTA_STYLE}>
              <span>{homeCopy.guestGift.ctaShort}</span>
            </Link>
          ) : (
            <Link href="/san-pham" className="zaui-btn zaui-btn-secondary tubu-btn" style={CTA_STYLE}>
              <span>{homeText.newGift.cta}</span>
            </Link>
          )}
        </div>
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
                    {homeText.newGift.voucherAmount(formatVnd(promised.amount))}
                  </Text>
                  <Text variant="caption" tone="secondary" as="div">
                    {[promised.minOrder ? homeText.newGift.voucherMinOrder(formatVnd(promised.minOrder)) : null, homeCopy.guestGift.webCtaHint].filter(Boolean).join(' · ')}
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
          </div>
        )}
      </Card>
    </section>
  );
}

function NewCustomerGiftSkeleton() {
  return (
    <div data-testid="new-customer-gift-loading" aria-hidden="true" className="pb-3">
      <Skeleton height={HOME_HERO_HEIGHT} radius="var(--radius-card)" />
    </div>
  );
}

function voucherAmountText(v: NonNullable<NewCustomerOffer['welcomeVoucher']>): string {
  if (v.type === 'PERCENT') return `${v.value}%`;
  if (v.type === 'FREESHIP') return 'freeship';
  return formatVnd(v.value);
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
