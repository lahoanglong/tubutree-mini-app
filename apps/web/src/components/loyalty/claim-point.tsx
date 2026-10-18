import type { GiftRedemptionDTO } from '@tubutree/shared-types';
import { openingHoursText, pointAddress } from '@tubutree/app-core/reward-rules';

type ClaimPoint = NonNullable<GiftRedemptionDTO['claimPoint']>;

/** Địa chỉ và giờ mở cửa của nơi nhận quà, dùng ở bước xác nhận đổi và ở "Quà của tôi". */
export function ClaimPointInfo({ point, heading }: { point: ClaimPoint; heading: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-sm font-semibold text-stone-900">{heading}</div>
      <div className="text-xs text-stone-700">{pointAddress(point)}</div>
      <div className="text-xs text-stone-700">{openingHoursText(point.openingHours)}</div>
    </div>
  );
}
