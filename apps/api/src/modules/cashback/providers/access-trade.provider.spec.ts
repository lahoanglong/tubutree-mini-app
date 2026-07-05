import { ConfigService } from '@nestjs/config';
import { AccessTradeProvider } from './access-trade.provider';

const makeProvider = (over: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    ACCESSTRADE_BASE_URL: 'https://api.accesstrade.vn/v1',
    ACCESSTRADE_TOKEN: '',
    ACCESSTRADE_WEBHOOK_SECRET: '',
    ...over,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<never, true>;
  return new AccessTradeProvider(config);
};

const post = (over: Record<string, unknown> = {}) => ({
  utm_content: 'click-1',
  order_id: 'AT-ORDER-1',
  amount: 500000,
  commission: 50000,
  status: 'approved',
  ...over,
});

describe('AccessTradeProvider.parseWebhook', () => {
  it('approved → CONFIRMED, map đủ field', () => {
    const e = makeProvider().parseWebhook(post())!;
    expect(e).toMatchObject({
      clickRef: 'click-1',
      merchantOrderId: 'AT-ORDER-1',
      orderAmount: 500000,
      commission: 50000,
      status: 'CONFIRMED',
    });
  });

  it('pending → PENDING; rejected → REJECTED', () => {
    expect(makeProvider().parseWebhook(post({ status: 'pending' }))!.status).toBe('PENDING');
    expect(makeProvider().parseWebhook(post({ status: 'rejected' }))!.status).toBe('REJECTED');
  });

  it('commission âm → null (chống cộng số dư âm)', () => {
    expect(makeProvider().parseWebhook(post({ commission: -1 }))).toBeNull();
  });

  it('thiếu field / sai kiểu → null', () => {
    expect(makeProvider().parseWebhook(post({ order_id: undefined }))).toBeNull();
    expect(makeProvider().parseWebhook(post({ amount: 'x' }))).toBeNull();
    expect(makeProvider().parseWebhook(null)).toBeNull();
  });
});

describe('AccessTradeProvider.verifyWebhook', () => {
  it('secret cấu hình + token đúng → true', () => {
    const p = makeProvider({ ACCESSTRADE_WEBHOOK_SECRET: 'secret-abc' });
    expect(p.verifyWebhook({ 'x-accesstrade-token': 'secret-abc' }, {})).toBe(true);
  });

  it('secret cấu hình + token sai/thiếu → false', () => {
    const p = makeProvider({ ACCESSTRADE_WEBHOOK_SECRET: 'secret-abc' });
    expect(p.verifyWebhook({ 'x-accesstrade-token': 'sai' }, {})).toBe(false);
    expect(p.verifyWebhook({}, {})).toBe(false);
  });

  it('chưa cấu hình secret + KHÔNG phải production → true (dev bỏ qua)', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    expect(makeProvider().verifyWebhook({}, {})).toBe(true);
    process.env.NODE_ENV = prev;
  });

  it('chưa cấu hình secret + production → false (fail-closed)', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(makeProvider().verifyWebhook({}, {})).toBe(false);
    process.env.NODE_ENV = prev;
  });
});

describe('AccessTradeProvider.buildDeeplink / isReconcileEnabled', () => {
  it('buildDeeplink thay {{clickId}} + append productUrl đã encode', () => {
    const url = makeProvider().buildDeeplink('https://x.vn/dl?utm_content={{clickId}}', 'abc', 'https://shopee.vn/p?id=1');
    expect(url).toBe('https://x.vn/dl?utm_content=abc&url=https%3A%2F%2Fshopee.vn%2Fp%3Fid%3D1');
  });

  it('isReconcileEnabled theo ACCESSTRADE_TOKEN', () => {
    expect(makeProvider().isReconcileEnabled()).toBe(false);
    expect(makeProvider({ ACCESSTRADE_TOKEN: 'tok' }).isReconcileEnabled()).toBe(true);
  });

  it('fetchTransactions khi chưa có token → [] (không gọi API)', async () => {
    expect(await makeProvider().fetchTransactions(new Date(0))).toEqual([]);
  });
});
