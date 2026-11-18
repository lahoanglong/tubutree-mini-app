import { Text } from '../ui/text';

/** Dòng "≈ 12.300đ / 100ml" ngay dưới giá trang chi tiết (cờ `catalog.unit_price_enabled`). Phép chia và chữ ở `commerce/unit-price.ts`; app chỉ vẽ. */
export function UnitPriceLine({ text }: { text: string }) {
  return (
    <Text variant="caption" as="div" tone="secondary" numeric data-testid="pdp-unit-price" style={{ marginTop: 'var(--space-stack-xs)' }}>
      {text}
    </Text>
  );
}
