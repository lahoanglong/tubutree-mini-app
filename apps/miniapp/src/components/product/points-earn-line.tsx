import { Box, Text } from 'zmp-ui';
import { useQueryClient } from '@tanstack/react-query';
import { Leaf } from 'lucide-react';
import { usePublicConfig } from '../../hooks/use-public-config';
import type { LoyaltyOverview } from '../../services/account-api';
import { pointsEarnPreview } from '../../utils/points-earn';
import { vi } from '../../i18n/vi';

/**
 * Hệ số hạng của khách, hoặc null khi chưa biết: khách chưa đăng nhập và tài khoản chưa có hạng thì server tính hệ số 1
 * (getTierMultiplier); tài khoản có hạng chỉ biết được từ tổng quan Điểm Xanh đã tải ở màn khác (không gọi thêm API ở
 * PDP, trang đông khách nhất), chưa có thì nói chung thay vì đoán.
 */
function tierMultiplierOf(
  authStatus: string,
  tierId: string | null | undefined,
  overview: LoyaltyOverview | undefined,
): number | null {
  if (authStatus === 'loading') return null;
  if (authStatus !== 'authenticated') return 1;
  if (overview) return overview.tier?.multiplier ?? 1;
  return tierId === null ? 1 : null;
}

/** Dòng "Nhận … Điểm Xanh" dưới giá ở PDP (D2-07c). `goods` là giá trị hàng đang chọn (đơn giá × số lượng). */
export function PointsEarnLine({ goods, authStatus, tierId }: { goods: number; authStatus: string; tierId?: string | null }) {
  const config = usePublicConfig();
  const queryClient = useQueryClient();
  const overview = queryClient.getQueryData<LoyaltyOverview>(['loyalty']);
  const preview = pointsEarnPreview(goods, config.loyalty, tierMultiplierOf(authStatus, tierId, overview));
  if (preview === null) return null;
  return (
    <Box flex alignItems="center" style={{ gap: 6, marginTop: 6 }}>
      <Leaf size={15} color="var(--color-text-brand)" strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />
      <Text size="xSmall" style={{ color: 'var(--color-text-brand)', fontWeight: 600 }}>
        {preview === 'generic' ? vi.product.pointsEarnGeneric : vi.product.pointsEarn(preview.points, preview.valueVnd)}
      </Text>
    </Box>
  );
}
