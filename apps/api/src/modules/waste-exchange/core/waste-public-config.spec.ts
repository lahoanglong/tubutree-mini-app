import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SystemConfigService } from '../../system-config/system-config.service';
import { computeWastePublicFlags } from './waste-public-config';

const cfg = (values: Record<string, unknown> = {}) =>
  ({
    get: jest.fn(async (key: string, fallback?: unknown) => (key in values ? values[key] : fallback)),
  }) as unknown as Pick<SystemConfigService, 'get'>;

describe('computeWastePublicFlags (spec 11.5, 12.4)', () => {
  it('defaults: programme off -> every flag false, Gomdon never asked', async () => {
    const gomdon = jest.fn().mockResolvedValue(true);
    await expect(computeWastePublicFlags(cfg(), gomdon)).resolves.toEqual({ enabled: false, dropoff: false, mailin: false, pickup: false });
    expect(gomdon).not.toHaveBeenCalled();
  });
  it('programme on with default lanes -> dropoff and mailin on, pickup off (lane default false), Gomdon not asked', async () => {
    const gomdon = jest.fn().mockResolvedValue(true);
    await expect(computeWastePublicFlags(cfg({ 'waste.enabled': true }), gomdon)).resolves.toEqual({ enabled: true, dropoff: true, mailin: true, pickup: false });
    expect(gomdon).not.toHaveBeenCalled();
  });
  it('pickup needs the programme, its lane flag and Gomdon', async () => {
    const on = { 'waste.enabled': true, 'waste.lane_pickup_enabled': true };
    await expect(computeWastePublicFlags(cfg(on), async () => true)).resolves.toMatchObject({ pickup: true });
    await expect(computeWastePublicFlags(cfg(on), async () => false)).resolves.toMatchObject({ pickup: false });
    await expect(computeWastePublicFlags(cfg(on), async () => { throw new Error('gomdon'); })).resolves.toMatchObject({ pickup: false });
  });
  it('programme off hides every lane even when the lane flags and Gomdon are on', async () => {
    const all = { 'waste.enabled': false, 'waste.lane_dropoff_enabled': true, 'waste.lane_mailin_enabled': true, 'waste.lane_pickup_enabled': true };
    await expect(computeWastePublicFlags(cfg(all), async () => true)).resolves.toEqual({ enabled: false, dropoff: false, mailin: false, pickup: false });
  });
  it('a lane flag off turns only that lane off', async () => {
    await expect(computeWastePublicFlags(cfg({ 'waste.enabled': true, 'waste.lane_mailin_enabled': false }), async () => true)).resolves.toEqual({ enabled: true, dropoff: true, mailin: false, pickup: false });
  });
  it('only a JSON true counts (the string "true" is off)', async () => {
    await expect(computeWastePublicFlags(cfg({ 'waste.enabled': 'true' }), async () => true)).resolves.toMatchObject({ enabled: false });
  });
  it('reads the four keys as inline literals (registry 8.5)', () => {
    const src = readFileSync(join(__dirname, 'waste-public-config.ts'), 'utf-8');
    for (const k of ['waste.enabled', 'waste.lane_dropoff_enabled', 'waste.lane_mailin_enabled', 'waste.lane_pickup_enabled']) expect(src).toContain(`'${k}'`);
  });
});
