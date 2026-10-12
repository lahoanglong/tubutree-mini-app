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
