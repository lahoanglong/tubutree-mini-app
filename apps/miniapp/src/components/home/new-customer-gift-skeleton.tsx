import { HOME_HERO_HEIGHT } from '@tubutree/app-core/home-layout';
import { Skeleton } from '../ui/skeleton';

/** Đệm quanh dải quà khách mới, dùng chung cho dải thật và khung chờ của nó. */
export const GIFT_SECTION_PAD = '0 16px 12px';

/**
 * Khung chờ của dải quà khách mới. Cũng là chỗ giữ trong lúc chunk khối dưới chưa về (home-lazy), nên hai trạng thái là cùng một phần tử
 * và đổi từ cái này sang cái kia không dịch chuyển gì.
 */
export function NewCustomerGiftSkeleton() {
  return (
    <div data-testid="new-customer-gift-loading" aria-hidden="true" style={{ padding: GIFT_SECTION_PAD }}>
      <Skeleton height={HOME_HERO_HEIGHT} radius="var(--radius-card)" />
    </div>
  );
}
