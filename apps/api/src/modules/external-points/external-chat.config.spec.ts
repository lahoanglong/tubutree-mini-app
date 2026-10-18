import { loadChatConfig } from './external-chat.config';

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
