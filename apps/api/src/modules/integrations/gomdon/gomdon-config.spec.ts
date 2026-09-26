import {
  GOMDON_PRODUCTION_BASE_URL,
  GOMDON_RECYCLING_TOGGLE_KEY,
  isGomdonRecyclingEnabled,
  loadGomdonConfig,
  resolveGomdonBaseUrl,
} from './gomdon-config';
import { recyclingWeight } from './gomdon-weight';
import { gomdonRank, isGomdonPickedUp, isGomdonPayable, isGomdonTerminal } from './gomdon-status';
import type { SystemConfigService } from '../../system-config/system-config.service';

function cfg(values: Record<string, unknown> = {}): Pick<SystemConfigService, 'get'> {
  return {
    get: jest.fn(async (k: string, fb?: unknown) => (k in values ? values[k] : fb)),
  } as unknown as Pick<SystemConfigService, 'get'>;
}

describe('resolveGomdonBaseUrl — dev không bao giờ mặc định đặt bưu tá thật', () => {
  it('dev/test không đặt GOMDON_BASE_URL → rỗng (coi như chưa cấu hình)', () => {
    expect(resolveGomdonBaseUrl({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe('');
    expect(resolveGomdonBaseUrl({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe('');
  });
  it('production không đặt → URL production', () => {
    expect(resolveGomdonBaseUrl({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(GOMDON_PRODUCTION_BASE_URL);
  });
  it('đặt rõ → dùng giá trị đó (bỏ / cuối)', () => {
    expect(resolveGomdonBaseUrl({ NODE_ENV: 'development', GOMDON_BASE_URL: 'https://sandbox.x/' } as NodeJS.ProcessEnv)).toBe(
      'https://sandbox.x',
    );
  });
});

describe('loadGomdonConfig', () => {
  it('tài khoản ưu tiên ENV hơn SystemConfig; kho mặc định được gộp', async () => {
    const out = await loadGomdonConfig(
      cfg({ 'shipping.gomdon.config': { phone: 'cfg-phone', password: 'cfg-pass', defaultWarehouse: { name: 'Kho B' } } }),
      { NODE_ENV: 'production', GOMDON_PHONE: 'env-phone', GOMDON_PASSWORD: 'env-pass' } as NodeJS.ProcessEnv,
    );
    expect(out.phone).toBe('env-phone');
    expect(out.password).toBe('env-pass');
    expect(out.defaultWarehouse.name).toBe('Kho B');
    expect(out.defaultWarehouse.province).toBeTruthy();
    expect(out.defaultWeightFallback).toBe(500);
  });
  it('config null/rác → không crash, dùng mặc định', async () => {
    const out = await loadGomdonConfig(cfg({ 'shipping.gomdon.config': null }), {} as NodeJS.ProcessEnv);
    expect(out.phone).toBe('');
    expect(out.defaultWeightFallback).toBe(500);
  });
});

describe('isGomdonRecyclingEnabled — cờ tính năng checkout', () => {
  const prodEnv = { NODE_ENV: 'production', GOMDON_PHONE: 'p', GOMDON_PASSWORD: 'x' } as NodeJS.ProcessEnv;
  it('cấu hình đủ + công tắc true → true', async () => {
    expect(await isGomdonRecyclingEnabled(cfg({ [GOMDON_RECYCLING_TOGGLE_KEY]: true }), prodEnv)).toBe(true);
  });
  it('công tắc tắt/chưa seed/chuỗi "true" → false', async () => {
    expect(await isGomdonRecyclingEnabled(cfg({}), prodEnv)).toBe(false);
    expect(await isGomdonRecyclingEnabled(cfg({ [GOMDON_RECYCLING_TOGGLE_KEY]: 'true' }), prodEnv)).toBe(false);
  });
  it('công tắc bật nhưng chưa cấu hình tài khoản/base URL → false', async () => {
    expect(await isGomdonRecyclingEnabled(cfg({ [GOMDON_RECYCLING_TOGGLE_KEY]: true }), { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(
      await isGomdonRecyclingEnabled(cfg({ [GOMDON_RECYCLING_TOGGLE_KEY]: true }), {
        NODE_ENV: 'development',
        GOMDON_PHONE: 'p',
        GOMDON_PASSWORD: 'x',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe('recyclingWeight (dùng chung Gomdon + Pancake)', () => {
  it('variation thiếu/0 gram → fallback; tối thiểu = fallback', () => {
    const w = recyclingWeight(
      [
        { variationId: 'a', quantity: 2 },
        { variationId: 'b', quantity: 1 },
      ],
      new Map([
        ['a', 1200],
        ['b', 0],
      ]),
      500,
    );
    expect(w.totalGrams).toBe(2900);
    expect(w.maxKg).toBe('2.9');
    expect(recyclingWeight([], new Map(), 500).maxKg).toBe('0.5');
  });
});

describe('gomdon-status', () => {
  it('thứ bậc: không lùi 7 → 3, 10 trước 3, mốc cuối không bị ghi đè', () => {
    expect(gomdonRank('3')).toBeGreaterThan(gomdonRank('1'));
    expect(gomdonRank('3')).toBeGreaterThan(gomdonRank('10'));
    expect(gomdonRank('7')).toBeGreaterThan(gomdonRank('5'));
    expect(gomdonRank('CREATING')).toBe(0);
    expect(isGomdonTerminal('7')).toBe(true);
    expect(isGomdonTerminal('2')).toBe(true);
    expect(isGomdonTerminal('5')).toBe(false);
  });
  it('đã lấy hàng: 3+ (trừ 1, 2, 10); trạng thái nội bộ thì chưa', () => {
    expect(isGomdonPickedUp('3')).toBe(true);
    expect(isGomdonPickedUp('11')).toBe(true);
    expect(isGomdonPickedUp('1')).toBe(false);
    expect(isGomdonPickedUp('10')).toBe(false);
    expect(isGomdonPickedUp('FAILED')).toBe(false);
    expect(isGomdonPickedUp(null)).toBe(false);
  });
  it('thanh toán được: COD hoặc PAID', () => {
    expect(isGomdonPayable({ paymentMethod: 'COD', paymentStatus: 'UNPAID' })).toBe(true);
    expect(isGomdonPayable({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' })).toBe(true);
    expect(isGomdonPayable({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' })).toBe(false);
    expect(isGomdonPayable({ paymentMethod: 'ZALOPAY', paymentStatus: 'UNPAID' })).toBe(false);
  });
});
