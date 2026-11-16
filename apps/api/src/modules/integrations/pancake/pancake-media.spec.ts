import { mergePancakeImages, pancakeImageList, pancakeVideos, PANCAKE_VIDEOS_MAX } from './pancake-media';

describe('pancakeVideos (W181)', () => {
  it('nhận chuỗi URL và object có url, bỏ trùng, giữ thứ tự theo biến thể', () => {
    const r = pancakeVideos([
      { videos: ['https://cdn.pancake.vn/a.mp4', { url: 'https://cdn.pancake.vn/b.mp4' }] },
      { videos: [{ url: 'https://cdn.pancake.vn/a.mp4' }, 'http://cdn.pancake.vn/c.mp4'] },
    ]);
    expect(r).toEqual({ videos: ['https://cdn.pancake.vn/a.mp4', 'https://cdn.pancake.vn/b.mp4', 'http://cdn.pancake.vn/c.mp4'], reported: true });
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:video/mp4;base64,AAAA'],
    ['đường dẫn tương đối', '/videos/a.mp4'],
    ['ftp', 'ftp://cdn.pancake.vn/a.mp4'],
    ['kèm user:pass', 'https://user:pw@cdn.pancake.vn/a.mp4'],
    ['không phải URL', 'không phải url'],
    ['rỗng', '   '],
    ['quá dài', `https://cdn.pancake.vn/${'a'.repeat(2100)}.mp4`],
  ])('bỏ URL không hợp lệ: %s', (_label, bad) => {
    expect(pancakeVideos([{ videos: [bad, 'https://cdn.pancake.vn/ok.mp4'] }]).videos).toEqual(['https://cdn.pancake.vn/ok.mp4']);
  });

  it('bỏ phần tử sai kiểu (số, null, object không có url, url không phải chuỗi)', () => {
    expect(pancakeVideos([{ videos: [1, null, {}, { url: 5 }, { link: 'https://x/a.mp4' }, ['https://x/b.mp4']] }]).videos).toEqual([]);
  });

  it('`reported`: có trường videos (kể cả mảng rỗng) là Pancake có nói; không biến thể nào có trường thì không', () => {
    expect(pancakeVideos([{ videos: [] }])).toEqual({ videos: [], reported: true });
    expect(pancakeVideos([{}, { videos: null }])).toEqual({ videos: [], reported: false });
    expect(pancakeVideos([])).toEqual({ videos: [], reported: false });
  });

  it('một chuỗi đơn lẻ thành một video; object (không phải mảng) bị bỏ', () => {
    expect(pancakeVideos([{ videos: 'https://cdn.pancake.vn/one.mp4' }]).videos).toEqual(['https://cdn.pancake.vn/one.mp4']);
    expect(pancakeVideos([{ videos: { url: 'https://cdn.pancake.vn/x.mp4' } }]).reported).toBe(false);
  });

  it(`tối đa ${PANCAKE_VIDEOS_MAX} video`, () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://cdn.pancake.vn/${i}.mp4`);
    expect(pancakeVideos([{ videos: many }]).videos).toHaveLength(PANCAKE_VIDEOS_MAX);
  });
});

describe('pancakeImageList (W181)', () => {
  it('ảnh sản phẩm, ảnh đại diện, rồi ảnh từng biến thể; bỏ trùng', () => {
    expect(pancakeImageList({ images: ['https://i/a.jpg'], image: 'https://i/b.jpg' }, [{ images: ['https://i/a.jpg', 'https://i/c.jpg'] }, { images: ['https://i/d.jpg'] }])).toEqual([
      'https://i/a.jpg',
      'https://i/b.jpg',
      'https://i/c.jpg',
      'https://i/d.jpg',
    ]);
  });

  it('chỉ ảnh ở biến thể (đúng dạng Pancake PROD: cấp sản phẩm chỉ có `image`)', () => {
    expect(pancakeImageList({ image: null }, [{ images: ['https://i/v1.jpg'] }, { images: [] }])).toEqual(['https://i/v1.jpg']);
  });
});

describe('mergePancakeImages (W181)', () => {
  const A = 'https://i/a.jpg';
  const B = 'https://i/b.jpg';
  const C = 'https://i/c.jpg';
  const ADMIN = 'data:image/png;base64,QUJD';
  const ADMIN2 = 'https://res.cloudinary.com/x/admin.jpg';

  it('lần đầu (chưa có ảnh): đúng ảnh Pancake', () => {
    expect(mergePancakeImages([A, B], [], [])).toEqual({ images: [A, B], adminKept: 0 });
  });

  it('ảnh admin thêm (không có ở Pancake, chưa từng là ảnh Pancake) được giữ, đứng sau ảnh Pancake', () => {
    expect(mergePancakeImages([A, B], [A], [ADMIN, A, ADMIN2])).toEqual({ images: [A, B, ADMIN, ADMIN2], adminKept: 2 });
  });

  it('thứ tự ảnh Pancake theo Pancake, kể cả khi admin đã xếp ảnh của mình lên đầu', () => {
    expect(mergePancakeImages([B, A], [A, B], [ADMIN, A, B]).images).toEqual([B, A, ADMIN]);
  });

  it('ảnh Pancake đã bị xoá trên Pancake thì gỡ; ảnh admin còn', () => {
    expect(mergePancakeImages([A], [A, B], [A, B, ADMIN])).toEqual({ images: [A, ADMIN], adminKept: 1 });
  });

  it('Pancake xoá hết ảnh: chỉ còn ảnh admin', () => {
    expect(mergePancakeImages([], [A, B], [A, B, ADMIN])).toEqual({ images: [ADMIN], adminKept: 1 });
    expect(mergePancakeImages([], [A], [A])).toEqual({ images: [], adminKept: 0 });
  });

  it('ảnh Pancake thêm mới không bị đếm là ảnh admin; ảnh admin trùng ảnh Pancake mới không lặp', () => {
    expect(mergePancakeImages([A, C], [A], [A, C])).toEqual({ images: [A, C], adminKept: 0 });
  });

  it('chưa có danh sách ảnh Pancake lần trước (dữ liệu có từ trước khi có cột): mọi ảnh đang lưu không có ở Pancake đều giữ, không mất ảnh nào', () => {
    expect(mergePancakeImages([B], [], [A, ADMIN])).toEqual({ images: [B, A, ADMIN], adminKept: 2 });
  });

  it('bỏ trùng và chuỗi rỗng trong ảnh đang lưu', () => {
    expect(mergePancakeImages([A], [A], ['', ADMIN, ADMIN, A]).images).toEqual([A, ADMIN]);
  });
});
