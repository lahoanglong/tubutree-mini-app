import { ValidationPipe } from '@nestjs/common';
import { FEED_POST_KINDS, FeedQuery } from './feed-query.dto';

// Cùng cấu hình ValidationPipe với main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const as = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'query', metatype: FeedQuery, data: undefined });

describe('GET /feed: validate query theo enum thật', () => {
  it('kind trùng enum FeedPostKind trong schema.prisma thì nhận', async () => {
    for (const kind of FEED_POST_KINDS) {
      await expect(as({ kind })).resolves.toMatchObject({ kind });
    }
  });

  it('kind ngoài enum → 400 thay vì để Prisma ném validation error (500)', async () => {
    await expect(as({ kind: 'XYZ' })).rejects.toThrow();
    await expect(as({ kind: 'manual' })).rejects.toThrow();
  });

  it('?kind=A&kind=B (mảng) bị từ chối', async () => {
    await expect(as({ kind: ['MANUAL', 'QUESTION'] })).rejects.toThrow();
  });

  it('tham số chuỗi lặp (mảng) không lọt xuống where của Prisma', async () => {
    for (const key of ['category', 'tag', 'q', 'cursor']) {
      await expect(as({ [key]: ['a', 'b'] })).rejects.toThrow();
    }
  });

  it('mọi query client đang gửi đều được khai báo (forbidNonWhitelisted)', async () => {
    const q = { category: 'khoe-vuon', kind: 'QUESTION', sort: 'popular', cursor: 'c1', q: 'lá', unanswered: 'true', tag: 'da-nhay-cam' };
    await expect(as(q)).resolves.toMatchObject(q);
    await expect(as({ unanswered: '1', sort: 'new' })).resolves.toMatchObject({ unanswered: '1', sort: 'new' });
    await expect(as({})).resolves.toEqual({});
  });

  it('sort lạ vẫn nhận: service đã rơi về mặc định, không lỗi', async () => {
    await expect(as({ sort: 'zzz' })).resolves.toMatchObject({ sort: 'zzz' });
  });

  it('query lạ ngoài danh sách vẫn bị 400', async () => {
    await expect(as({ foo: 'x' })).rejects.toThrow();
  });

  it('q, tag, category, cursor quá dài → 400; đúng trần vẫn nhận', async () => {
    for (const [key, max] of [['q', 100], ['tag', 100], ['category', 100], ['cursor', 200]] as const) {
      await expect(as({ [key]: 'a'.repeat(max) })).resolves.toMatchObject({ [key]: 'a'.repeat(max) });
      await expect(as({ [key]: 'a'.repeat(max + 1) })).rejects.toThrow();
    }
  });
});
