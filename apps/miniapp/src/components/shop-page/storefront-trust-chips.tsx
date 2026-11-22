import { useId } from 'react';
import { CreditCard, PackageSearch, RotateCcw, ShieldCheck } from 'lucide-react';
import { STOREFRONT_TRUST_TITLE, storefrontTrustChips, type StorefrontTrustKey } from '@tubutree/app-core/commerce/storefront-trust';
import { SR_ONLY } from '../ui/sr-only';
import '../../css/storefront-trust.css';

export interface StorefrontTrustChipsProps {
  /** `returnWindowDays` của cấu hình công khai: 0 bỏ chip đổi trả, chưa biết thì hứa chung. */
  returnWindowDays: unknown;
}

const ICONS: Record<StorefrontTrustKey, typeof ShieldCheck> = { reviewed: ShieldCheck, tracking: PackageSearch, payment: CreditCard, returns: RotateCcw };

/**
 * Dải cam kết ngay dưới đầu gian hàng: hàng chip gọn chữ ngắn (tối đa hai hàng ở 375px), cùng chữ và số đo với web `/s/[slug]` trên điện thoại.
 * Chip chỉ để đọc, không bấm được.
 */
export function StorefrontTrustChips({ returnWindowDays }: StorefrontTrustChipsProps) {
  // Bộ sưu tập thành phần vẽ hai biến thể trên cùng trang: id tiêu đề không được trùng.
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="tubu-sf-trust" data-testid="storefront-trust">
      <h2 id={headingId} style={SR_ONLY}>
        {STOREFRONT_TRUST_TITLE}
      </h2>
      <ul role="list" className="tubu-sf-trust-list">
        {storefrontTrustChips(returnWindowDays).map((chip) => {
          const Icon = ICONS[chip.key];
          return (
            <li key={chip.key} className="tubu-sf-trust-chip">
              <Icon className="tubu-sf-trust-icon" aria-hidden="true" />
              <span className="tubu-sf-trust-text">{chip.short}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
