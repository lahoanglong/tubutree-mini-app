import { evaluateClaimRules, lockedUntil, type ClaimFacts } from './external-claim.rules';

const NOW = new Date('2026-10-20T05:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() - n * 864e5);

const base = (over: Partial<ClaimFacts> = {}): ClaimFacts => ({
  now: NOW,
  cfg: { enabled: true, earnPct: 1, dailyAttempts: 10, dailyMax: 3, monthlyPointsCap: 200_000, maxAgeDays: 60, reviewAboveVnd: 2_000_000, pendingDays: 14, externalSince: null },
  userOk: true,
  userPhoneLast3: '678',
  lockedUntil: null,
  attemptsToday: 0,
  isAppOrder: false,
  order: { source: 'MARKETPLACE', status: 'OPEN', insertedAt: day(3), goodsValue: 200_000, phoneLast3: '678' },
  claim: null,
  claimsToday: 0,
  monthPoints: 0,
  ...over,
});

describe('evaluateClaimRules: thứ tự luật', () => {
  it('đơn hợp lệ: CLAIM PENDING, 1% của 200.000 = 2.000 điểm', () => {
    expect(evaluateClaimRules(base())).toEqual({ kind: 'CLAIM', state: 'PENDING', reviewReason: null, points: 2_000 });
  });
  it('cờ tắt thắng mọi luật khác', () => {
    const f = base({ userOk: false, lockedUntil: day(-1) });
    f.cfg.enabled = false;
    expect(evaluateClaimRules(f)).toEqual({ kind: 'REJECT', code: 'DISABLED' });
  });
  it('user không đủ điều kiện (guest, không SĐT, bị khoá) đứng trước khoá 24h', () => {
    expect(evaluateClaimRules(base({ userOk: false, lockedUntil: day(-1) }))).toEqual({ kind: 'REJECT', code: 'NOT_ELIGIBLE_USER' });
  });
  it('khoá 24h đứng trước giới hạn lần thử/ngày', () => {
    expect(evaluateClaimRules(base({ lockedUntil: day(-1), attemptsToday: 99 }))).toEqual({ kind: 'REJECT', code: 'LOCKED' });
  });
  it('lần thử/ngày đứng trước mã trùng đơn trong app', () => {
    expect(evaluateClaimRules(base({ attemptsToday: 10, isAppOrder: true }))).toEqual({ kind: 'REJECT', code: 'DAILY_ATTEMPTS' });
  });
  it('mã trùng đơn trong app đứng trước tra đơn ngoài (kể cả không có đơn ngoài)', () => {
    expect(evaluateClaimRules(base({ isAppOrder: true, order: null }))).toEqual({ kind: 'REJECT', code: 'APP_ORDER' });
  });
  it('không thấy đơn: UNMATCHED (ghi attempt, cron ghép lại)', () => {
    expect(evaluateClaimRules(base({ order: null }))).toEqual({ kind: 'UNMATCHED' });
  });
  it('đơn CHAT bị từ chối (tự cộng theo SĐT); đơn UNKNOWN vào hàng admin', () => {
    expect(evaluateClaimRules(base({ order: { ...base().order!, source: 'CHAT' } }))).toEqual({ kind: 'REJECT', code: 'CHAT_ORDER' });
    expect(evaluateClaimRules(base({ order: { ...base().order!, source: 'UNKNOWN' } }))).toEqual({ kind: 'UNKNOWN_SOURCE' });
  });
  it('đơn quá cũ, trước mốc external_since, đã huỷ/hoàn', () => {
    expect(evaluateClaimRules(base({ order: { ...base().order!, insertedAt: day(61) } }))).toEqual({ kind: 'REJECT', code: 'TOO_OLD' });
    const f = base();
    f.cfg.externalSince = day(1);
    expect(evaluateClaimRules(f)).toEqual({ kind: 'REJECT', code: 'BEFORE_SINCE' });
    for (const status of ['CANCELLED', 'RETURNED', 'DELETED'] as const) {
      expect(evaluateClaimRules(base({ order: { ...base().order!, status } }))).toEqual({ kind: 'REJECT', code: 'CLOSED' });
    }
  });
  it('external_since null: chỉ áp tuổi đơn tối đa; đúng 60 ngày vẫn được', () => {
    expect(evaluateClaimRules(base({ order: { ...base().order!, insertedAt: day(60) } })).kind).toBe('CLAIM');
  });
  it('tuổi đơn đứng trước "mã đã được tích"; mã đã tích đứng trước trần ngày', () => {
    expect(evaluateClaimRules(base({ order: { ...base().order!, insertedAt: day(90) }, claim: { reopenable: false } }))).toEqual({ kind: 'REJECT', code: 'TOO_OLD' });
    expect(evaluateClaimRules(base({ claim: { reopenable: false }, claimsToday: 3 }))).toEqual({ kind: 'REJECT', code: 'ALREADY_CLAIMED' });
  });
  it('claim đã huỷ và mở lại mã thì nhận được lại', () => {
    expect(evaluateClaimRules(base({ claim: { reopenable: true } })).kind).toBe('CLAIM');
  });
  it('trần ngày (3 claim) đứng trước trần tháng', () => {
    expect(evaluateClaimRules(base({ claimsToday: 3, monthPoints: 999_999 }))).toEqual({ kind: 'REJECT', code: 'DAILY_MAX' });
  });
  it('trần tháng tính cả điểm của claim này: 199.000 + 2.000 > 200.000 bị từ chối, 198.000 + 2.000 vừa đủ', () => {
    expect(evaluateClaimRules(base({ monthPoints: 199_000 }))).toEqual({ kind: 'REJECT', code: 'MONTHLY_CAP' });
    expect(evaluateClaimRules(base({ monthPoints: 198_000 })).kind).toBe('CLAIM');
  });
  it('REVIEW: thiếu tiền hàng (points 0 không áp luật tháng), vượt ngưỡng, hoặc 3 số cuối SĐT khác', () => {
    expect(evaluateClaimRules(base({ order: { ...base().order!, goodsValue: null } }))).toMatchObject({ kind: 'CLAIM', state: 'REVIEW', points: 0 });
    expect(evaluateClaimRules(base({ order: { ...base().order!, goodsValue: 2_000_001 } }))).toMatchObject({ kind: 'CLAIM', state: 'REVIEW', points: 20_000 });
    expect(evaluateClaimRules(base({ order: { ...base().order!, goodsValue: 2_000_000 } }))).toMatchObject({ state: 'PENDING' });
    expect(evaluateClaimRules(base({ userPhoneLast3: '111' }))).toMatchObject({ state: 'REVIEW' });
    expect(evaluateClaimRules(base({ order: { ...base().order!, phoneLast3: null }, userPhoneLast3: '111' }))).toMatchObject({ state: 'PENDING' });
  });
  it('giá trị đơn quá nhỏ (dưới 100đ ở 1%) bị từ chối vì 0 điểm', () => {
    expect(evaluateClaimRules(base({ order: { ...base().order!, goodsValue: 99 } }))).toEqual({ kind: 'REJECT', code: 'ZERO_POINTS' });
  });
});

describe('lockedUntil: 5 lần không tìm thấy trong 24h thì khoá 24h kể từ lần thứ 5', () => {
  const t = (h: number) => new Date(NOW.getTime() - h * 36e5);
  it('4 lần: không khoá', () => {
    expect(lockedUntil([t(1), t(2), t(3), t(4)], NOW)).toBeNull();
  });
  it('5 lần trong 24h: khoá tới lần mới nhất + 24h', () => {
    expect(lockedUntil([t(1), t(2), t(3), t(4), t(5)], NOW)?.toISOString()).toBe(new Date(t(1).getTime() + 864e5).toISOString());
  });
  it('5 lần nhưng lần mới nhất đã quá 24h: hết khoá', () => {
    expect(lockedUntil([t(25), t(26), t(27), t(28), t(29)], NOW)).toBeNull();
  });
  it('5 lần rải hơn 24h (lần mới nhất chỉ có 4 lần trong cửa sổ 24h): không khoá', () => {
    expect(lockedUntil([t(1), t(10), t(20), t(23.5), t(30)], NOW)).toBeNull();
  });
  it('danh sách rỗng', () => {
    expect(lockedUntil([], NOW)).toBeNull();
  });
});
