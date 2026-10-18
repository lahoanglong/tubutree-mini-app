import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { WasteConfigService } from './waste-config.service';
import { WASTE_CONFIG_KEYS } from '../waste-config.keys';
import type { SystemConfigService } from '../../system-config/system-config.service';

function makeConfig(values: Record<string, unknown> = {}) {
  const get = jest.fn(async (key: string, fallback?: unknown) => (key in values ? values[key] : fallback));
  return { svc: new WasteConfigService({ get } as unknown as SystemConfigService), get };
}
const FEE = { zones: [], defaultZone: { name: 'Toàn quốc', low: 30000, high: 85000 } };
const THRESHOLDS = {
  quotaPacePct: 60, quotaPaceDays: 10, fullMatchPct: 95, fullMatchMinSample: 10, repeatCustomerCount: 3, repeatCustomerDays: 7,
  avgUnitsFactor: 2, lookupMissCount: 10, lookupMissDays: 1, staffDirectCount: 5, staffDirectDays: 7,
};
const DEFAULTS = {
  enabled: false, laneDropoff: true, laneMailin: true, lanePickup: false, mailinMinPoints: 15_000, pickupMinPoints: 10_000,
  customerMonthlyCapPoints: 60_000, maxOpenRequests: 3, requestHoldDays: 7, pickupWaitDays: 14, inTransitReviewDays: 30,
  mailinMaxWeightKg: 20, mailinMaxEdgeCm: 50, shortfallLockPct: 50, shortfallLockStreak: 3, staffDailyCapPoints: 1_000_000,
  giftClaimDays: 60, pointInactiveDays: 60, mailinFeeTable: FEE, alertThresholds: THRESHOLDS, rulesText: '',
};

describe('WasteConfigService.snapshot', () => {
  afterEach(() => jest.restoreAllMocks());

  it('no stored rows -> the 21 defaults of spec 11.5', async () => {
    expect(await makeConfig().svc.snapshot()).toEqual(DEFAULTS);
  });

  it('valid stored values pass through', async () => {
    const fee = { zones: [{ name: 'Miền Bắc', provinceCodes: ['01'], low: 35000, high: 90000 }], defaultZone: FEE.defaultZone };
    const { svc } = makeConfig({
      'waste.enabled': true, 'waste.lane_pickup_enabled': true, 'waste.mailin_min_points': 20_000,
      'waste.customer_monthly_cap_points': 80_000, 'waste.mailin_fee_table': fee, 'waste.rules_text': 'Thể lệ',
    });
    expect(await svc.snapshot()).toEqual({ ...DEFAULTS, enabled: true, lanePickup: true, mailinMinPoints: 20_000, customerMonthlyCapPoints: 80_000, mailinFeeTable: fee, rulesText: 'Thể lệ' });
  });

  it.each([
    ['waste.enabled', 'true', 'enabled', false],
    ['waste.mailin_min_points', 0, 'mailinMinPoints', 15_000],
    ['waste.mailin_min_points', 1_000_001, 'mailinMinPoints', 15_000],
    ['waste.max_open_requests', 2.5, 'maxOpenRequests', 3],
    ['waste.in_transit_review_days', 6, 'inTransitReviewDays', 30],
    ['waste.mailin_fee_table', { zones: 'x' }, 'mailinFeeTable', FEE],
    ['waste.mailin_fee_table', { zones: [{ name: 'A', provinceCodes: ['01'], low: 90000, high: 30000 }], defaultZone: FEE.defaultZone }, 'mailinFeeTable', FEE],
    ['waste.alert_thresholds', { quotaPacePct: 60 }, 'alertThresholds', THRESHOLDS],
    ['waste.rules_text', 42, 'rulesText', ''],
  ])('invalid %s = %p -> default and exactly one warning naming the key', async (key, raw, field, expected) => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const snap = await makeConfig({ [key]: raw }).svc.snapshot();
    expect(snap[field as keyof typeof snap]).toEqual(expected);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(key);
  });

  it('reads each of the 21 keys once, with an inline string literal and the record default as fallback', async () => {
    const { svc, get } = makeConfig();
    await svc.snapshot();
    expect(get.mock.calls.map((c) => c[0]).sort()).toEqual(Object.keys(WASTE_CONFIG_KEYS).sort());
    for (const [key, fb] of get.mock.calls) expect(fb).toEqual(WASTE_CONFIG_KEYS[key as keyof typeof WASTE_CONFIG_KEYS].default);
    const src = readFileSync(join(__dirname, 'waste-config.service.ts'), 'utf-8');
    const literals = [...src.matchAll(/\.get<unknown>\(\s*'(waste\.[a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(literals)].sort()).toEqual(Object.keys(WASTE_CONFIG_KEYS).sort());
  });
});

describe('WasteConfigService.isEnabled', () => {
  it.each([[true, true], [false, false], ['true', false], [1, false], [undefined, false]])('waste.enabled = %p -> %p', async (raw, expected) => {
    const { svc, get } = makeConfig(raw === undefined ? {} : { 'waste.enabled': raw });
    await expect(svc.isEnabled()).resolves.toBe(expected);
    expect(get).toHaveBeenCalledWith('waste.enabled', false);
  });
});
