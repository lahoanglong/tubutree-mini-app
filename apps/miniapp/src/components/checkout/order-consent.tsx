import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { LegalSlug } from '../../services/legal-api';
import { LEGAL_PAGES } from '@tubutree/app-core/legal-core';
import { BottomSheet } from '../ui/bottom-sheet';
import { haptic } from '../../utils/haptic';
import '../../css/declutter.css';

/** Năm chính sách Bộ Công Thương yêu cầu, cùng thứ tự với web. */
export const ORDER_CONSENT_POLICIES: readonly LegalSlug[] = ['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen', 'thanh-toan'];

export interface OrderConsentProps {
  /** Mở một chính sách ngay trong app (PolicySheet của trang). */
  onOpenPolicy: (slug: LegalSlug) => void;
}

/**
 * Một dòng đồng ý điều khoản cạnh nút Đặt hàng (w47-01): "Đặt đơn nghĩa là bạn đồng ý Điều khoản & Chính sách", cả dòng là nút mở tấm năm chính sách.
 * Ở điện thoại trang thanh toán ẩn chân trang nên tấm này là lối tới các chính sách; đặt hàng là hành vi đồng ý (không có ô tick).
 * Cùng chữ và lớp CSS với `apps/web/src/components/order-consent.tsx`.
 */
export function OrderConsent({ onOpenPolicy }: OrderConsentProps) {
  const [open, setOpen] = useState(false);
  const line = fillCopy('checkout.consentLine');
  const link = fillCopy('checkout.consentSheet');
  const at = line.indexOf(link);
  return (
    <>
      <button
        type="button"
        data-testid="order-consent"
        aria-haspopup="dialog"
        className="tubu-consent-line tubu-press"
        onClick={() => {
          haptic('light');
          setOpen(true);
        }}
      >
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
          {ORDER_CONSENT_POLICIES.map((slug) => (
            <li key={slug}>
              <button
                type="button"
                className="tubu-consent-item tubu-press"
                onClick={() => {
                  haptic('light');
                  setOpen(false);
                  onOpenPolicy(slug);
                }}
              >
                {LEGAL_PAGES[slug].title}
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}
