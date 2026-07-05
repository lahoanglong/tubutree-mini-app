import { NotFoundException } from '@nestjs/common';
import { CashbackProviderRegistry } from './cashback-provider.registry';
import type { CashbackProvider } from './cashback-provider.interface';

const stub = (key: string): CashbackProvider => ({
  key,
  buildDeeplink: () => '',
  verifyWebhook: () => true,
  parseWebhook: () => null,
  isReconcileEnabled: () => false,
  fetchTransactions: async () => [],
});

describe('CashbackProviderRegistry', () => {
  it('get() trả provider theo key', () => {
    const r = new CashbackProviderRegistry([stub('accesstrade')]);
    expect(r.get('accesstrade').key).toBe('accesstrade');
  });

  it('get() key lạ → NotFoundException', () => {
    const r = new CashbackProviderRegistry([stub('accesstrade')]);
    expect(() => r.get('involve')).toThrow(NotFoundException);
  });

  it('all() trả mọi provider đã đăng ký', () => {
    const r = new CashbackProviderRegistry([stub('a'), stub('b')]);
    expect(r.all().map((p) => p.key).sort()).toEqual(['a', 'b']);
  });
});
