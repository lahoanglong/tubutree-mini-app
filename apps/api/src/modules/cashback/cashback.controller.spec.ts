import { NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CashbackController, ClickDto } from './cashback.controller';
import type { CashbackService } from './cashback.service';
import type { CashbackProviderRegistry } from './providers/cashback-provider.registry';
import type { CashbackProvider, NormalizedCashbackEvent } from './providers/cashback-provider.interface';

const body = { utm_content: 'click-1', order_id: 'O1', amount: 500000, commission: 50000, status: 'approved' };
const normalized: NormalizedCashbackEvent = {
  clickRef: 'click-1', merchantOrderId: 'O1', orderAmount: 500000, commission: 50000, status: 'CONFIRMED', raw: body,
};

function make(providerOver: Partial<CashbackProvider> = {}, known = true) {
  const ingest = jest.fn().mockResolvedValue({ ok: true });
  const cashback = { ingest } as unknown as CashbackService;
  const provider: CashbackProvider = {
    key: 'accesstrade',
    buildDeeplink: () => '',
    verifyWebhook: jest.fn().mockReturnValue(true),
    parseWebhook: jest.fn().mockReturnValue(normalized),
    isReconcileEnabled: () => false,
    fetchTransactions: async () => [],
    ...providerOver,
  };
  const registry = {
    get: jest.fn().mockImplementation((k: string) => {
      if (!known) throw new NotFoundException(k);
      return provider;
    }),
  } as unknown as CashbackProviderRegistry;
  return { ctrl: new CashbackController(cashback, registry), ingest, provider };
}

describe('CashbackController.webhook', () => {
  it('verify pass + parse ok → gọi ingest với providerKey', async () => {
    const { ctrl, ingest } = make();
    const r = await ctrl.webhook('accesstrade', body, { 'x-accesstrade-token': 'ok' });
    expect(r).toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledWith(normalized, 'accesstrade');
  });

  it('verify fail → 401, không ingest', async () => {
    const { ctrl, ingest } = make({ verifyWebhook: jest.fn().mockReturnValue(false) });
    await expect(ctrl.webhook('accesstrade', body, {})).rejects.toThrow(UnauthorizedException);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('parseWebhook null (sai shape) → ok:false, không ingest', async () => {
    const { ctrl, ingest } = make({ parseWebhook: jest.fn().mockReturnValue(null) });
    const r = await ctrl.webhook('accesstrade', {}, { 'x-accesstrade-token': 'ok' });
    expect(r).toEqual({ ok: false });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('m4: ingest báo thua CAS (retry) → 503 để sàn gửi lại', async () => {
    const { ctrl, ingest } = make();
    ingest.mockResolvedValueOnce({ ok: false, retry: true });
    await expect(ctrl.webhook('accesstrade', body, { 'x-accesstrade-token': 'ok' })).rejects.toThrow(ServiceUnavailableException);
  });

  it('provider lạ → NotFoundException', async () => {
    const { ctrl } = make({}, false);
    await expect(ctrl.webhook('khong-ton-tai', body, {})).rejects.toThrow(NotFoundException);
  });

  it('alias /webhooks/accesstrade → xử lý như provider accesstrade', async () => {
    const { ctrl, ingest } = make();
    const r = await ctrl.accesstradeWebhook(body, { 'x-accesstrade-token': 'ok' });
    expect(r).toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledWith(normalized, 'accesstrade');
  });
});

describe('ClickDto — SEC-V2', () => {
  async function keys(plain: Record<string, unknown>) {
    const errs = await validate(plainToInstance(ClickDto, plain), { whitelist: true });
    return errs.flatMap((e) => Object.keys(e.constraints ?? {}));
  }
  it('https hợp lệ → không lỗi; bỏ trống productUrl → không lỗi', async () => {
    expect(await keys({ merchantId: 'm1', productUrl: 'https://shopee.vn/p/1' })).toEqual([]);
    expect(await keys({ merchantId: 'm1' })).toEqual([]);
  });
  it.each([['http://shopee.vn/p'], ['javascript:alert(1)'], ['shopee.vn/p'], ['not a url'], [`https://shopee.vn/${'a'.repeat(2100)}`]])(
    'productUrl %s → lỗi',
    async (u) => {
      expect((await keys({ merchantId: 'm1', productUrl: u })).length).toBeGreaterThan(0);
    },
  );
});
