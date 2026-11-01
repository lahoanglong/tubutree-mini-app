import { useState } from 'react';
import { Text } from 'zmp-ui';
import { ChevronRight, Leaf } from 'lucide-react';
import { pointsEarnPopup, POINTS_EARN_POPUP } from '@tubutree/app-core/points-earn-popup';
import { usePublicConfig } from '../../hooks/use-public-config';
import { tierEarnOf } from '@tubutree/app-core/points-earn-tier';
import { pointsEarnPreview } from '../../utils/points-earn';
import { percentLabel, pointsBoostOf } from '../../utils/loyalty-copy';
import { PointsEarnSheet } from './points-earn-sheet';
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

/**
 * Dòng "Nhận … Điểm Xanh" dưới giá ở PDP (D2-07c), bấm mở popup Cách tính Điểm Xanh. `goods` là giá trị hàng đang chọn (đơn giá × số lượng).
 * Vùng bấm cao 44px bằng padding bù margin âm: dòng không đẩy nội dung bên dưới.
 */
export function PointsEarnLine({ goods, authStatus, tierId }: { goods: number; authStatus: string; tierId?: string | null }) {
  const config = usePublicConfig();
  const [open, setOpen] = useState(false);
  const tier = tierEarnFor(authStatus, tierId, config.loyalty);
  const preview = pointsEarnPreview(goods, config.loyalty, tier?.multiplier ?? null);
  if (preview === null) return null;
  const text = preview === 'generic' ? vi.product.pointsEarnGeneric : vi.product.pointsEarn(preview.points);
  const boost = pointsBoostOf(config.isLoaded ? config.loyalty : undefined);
  const popup = pointsEarnPopup({
    tier,
    guest: authStatus !== 'authenticated' && authStatus !== 'loading',
    marketplace: boost?.kind === 'compare' ? vi.externalPoints.boostSub(percentLabel(boost.marketplacePct), percentLabel(boost.appPct)) : null,
  });
  return (
    <>
      <button
        type="button"
        aria-label={`${text}. ${POINTS_EARN_POPUP.rowAria}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 44, margin: '-7px 0 -13px', padding: 0, background: 'none', border: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
      >
        <Leaf size={15} color="var(--color-text-brand)" strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />
        <Text size="xSmall" style={{ color: 'var(--color-text-brand)', fontWeight: 600 }}>
          {text}
        </Text>
        <ChevronRight size={14} color="var(--color-text-brand)" aria-hidden style={{ flexShrink: 0 }} />
      </button>
      <PointsEarnSheet open={open} onClose={() => setOpen(false)} popup={popup} />
    </>
  );
}
