import { describe, expect, it } from 'vitest';
import { ogCardData } from './storefront-og';

const item = (thumbnail: string | null | undefined, id = Math.random().toString(36)) => ({ id, product: { id, name: 'SP', slug: 'sp', basePrice: 1, thumbnail } });
const sf = (over: Record<string, unknown> = {}) =>
  ({
    id: 's1', slug: 'linh', title: 'Shop của Linh', themeColor: '#16a34a', avatarUrl: null, coverUrl: null,
    collections: [], ...over,
  }) as never;

describe('ogCardData — dữ liệu thẻ chia sẻ của gian hàng (D3-10)', () => {
  it('lấy tên, ảnh đại diện và tối đa 3 ảnh sản phẩm theo thứ tự hiển thị', () => {
    const d = ogCardData(sf({
      avatarUrl: 'https://cdn.x/a.jpg',
      collections: [
        { id: 'c1', title: 'A', items: [item('https://cdn.x/1.jpg'), item('https://cdn.x/2.jpg')] },
        { id: 'c2', title: 'B', items: [item('https://cdn.x/3.jpg'), item('https://cdn.x/4.jpg')] },
      ],
    }));
    expect(d.name).toBe('Shop của Linh');
    expect(d.avatar).toBe('https://cdn.x/a.jpg');
    expect(d.thumbnails).toEqual(['https://cdn.x/1.jpg', 'https://cdn.x/2.jpg', 'https://cdn.x/3.jpg']);
  });

  it('bỏ ảnh base64, ảnh trống và ảnh không phải http(s): thẻ chia sẻ không nhúng cả ảnh', () => {
    const d = ogCardData(sf({
      avatarUrl: 'data:image/png;base64,AAAA',
      collections: [{ id: 'c1', title: 'A', items: [item('data:image/png;base64,BBBB'), item(null), item(undefined), item('javascript:alert(1)'), item('/relative.png'), item('https://cdn.x/ok.jpg')] }],
    }));
    expect(d.avatar).toBeNull();
    expect(d.thumbnails).toEqual(['https://cdn.x/ok.jpg']);
  });

  it('không lặp một ảnh hai lần', () => {
    const d = ogCardData(sf({ collections: [{ id: 'c1', title: 'A', items: [item('https://cdn.x/1.jpg'), item('https://cdn.x/1.jpg'), item('https://cdn.x/2.jpg')] }] }));
    expect(d.thumbnails).toEqual(['https://cdn.x/1.jpg', 'https://cdn.x/2.jpg']);
  });

  it('gian hàng chưa có ảnh nào: vẫn có tên và màu, danh sách ảnh rỗng', () => {
    const d = ogCardData(sf());
    expect(d).toMatchObject({ name: 'Shop của Linh', avatar: null, thumbnails: [], color: '#16a34a' });
  });

  it('màu chủ đề sai định dạng thì dùng xanh mặc định; tên quá dài bị cắt', () => {
    const d = ogCardData(sf({ themeColor: 'red; background:url(x)', title: 'T'.repeat(200) }));
    expect(d.color).toBe('#16a34a');
    expect(d.name.length).toBeLessThanOrEqual(60);
    expect(d.name.endsWith('…')).toBe(true);
  });
});
