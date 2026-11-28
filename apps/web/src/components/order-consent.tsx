'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { LEGAL_PAGES } from '@tubutree/app-core/legal';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { BottomSheet } from '@/components/mini/bottom-sheet';

/** Năm chính sách Bộ Công Thương yêu cầu, cùng thứ tự với Mini App (`ORDER_CONSENT_POLICIES`). */
const POLICIES = ['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen', 'thanh-toan'] as const;

export interface OrderConsentProps {
  /** Lớp đặt chỗ của trang (ẩn hay hiện theo khổ). */
  className?: string;
}

/**
 * Một dòng đồng ý điều khoản ngay cạnh nút Đặt hàng (w47-01, không có ô tick: đặt hàng là hành vi đồng ý): "Đặt đơn nghĩa là bạn đồng ý Điều khoản &
 * Chính sách", cả dòng là nút mở tấm năm chính sách. Ở điện thoại trang thanh toán ẩn chân trang (thanh Đặt hàng dính đáy) nên tấm này là lối tới các
 * chính sách. Cùng chữ và lớp `.tubu-consent-*` với Mini App (`apps/miniapp/src/components/checkout/order-consent.tsx`).
 */
export function OrderConsent({ className = '' }: OrderConsentProps) {
  const [open, setOpen] = useState(false);
  const line = fillCopy('checkout.consentLine');
  const link = fillCopy('checkout.consentSheet');
  const at = line.indexOf(link);
  return (
    // Khung chứa ở web đã có đệm ngang của dải (max-md:px-4): dòng không thêm đệm ngang lần nữa.
    <div className={`[&>.tubu-consent-line]:px-0 ${className}`}>
      <button type="button" data-testid="order-consent" aria-haspopup="dialog" className="tubu-consent-line tubu-press" onClick={() => setOpen(true)}>
        {at >= 0 ? (
          <>
            {line.slice(0, at)}
            <span className="tubu-consent-line-link">{link}</span>
            {line.slice(at + link.length)}
          </>
        ) : (
          line
        )}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={link}>
        <ul data-testid="order-consent-policies" className="tubu-consent-list">
          {POLICIES.map((slug) => (
            <li key={slug}>
              <Link href={`/chinh-sach/${slug}`} className="tubu-consent-item tubu-press" onClick={() => setOpen(false)}>
                {LEGAL_PAGES[slug].title}
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}
