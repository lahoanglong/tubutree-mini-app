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

describe('AffiliateController.touch: nền tảng lấy từ header X-Client-Platform', () => {
  it.each([
    ['web', 'web'],
    ['miniapp', 'miniapp'],
    [undefined, 'miniapp'],
    ['ios', 'miniapp'],
  ])('header %s → recordTouch nhận %s', (header, expected) => {
    const affiliate = { recordTouch: jest.fn() };
    const dto = { referralCode: 'LINH', kind: 'ctv' };
    new AffiliateController(affiliate as never).touch('u', dto, header);
    expect(affiliate.recordTouch).toHaveBeenCalledWith('u', dto, undefined, expected);
  });
});

describe('AffiliateController.commissions / myPayouts: phân trang con trỏ, không tham số thì như cũ', () => {
  it('khai báo query bằng CursorPageQuery để tham số sai bị 400', () => {
    for (const name of ['commissions', 'myPayouts']) {
      expect(Reflect.getMetadata('design:paramtypes', AffiliateController.prototype, name) as unknown[]).toContain(CursorPageQuery);
    }
  });

  it('commissions: không tham số → để service dùng mặc định 100; có take/cursor → chuyển xuống', () => {
    const affiliate = { listCommissions: jest.fn() };
    const c = new AffiliateController(affiliate as never);
    c.commissions('u', {});
    expect(affiliate.listCommissions).toHaveBeenLastCalledWith('u', { take: 100, cursor: undefined });
    c.commissions('u', { take: '50', cursor: 'c1' });
    expect(affiliate.listCommissions).toHaveBeenLastCalledWith('u', { take: 50, cursor: 'c1' });
  });

  it('myPayouts: không tham số → mặc định 50 như cũ; có take/cursor → chuyển xuống', () => {
    const affiliate = { listMyPayouts: jest.fn() };
    const c = new AffiliateController(affiliate as never);
    c.myPayouts('u', {});
    expect(affiliate.listMyPayouts).toHaveBeenLastCalledWith('u', { take: 50, cursor: undefined });
    c.myPayouts('u', { take: '20', cursor: 'p1' });
    expect(affiliate.listMyPayouts).toHaveBeenLastCalledWith('u', { take: 20, cursor: 'p1' });
  });
});
