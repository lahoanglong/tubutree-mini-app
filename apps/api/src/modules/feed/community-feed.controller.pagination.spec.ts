import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { CommunityFeedController } from './community-feed.controller';

// ValidationPipe toàn cục chỉ kiểm query khi tham số controller khai báo DTO; nếu ai đó đổi lại
// thành @Query('take') chuỗi trần thì take=abc lại thành NaN vào Prisma (500).
describe('CommunityFeedController: phân trang qua CursorPageQuery', () => {
  it.each(['eventPosts', 'comments'])('%s nhận query bằng CursorPageQuery', (method) => {
    const types = Reflect.getMetadata('design:paramtypes', CommunityFeedController.prototype, method) as unknown[];
    expect(types).toContain(CursorPageQuery);
  });

  it('eventPosts/comments đổi take chuỗi sang số, cursor giữ nguyên', () => {
    const feed = { eventPosts: jest.fn(), getComments: jest.fn() };
    const c = new CommunityFeedController(feed as never);
    c.eventPosts('u', 'e1', { take: '7', cursor: 'c1' });
    expect(feed.eventPosts).toHaveBeenCalledWith('e1', 'u', 7, 'c1');
    c.comments('u', 'p1', {});
    expect(feed.getComments).toHaveBeenCalledWith('p1', 'u', undefined, undefined);
  });
});
