import type { WastePublicFlags } from '@tubutree/shared-types';
import { isGomdonRecyclingEnabled } from '../../integrations/gomdon/gomdon-config';
import type { SystemConfigService } from '../../system-config/system-config.service';

/**
 * Cờ chương trình đổi rác cho miniapp (spec 11.5, 12.4). Chỉ JSON true mới bật (config là Json, chuỗi "true" vẫn là tắt).
 * Gomdon chỉ được hỏi khi chương trình và đường thu gom đều bật, để cờ tắt không tốn một lần gọi Gomdon.
 */
export async function computeWastePublicFlags(
  config: Pick<SystemConfigService, 'get'>,
  gomdonEnabled: () => Promise<boolean> = () => isGomdonRecyclingEnabled(config).catch(() => false),
): Promise<WastePublicFlags> {
  const [enabled, laneDropoff, laneMailin, lanePickup] = await Promise.all([
    config.get<unknown>('waste.enabled', false),
    config.get<unknown>('waste.lane_dropoff_enabled', true),
    config.get<unknown>('waste.lane_mailin_enabled', true),
    config.get<unknown>('waste.lane_pickup_enabled', false),
  ]);
  if (enabled !== true) return { enabled: false, dropoff: false, mailin: false, pickup: false };
  const pickup = lanePickup === true ? await gomdonEnabled().catch(() => false) : false;
  return { enabled: true, dropoff: laneDropoff === true, mailin: laneMailin === true, pickup };
}
