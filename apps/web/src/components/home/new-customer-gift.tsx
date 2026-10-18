'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Leaf, Ticket, Truck, type LucideIcon } from 'lucide-react';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import type { NewCustomerOffer } from '@tubutree/app-core/api/loyalty';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { newCustomerOfferQuery } from '@tubutree/app-core/queries/loyalty';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { formatDate } from '@/lib/format-date';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { homeText } from '@/lib/home-text';
import { earnPctOf, percentLabel } from '@/lib/points-boost';

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
export function NewCustomerGift() {
  const phase = useAuthPhase();
  const authed = phase === 'authenticated';
  const userId = useAuth().user?.id;
  // Cùng queryKey/hàm với usePublicConfig → một cache; cần trạng thái lỗi riêng để ẩn khối thay vì hiện giá trị dự phòng.
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000 });
  const offerQ = useQuery({ ...newCustomerOfferQuery(coreHttp, userId), enabled: authed, retry: false });

  // Web chưa biết khách đã đăng nhập hay chưa (đang khôi phục phiên, hoặc mất mạng lúc khôi phục) thì không hiện bản dành cho khách vãng lai
  // rồi biến mất khi phiên về.
  if (phase === 'loading' || phase === 'unavailable') return null;
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
    <section aria-label={homeText.newGift.title} className="py-2">
      <div className="rounded-card bg-forest-50 p-4">
        <h2 className="font-display text-lg font-semibold text-stone-900">{homeText.newGift.title}</h2>
        {voucher && (
          <div className="mt-3 flex items-center gap-3">
            <Ticket className="h-5 w-5 flex-none text-forest-600" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-stone-900">{voucherTitle(voucher)}</p>
              <p className="text-xs text-stone-600">{voucherDetail}</p>
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-stone-600">{homeText.newGift.benefitsTitle}</p>
        <ul className="mt-2 flex flex-col gap-2">
          {benefits.map((b) => (
            <li key={b.text} className="flex items-start gap-2">
              <b.icon className="mt-0.5 h-4 w-4 flex-none text-forest-600" aria-hidden="true" />
              <span className="text-sm text-stone-700">{b.text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Link href="/san-pham" className={ui.btnSecondary}>
            {homeText.newGift.cta}
          </Link>
        </div>
      </div>
    </section>
  );
}
