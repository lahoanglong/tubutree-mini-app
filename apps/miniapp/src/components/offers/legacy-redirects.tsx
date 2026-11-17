import { Navigate, useLocation } from 'react-router-dom';
import { legacyRewardsTarget, legacyVouchersTarget } from '@tubutree/app-core/commerce/offers-hub';

/**
 * Mã giảm giá (`/vouchers`) và Kho quà (`/rewards`) không còn trang riêng mà là tab của Ưu đãi. Đường cũ vẫn nằm trong bộ định tuyến để link trong
 * thông báo, ZNS đã gửi và chiến dịch cũ tới đúng tab, giữ mọi tham số khác (`code=X`); `replace` để Back không quay về đường cũ rồi bị đẩy đi lần nữa.
 */
export function LegacyVouchersRedirect() {
  return <Navigate to={legacyVouchersTarget('/offers', useLocation().search)} replace />;
}

export function LegacyRewardsRedirect() {
  return <Navigate to={legacyRewardsTarget('/offers', useLocation().search)} replace />;
}
