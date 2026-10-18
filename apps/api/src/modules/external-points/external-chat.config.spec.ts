import { loadChatConfig, loadStaffMap, staffMapProblem } from './external-chat.config';

function cfg(values: Record<string, unknown>) {
  return { get: async (key: string, fallback?: unknown) => (key in values ? values[key] : fallback) } as never;
}

describe('loadChatConfig', () => {
  it('mặc định: tắt, trần 200000, ngưỡng 5tr, cần vận đơn, giữ 30 ngày', async () => {
    const c = await loadChatConfig(cfg({}));
    expect(c).toMatchObject({ enabled: false, monthlyPointsCap: 200_000, reviewAboveVnd: 5_000_000, requireCarrier: true, holdDays: 30 });
  });

  it('earn_pct chat null thì dùng loyalty.earn_pct; có giá trị hợp lệ thì ưu tiên', async () => {
    expect((await loadChatConfig(cfg({ 'loyalty.earn_pct': 3 }))).earnPct).toBe(3);
    expect((await loadChatConfig(cfg({ 'loyalty.earn_pct': 3, 'loyalty.chat_order_earn_pct': 1.5 }))).earnPct).toBe(1.5);
    expect((await loadChatConfig(cfg({ 'loyalty.earn_pct': 3, 'loyalty.chat_order_earn_pct': -1 }))).earnPct).toBe(3);
  });

  it('cờ chỉ bật với boolean true; chuỗi "true" không bật', async () => {
    expect((await loadChatConfig(cfg({ 'loyalty.chat_order_points_enabled': true }))).enabled).toBe(true);
    expect((await loadChatConfig(cfg({ 'loyalty.chat_order_points_enabled': 'true' }))).enabled).toBe(false);
    expect((await loadChatConfig(cfg({ 'loyalty.chat_order_points_enabled': 1 }))).enabled).toBe(false);
  });

  it('require_carrier chỉ tắt với boolean false', async () => {
    expect((await loadChatConfig(cfg({ 'loyalty.chat_order_require_carrier': false }))).requireCarrier).toBe(false);
    expect((await loadChatConfig(cfg({ 'loyalty.chat_order_require_carrier': 'no' }))).requireCarrier).toBe(true);
  });

  it('giá trị số hỏng rơi về mặc định', async () => {
    const c = await loadChatConfig(
      cfg({ 'loyalty.chat_order_monthly_points_cap': 'x', 'loyalty.chat_unclaimed_hold_days': 1.5, 'loyalty.chat_order_review_above_vnd': null }),
    );
    expect(c).toMatchObject({ monthlyPointsCap: 200_000, holdDays: 30, reviewAboveVnd: 5_000_000 });
  });
});

describe('loadChatConfig: khoá thêm sau review lượt 1', () => {
  it('mặc định: xác minh SĐT 180 ngày, trần người tạo đơn 1.000.000', async () => {
    expect(await loadChatConfig(cfg({}))).toMatchObject({ phoneVerifiedMaxDays: 180, creatorMonthlyPoints: 1_000_000 });
  });
  it('giá trị đặt được dùng; giá trị hỏng rơi về mặc định', async () => {
    expect(await loadChatConfig(cfg({ 'loyalty.chat_phone_verified_max_days': 30, 'loyalty.chat_order_creator_monthly_points': 50_000 }))).toMatchObject({ phoneVerifiedMaxDays: 30, creatorMonthlyPoints: 50_000 });
    expect(await loadChatConfig(cfg({ 'loyalty.chat_phone_verified_max_days': 'x', 'loyalty.chat_order_creator_monthly_points': 0 }))).toMatchObject({ phoneVerifiedMaxDays: 180, creatorMonthlyPoints: 1_000_000 });
  });
});

describe('pancake.staff_map', () => {
  it('đọc lỏng: bỏ mục hỏng, không ném', async () => {
    const m = await loadStaffMap(cfg({ 'pancake.staff_map': { a: 'u1', b: 2, c: ' ', '': 'u9' } }));
    expect([...m]).toEqual([['a', 'u1']]);
    expect((await loadStaffMap(cfg({ 'pancake.staff_map': [1] }))).size).toBe(0);
    expect((await loadStaffMap(cfg({}))).size).toBe(0);
  });
  it('validator: object { id: userId }, từ chối mảng và giá trị không phải chuỗi', () => {
    expect(staffMapProblem({})).toBeNull();
    expect(staffMapProblem({ a: 'u1' })).toBeNull();
    expect(staffMapProblem([])).not.toBeNull();
    expect(staffMapProblem(null)).not.toBeNull();
    expect(staffMapProblem({ a: 5 })).not.toBeNull();
    expect(staffMapProblem({ a: '' })).not.toBeNull();
  });
});
