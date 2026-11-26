import { Text } from '../ui/text';

/** Câu "n điểm từ đơn sàn chỉ dùng khi mua hàng" dưới vòng quay và quỹ trồng cây (W42); không có điểm sàn thì không vẽ. */
export function MarketplacePointsNote({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <div data-testid="marketplace-points-note">
      <Text variant="caption" tone="secondary" as="div">
        {note}
      </Text>
    </div>
  );
}
