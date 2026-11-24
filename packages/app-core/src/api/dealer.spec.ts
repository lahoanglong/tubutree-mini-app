import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { getDealerInvoiceProfile, getDealerTierProgress, placeDealerOrder, requestDealerInvoices, saveDealerInvoiceProfile } from './dealer';

const INVOICE = { taxCode: '0312345678', companyName: 'Công ty A', address: '1 Phố Huế', email: 'ketoan@a.vn' };

describe('dealer — hợp đồng gọi API', () => {
  it('đặt đơn không kèm hoá đơn: thân yêu cầu không có trường invoiceRequest (máy chủ cũ cùng hợp đồng)', async () => {
    const { http, calls } = fakeHttp();
    await placeDealerOrder(http, [{ variationId: 'v1', quantity: 2 }], 'CREDIT', undefined, 'k1');
    expect(calls).toEqual([
      {
        method: 'post',
        path: '/dealer/orders',
        body: { items: [{ variationId: 'v1', quantity: 2 }], paymentMethod: 'CREDIT', note: undefined },
        opts: { headers: { 'Idempotency-Key': 'k1' } },
      },
    ]);
    expect(Object.keys(calls[0]!.body as object)).not.toContain('invoiceRequest');
  });

  it('đặt đơn kèm hoá đơn VAT: gửi invoiceRequest đúng tên trường của máy chủ', async () => {
    const { http, calls } = fakeHttp();
    await placeDealerOrder(http, [{ variationId: 'v1', quantity: 1 }], 'PREPAID', undefined, 'k2', INVOICE);
    expect(calls[0]!.body).toMatchObject({ paymentMethod: 'PREPAID', invoiceRequest: INVOICE });
  });

  it('tiến tới bậc, hồ sơ hoá đơn, gửi yêu cầu hoá đơn nhiều đơn', async () => {
    const { http, calls } = fakeHttp();
    await getDealerTierProgress(http);
    await getDealerInvoiceProfile(http);
    await saveDealerInvoiceProfile(http, INVOICE);
    await requestDealerInvoices(http, ['DL1', 'DL2'], INVOICE, true);
    expect(calls).toEqual([
      { method: 'get', path: '/dealer/tier-progress' },
      { method: 'get', path: '/dealer/invoice-profile' },
      { method: 'put', path: '/dealer/invoice-profile', body: INVOICE },
      { method: 'post', path: '/dealer/orders/invoice-request', body: { orderCodes: ['DL1', 'DL2'], invoice: INVOICE, save: true } },
    ]);
  });
});
