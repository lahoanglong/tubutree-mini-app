import { CLAIM_CONFIG_DEFAULTS, loadClaimConfig } from './external-claim.config';

const cfg = (values: Record<string, unknown>) => ({ get: jest.fn((k: string, d: unknown) => Promise.resolve(k in values ? values[k] : d)) });

describe('loadClaimConfig', () => {
  it('mặc định: cờ tắt, 1%, ngày 3, tháng 200.000, tuổi đơn 60, external_since null', async () => {
    const c = await loadClaimConfig(cfg({}) as never);
    expect(c).toEqual({
      enabled: false,
      earnPct: 1,
      dailyAttempts: 10,
      dailyMax: 3,
      monthlyPointsCap: 200_000,
      maxAgeDays: 60,
      reviewAboveVnd: 2_000_000,
      pendingDays: 14,
      externalSince: null,
    });
    expect(CLAIM_CONFIG_DEFAULTS.enabled).toBe(false);
  });
  it('cờ chỉ bật khi đúng boolean true (chuỗi "true" không đủ)', async () => {
    expect((await loadClaimConfig(cfg({ 'loyalty.marketplace_claim_enabled': 'true' }) as never)).enabled).toBe(false);
    expect((await loadClaimConfig(cfg({ 'loyalty.marketplace_claim_enabled': true }) as never)).enabled).toBe(true);
  });
  it('giá trị hỏng rơi về mặc định, không bao giờ ném', async () => {
    const c = await loadClaimConfig(
      cfg({ 'loyalty.marketplace_earn_pct': 'x', 'loyalty.marketplace_claim_daily_max': -1, 'loyalty.external_pending_days': 1.5, 'loyalty.marketplace_claim_monthly_points_cap': null }) as never,
    );
    expect(c).toMatchObject({ earnPct: 1, dailyMax: 3, pendingDays: 14, monthlyPointsCap: 200_000 });
  });
  it('earnPct 0,5 được giữ; ngày rộng hơn trần thì kẹp về trần', async () => {
    const c = await loadClaimConfig(cfg({ 'loyalty.marketplace_earn_pct': 0.5, 'loyalty.marketplace_claim_max_age_days': 99999 }) as never);
    expect(c.earnPct).toBe(0.5);
    expect(c.maxAgeDays).toBe(365);
  });
  it('external_since YYYY-MM-DD là 00:00 giờ Việt Nam (17:00 UTC hôm trước); rác thì null', async () => {
    expect((await loadClaimConfig(cfg({ 'loyalty.external_since': '2026-10-01' }) as never)).externalSince?.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect((await loadClaimConfig(cfg({ 'loyalty.external_since': 'abc' }) as never)).externalSince).toBeNull();
    expect((await loadClaimConfig(cfg({ 'loyalty.external_since': '' }) as never)).externalSince).toBeNull();
  });
});
