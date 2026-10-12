import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { SubscriptionsController } from './subscriptions.controller';

describe('SubscriptionsController.list: phân trang qua CursorPageQuery', () => {
  it('khai báo query bằng CursorPageQuery để cursor mảng/object bị 400 thay vì 500', () => {
    const types = Reflect.getMetadata('design:paramtypes', SubscriptionsController.prototype, 'list') as unknown[];
    expect(types).toContain(CursorPageQuery);
  });

  it('take kẹp bằng clampTake, cursor chuyển nguyên cho service', () => {
    const subs = { list: jest.fn() };
    const c = new SubscriptionsController(subs as never);
    c.list('u', { take: '20', cursor: 'c1' });
    expect(subs.list).toHaveBeenCalledWith('u', { take: 20, cursor: 'c1' });
    c.list('u', {});
    expect(subs.list).toHaveBeenLastCalledWith('u', { take: 100, cursor: undefined });
  });
});
