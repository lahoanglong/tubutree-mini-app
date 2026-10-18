import { Injectable, Logger } from '@nestjs/common';
import type { WasteAlertThresholds, WasteFeeTable } from '@tubutree/shared-types';
import { SystemConfigService } from '../../system-config/system-config.service';
import { WASTE_CONFIG_KEYS, type WasteConfigKey } from '../waste-config.keys';

export interface WasteConfigSnapshot {
  enabled: boolean;
  laneDropoff: boolean;
  laneMailin: boolean;
  lanePickup: boolean;
  mailinMinPoints: number;
  pickupMinPoints: number;
  customerMonthlyCapPoints: number;
  maxOpenRequests: number;
  requestHoldDays: number;
  pickupWaitDays: number;
  inTransitReviewDays: number;
  mailinMaxWeightKg: number;
  mailinMaxEdgeCm: number;
  shortfallLockPct: number;
  shortfallLockStreak: number;
  staffDailyCapPoints: number;
  giftClaimDays: number;
  pointInactiveDays: number;
  mailinFeeTable: WasteFeeTable;
  alertThresholds: WasteAlertThresholds;
  rulesText: string;
}

const THRESHOLD_FIELDS: readonly (keyof WasteAlertThresholds)[] = [
  'quotaPacePct', 'quotaPaceDays', 'fullMatchPct', 'fullMatchMinSample', 'repeatCustomerCount', 'repeatCustomerDays',
  'avgUnitsFactor', 'lookupMissCount', 'lookupMissDays', 'staffDirectCount', 'staffDirectDays',
];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFeeRange = (v: Record<string, unknown>): boolean =>
  typeof v.name === 'string' && v.name.length > 0 &&
  typeof v.low === 'number' && Number.isInteger(v.low) && v.low >= 0 &&
  typeof v.high === 'number' && Number.isInteger(v.high) && v.high >= v.low;

function isFeeTable(v: unknown): v is WasteFeeTable {
  if (!isObject(v) || !Array.isArray(v.zones) || !isObject(v.defaultZone) || !isFeeRange(v.defaultZone)) return false;
  return v.zones.every(
    (z) => isObject(z) && isFeeRange(z) && Array.isArray(z.provinceCodes) && z.provinceCodes.every((c) => typeof c === 'string'),
  );
}

function isThresholds(v: unknown): v is WasteAlertThresholds {
  return isObject(v) && THRESHOLD_FIELDS.every((k) => typeof v[k] === 'number' && Number.isFinite(v[k]) && (v[k] as number) >= 0);
}

@Injectable()
export class WasteConfigService {
  private readonly logger = new Logger(WasteConfigService.name);

  constructor(private readonly config: SystemConfigService) {}

  /** Read once before a transaction opens; SystemConfigService caches each key for 60 s. */
  async snapshot(): Promise<WasteConfigSnapshot> {
    const [
      enabled, laneDropoff, laneMailin, lanePickup, mailinMinPoints, pickupMinPoints, customerMonthlyCapPoints,
      maxOpenRequests, requestHoldDays, pickupWaitDays, inTransitReviewDays, mailinMaxWeightKg, mailinMaxEdgeCm,
      shortfallLockPct, shortfallLockStreak, staffDailyCapPoints, giftClaimDays, pointInactiveDays,
      mailinFeeTable, alertThresholds, rulesText,
    ] = await Promise.all([
      this.config.get<unknown>('waste.enabled', WASTE_CONFIG_KEYS['waste.enabled'].default),
      this.config.get<unknown>('waste.lane_dropoff_enabled', WASTE_CONFIG_KEYS['waste.lane_dropoff_enabled'].default),
      this.config.get<unknown>('waste.lane_mailin_enabled', WASTE_CONFIG_KEYS['waste.lane_mailin_enabled'].default),
      this.config.get<unknown>('waste.lane_pickup_enabled', WASTE_CONFIG_KEYS['waste.lane_pickup_enabled'].default),
      this.config.get<unknown>('waste.mailin_min_points', WASTE_CONFIG_KEYS['waste.mailin_min_points'].default),
      this.config.get<unknown>('waste.pickup_min_points', WASTE_CONFIG_KEYS['waste.pickup_min_points'].default),
      this.config.get<unknown>('waste.customer_monthly_cap_points', WASTE_CONFIG_KEYS['waste.customer_monthly_cap_points'].default),
      this.config.get<unknown>('waste.max_open_requests', WASTE_CONFIG_KEYS['waste.max_open_requests'].default),
      this.config.get<unknown>('waste.request_hold_days', WASTE_CONFIG_KEYS['waste.request_hold_days'].default),
      this.config.get<unknown>('waste.pickup_wait_days', WASTE_CONFIG_KEYS['waste.pickup_wait_days'].default),
      this.config.get<unknown>('waste.in_transit_review_days', WASTE_CONFIG_KEYS['waste.in_transit_review_days'].default),
      this.config.get<unknown>('waste.mailin_max_weight_kg', WASTE_CONFIG_KEYS['waste.mailin_max_weight_kg'].default),
      this.config.get<unknown>('waste.mailin_max_edge_cm', WASTE_CONFIG_KEYS['waste.mailin_max_edge_cm'].default),
      this.config.get<unknown>('waste.shortfall_lock_pct', WASTE_CONFIG_KEYS['waste.shortfall_lock_pct'].default),
      this.config.get<unknown>('waste.shortfall_lock_streak', WASTE_CONFIG_KEYS['waste.shortfall_lock_streak'].default),
      this.config.get<unknown>('waste.staff_daily_cap_points', WASTE_CONFIG_KEYS['waste.staff_daily_cap_points'].default),
      this.config.get<unknown>('waste.gift_claim_days', WASTE_CONFIG_KEYS['waste.gift_claim_days'].default),
      this.config.get<unknown>('waste.point_inactive_days', WASTE_CONFIG_KEYS['waste.point_inactive_days'].default),
      this.config.get<unknown>('waste.mailin_fee_table', WASTE_CONFIG_KEYS['waste.mailin_fee_table'].default),
      this.config.get<unknown>('waste.alert_thresholds', WASTE_CONFIG_KEYS['waste.alert_thresholds'].default),
      this.config.get<unknown>('waste.rules_text', WASTE_CONFIG_KEYS['waste.rules_text'].default),
    ]);

    return {
      enabled: this.bool('waste.enabled', enabled),
      laneDropoff: this.bool('waste.lane_dropoff_enabled', laneDropoff),
      laneMailin: this.bool('waste.lane_mailin_enabled', laneMailin),
      lanePickup: this.bool('waste.lane_pickup_enabled', lanePickup),
      mailinMinPoints: this.int('waste.mailin_min_points', mailinMinPoints),
      pickupMinPoints: this.int('waste.pickup_min_points', pickupMinPoints),
      customerMonthlyCapPoints: this.int('waste.customer_monthly_cap_points', customerMonthlyCapPoints),
      maxOpenRequests: this.int('waste.max_open_requests', maxOpenRequests),
      requestHoldDays: this.int('waste.request_hold_days', requestHoldDays),
      pickupWaitDays: this.int('waste.pickup_wait_days', pickupWaitDays),
      inTransitReviewDays: this.int('waste.in_transit_review_days', inTransitReviewDays),
      mailinMaxWeightKg: this.int('waste.mailin_max_weight_kg', mailinMaxWeightKg),
      mailinMaxEdgeCm: this.int('waste.mailin_max_edge_cm', mailinMaxEdgeCm),
      shortfallLockPct: this.int('waste.shortfall_lock_pct', shortfallLockPct),
      shortfallLockStreak: this.int('waste.shortfall_lock_streak', shortfallLockStreak),
      staffDailyCapPoints: this.int('waste.staff_daily_cap_points', staffDailyCapPoints),
      giftClaimDays: this.int('waste.gift_claim_days', giftClaimDays),
      pointInactiveDays: this.int('waste.point_inactive_days', pointInactiveDays),
      mailinFeeTable: this.checked('waste.mailin_fee_table', mailinFeeTable, isFeeTable),
      alertThresholds: this.checked('waste.alert_thresholds', alertThresholds, isThresholds),
      rulesText: this.checked('waste.rules_text', rulesText, (v): v is string => typeof v === 'string'),
    };
  }

  async isEnabled(): Promise<boolean> {
    return (await this.config.get<unknown>('waste.enabled', false)) === true;
  }

  private checked<T>(key: WasteConfigKey, raw: unknown, valid: (v: unknown) => v is T): T {
    if (valid(raw)) return raw;
    this.logger.warn(`waste config ${key} không hợp lệ, dùng mặc định`);
    return WASTE_CONFIG_KEYS[key].default as unknown as T;
  }

  private bool(key: WasteConfigKey, raw: unknown): boolean {
    return this.checked(key, raw, (v): v is boolean => typeof v === 'boolean');
  }

  private int(key: WasteConfigKey, raw: unknown): number {
    const { min, max } = WASTE_CONFIG_KEYS[key] as { min: number; max: number };
    return this.checked(key, raw, (v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max);
  }
}
