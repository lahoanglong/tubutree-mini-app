import { BadRequestException } from '@nestjs/common';
import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { AffiliateController } from './affiliate.controller';

describe('AffiliateController.links: phân trang qua CursorPageQuery', () => {
  it('khai báo query bằng CursorPageQuery để cursor mảng/object bị 400 thay vì 500', () => {
    const types = Reflect.getMetadata('design:paramtypes', AffiliateController.prototype, 'links') as unknown[];
    expect(types).toContain(CursorPageQuery);
  });

  it('take kẹp bằng clampTake, cursor chuyển nguyên cho service', () => {
    const affiliate = { listLinks: jest.fn() };
    const c = new AffiliateController(affiliate as never);
    c.links('u', { take: '20', cursor: 'c1' });
    expect(affiliate.listLinks).toHaveBeenCalledWith('u', { take: 20, cursor: 'c1' });
    c.links('u', {});
    expect(affiliate.listLinks).toHaveBeenLastCalledWith('u', { take: 100, cursor: undefined });
  });
});

describe('AffiliateController.payout: hoa hồng chỉ chuyển vào Ví Tubu (chính sách Zalo 4.5)', () => {
  const bank = { bankName: 'VCB', accountNumber: '0071000123456', accountName: 'NGUYEN VAN A' };

  it.each(['BANK', 'ZALOPAY'])('method %s → 400 câu tiếng Việt, service không bị gọi', (method) => {
    const affiliate = { requestPayout: jest.fn() };
    const c = new AffiliateController(affiliate as never);
    let err: unknown;
    try {
      c.payout('u', { amount: 500_000, method, bankInfo: bank }, 'k1');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe('Hoa hồng chỉ chuyển vào Ví Tubu để mua hàng.');
    expect(affiliate.requestPayout).not.toHaveBeenCalled();
  });

  it('WALLET_BALANCE → chuyển nguyên cho service như cũ', () => {
    const affiliate = { requestPayout: jest.fn() };
    new AffiliateController(affiliate as never).payout('u', { amount: 500_000, method: 'WALLET_BALANCE', taxId: '0123456789' }, 'k1');
    expect(affiliate.requestPayout).toHaveBeenCalledWith('u', 500_000, 'WALLET_BALANCE', undefined, 'k1', '0123456789');
  });
});
