import { feedImageRef, feedImageVersion, loadFeedImages, matchesFeedImageVersion, MAX_FEED_IMAGES } from './feed-images';

const hash = (n: number) => String(n).padStart(32, 'a');

function makeDb(rows: unknown[]) {
  const $queryRaw = jest.fn().mockResolvedValue(rows);
  return { db: { $queryRaw } as never, $queryRaw };
}

describe('feedImageVersion / feedImageRef', () => {
  it('mã md5 gắn id bài + chỉ số + nội dung: đổi một trong ba là mã đổi', () => {
    const base = feedImageVersion('p1', 0, 'data:image/png;base64,AAAA');
    expect(base).toMatch(/^[0-9a-f]{32}$/);
    expect(feedImageVersion('p1', 0, 'data:image/png;base64,AAAA')).toBe(base);
    expect(feedImageVersion('p2', 0, 'data:image/png;base64,AAAA')).not.toBe(base);
    expect(feedImageVersion('p1', 1, 'data:image/png;base64,AAAA')).not.toBe(base);
    expect(feedImageVersion('p1', 0, 'data:image/png;base64,AAAB')).not.toBe(base);
  });

  it('đường dẫn tương đối tới API kèm mã phiên bản', () => {
    expect(feedImageRef('p1', 2, hash(1))).toBe(`/feed/posts/p1/images/2?v=${hash(1)}`);
  });

  it('matchesFeedImageVersion chỉ nhận đúng mã của ảnh đó', () => {
    const img = 'data:image/png;base64,AAAA';
    const v = feedImageVersion('p1', 0, img);
    expect(matchesFeedImageVersion(v, 'p1', 0, img)).toBe(true);
    expect(matchesFeedImageVersion(v, 'p1', 1, img)).toBe(false);
    expect(matchesFeedImageVersion(v, 'p2', 0, img)).toBe(false);
    expect(matchesFeedImageVersion(`${v}0`, 'p1', 0, img)).toBe(false);
    expect(matchesFeedImageVersion(undefined, 'p1', 0, img)).toBe(false);
    expect(matchesFeedImageVersion(['x'], 'p1', 0, img)).toBe(false);
  });

  it('trần ảnh mỗi bài khớp CreatePostDto (6)', () => {
    expect(MAX_FEED_IMAGES).toBe(6);
  });
});

describe('loadFeedImages', () => {
  it('không có bài nào → không chạm DB', async () => {
    const { db, $queryRaw } = makeDb([]);
    const r = await loadFeedImages(db, [], true);
    expect(r.size).toBe(0);
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('ảnh https giữ nguyên, ảnh base64 thành đường dẫn kèm mã, theo đúng thứ tự chỉ số', async () => {
    const { db } = makeDb([
      { postId: 'p1', count: 3, idx: 0, url: null, hash: hash(1) },
      { postId: 'p1', count: 3, idx: 1, url: 'https://res.cloudinary.com/x/y.jpg', hash: null },
      { postId: 'p1', count: 3, idx: 2, url: null, hash: hash(2) },
    ]);
    const r = await loadFeedImages(db, ['p1'], false);
    expect(r.get('p1')).toEqual({
      count: 3,
      images: [`/feed/posts/p1/images/0?v=${hash(1)}`, 'https://res.cloudinary.com/x/y.jpg', `/feed/posts/p1/images/2?v=${hash(2)}`],
    });
  });

  it('bài không có dòng ảnh nào không xuất hiện trong kết quả (người gọi mặc định 0 ảnh)', async () => {
    const { db } = makeDb([{ postId: 'p1', count: 1, idx: 0, url: 'https://res.cloudinary.com/a.jpg', hash: null }]);
    const r = await loadFeedImages(db, ['p1', 'p2'], true);
    expect(r.has('p2')).toBe(false);
  });

  it('chuỗi lạ (không https/http, không data:) bị bỏ khỏi danh sách nhưng vẫn tính vào số ảnh', async () => {
    const { db } = makeDb([
      { postId: 'p1', count: 2, idx: 0, url: null, hash: null },
      { postId: 'p1', count: 2, idx: 1, url: 'http://img/ok.jpg', hash: null },
    ]);
    const r = await loadFeedImages(db, ['p1'], false);
    expect(r.get('p1')).toEqual({ count: 2, images: ['http://img/ok.jpg'] });
  });

  it('một lượt truy vấn cho cả trang, và chế độ chỉ-bìa giới hạn phần tử thứ nhất ngay trong SQL', async () => {
    const { db, $queryRaw } = makeDb([]);
    await loadFeedImages(db, ['p1', 'p2', 'p3'], true);
    expect($queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = $queryRaw.mock.calls[0] as [string[], ...unknown[]];
    const sql = strings.join('?');
    expect(sql).toContain('unnest');
    expect(sql).toContain('WITH ORDINALITY');
    expect(JSON.stringify(values)).toContain('"p2"');
    expect(values).toContain(1);

    $queryRaw.mockClear();
    await loadFeedImages(db, ['p1'], false);
    const [, ...allValues] = $queryRaw.mock.calls[0] as [string[], ...unknown[]];
    expect(allValues).toContain(MAX_FEED_IMAGES);
  });
});
