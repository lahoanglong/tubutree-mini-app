import { Box, Text } from 'zmp-ui';
import { Leaf } from 'lucide-react';
import { usePublicConfig } from '../../hooks/use-public-config';
import { tierEarnOf } from '@tubutree/app-core/points-earn-tier';
import { pointsEarnPreview } from '../../utils/points-earn';
import { vi } from '../../i18n/vi';

/**
 * Hệ số hạng của khách, hoặc null khi chưa biết. Khách chưa đăng nhập và tài khoản chưa có hạng thì server tính hệ số 1
 * (getTierMultiplier). Tài khoản có hạng lấy hệ số từ bảng hạng trong config công khai theo `tierId` của chính họ: không gọi
 * thêm API ở PDP và không phụ thuộc tổng quan Điểm Xanh có đã tải ở màn khác hay chưa.
 */
function tierEarnFor(authStatus: string, tierId: string | null | undefined, loyalty: Parameters<typeof tierEarnOf>[0]) {
  if (authStatus === 'loading') return null;
  if (authStatus !== 'authenticated') return { multiplier: 1, tierName: null };
  return tierEarnOf(loyalty, tierId);
}

/** Dòng "Nhận … Điểm Xanh" dưới giá ở PDP (D2-07c). `goods` là giá trị hàng đang chọn (đơn giá × số lượng). */
export function PointsEarnLine({ goods, authStatus, tierId }: { goods: number; authStatus: string; tierId?: string | null }) {
  const config = usePublicConfig();
  const tier = tierEarnFor(authStatus, tierId, config.loyalty);
  const preview = pointsEarnPreview(goods, config.loyalty, tier?.multiplier ?? null);
  if (preview === null) return null;
  return (
    <Box flex alignItems="center" style={{ gap: 6, marginTop: 6 }}>
      <Leaf size={15} color="var(--color-text-brand)" strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />
      <Text size="xSmall" style={{ color: 'var(--color-text-brand)', fontWeight: 600 }}>
        {preview === 'generic' ? vi.product.pointsEarnGeneric : vi.product.pointsEarn(preview.points)}
      </Text>
    </Box>
  );
}
