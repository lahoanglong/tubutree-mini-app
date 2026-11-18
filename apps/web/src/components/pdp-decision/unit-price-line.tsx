import { phoneCaption } from '@/lib/phone-ui';

/**
 * Dòng "≈ 12.300đ / 100ml" dưới giá trang chi tiết (cờ `catalog.unit_price_enabled`), như `UnitPriceLine` của Mini. Nằm trong hàng giá (flex-wrap):
 * điện thoại chiếm cả hàng riêng như Mini; từ md đứng cạnh giá để cột mua không cao thêm.
 */
export function UnitPriceLine({ text }: { text: string }) {
  return (
    <p data-testid="pdp-unit-price" className={`basis-full text-sm tabular-nums text-[var(--color-text-secondary)] mt-1 md:mt-0 md:basis-auto ${phoneCaption}`}>
      {text}
    </p>
  );
}
