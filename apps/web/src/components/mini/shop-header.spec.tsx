// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { SHOP_COVER_HEIGHT, ShopHeader } from './shop-header';

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('ShopHeader (web)', () => {
  it('chưa có ảnh bìa: bìa phẳng màu token, không gradient', () => {
    mount(<ShopHeader title="Gian hàng Lan" />);
    expect(q('shop-cover')!.style.background).toContain('var(--color-bg-cover)');
    expect(q('shop-cover')!.style.background).not.toContain('gradient');
  });

  it('có ảnh bìa: URL đặt trong ngoặc kép và ký tự phá chuỗi bị mã hoá', () => {
    mount(<ShopHeader title="Shop" coverUrl={'https://x.vn/a") ,url("evil.png'} />);
    const bg = q('shop-cover')!.style.background;
    expect(bg).toContain('%22evil.png');
    expect(bg).not.toContain('"evil');
  });

  it('avatar chưa có ảnh: biểu tượng lá, không chữ cái; có ảnh thì ảnh không alt', () => {
    const a = mount(<ShopHeader title="Gian hàng Lan" />);
    expect(q('shop-avatar')!.querySelector('svg')).not.toBeNull();
    expect(q('shop-avatar')!.textContent).not.toContain('G');
    a.unmount();
    mount(<ShopHeader title="Gian hàng Lan" avatarUrl="/a.png" />);
    const img = q('shop-avatar')!.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/a.png');
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('verified: dấu tích có tên "Đã được Tubu Tree duyệt"; không verified thì không có', () => {
    const a = mount(<ShopHeader title="Shop" verified />);
    expect(document.querySelector('[role="img"][aria-label="Đã được Tubu Tree duyệt"]')).not.toBeNull();
    a.unmount();
    mount(<ShopHeader title="Shop" />);
    expect(document.querySelector('[role="img"][aria-label="Đã được Tubu Tree duyệt"]')).toBeNull();
  });

  it('tên là h1; tên dài cắt 2 dòng, không tràn ngang', () => {
    const long = 'Gian hàng Nguyễn Thị Phương Thảo - Sản phẩm xanh sạch từ vườn nhà Đà Lạt';
    mount(<ShopHeader title={long} />);
    const h1 = document.querySelector('h1')!;
    expect(h1.textContent).toBe(long);
    expect(h1.style.overflow).toBe('hidden');
    expect(h1.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    expect(h1.style.minWidth).toBe('0px');
  });

  it('mặc định (ngoài StoreLayout) không có lớp lg: nào: bố cục điện thoại giữ ở mọi khổ, bìa và avatar không rời nhau', () => {
    mount(<ShopHeader title="Shop" verified badges={<span>Chính hãng</span>} action={<button type="button">Theo dõi</button>} note="Đồ xanh" />);
    const root = q('shop-cover')!.parentElement!;
    const lgClasses = Array.from(root.querySelectorAll<HTMLElement>('*'))
      .concat(root)
      .flatMap((el) => (typeof el.className === 'string' ? el.className.split(/\s+/) : []))
      .filter((c) => c.startsWith('lg:'));
    expect(lgClasses).toEqual([]);
    expect(q('shop-cover')!.className.split(/\s+/)).toContain(`h-[${SHOP_COVER_HEIGHT}px]`);
    expect(q('shop-avatar')!.parentElement!.parentElement!.className.split(/\s+/)).toContain('-mt-7');
  });

  it('inStoreGrid: từ lg gốc là contents: bìa cột trái cao hai hàng, thông tin cột phải, avatar và nút nằm trên hàng tên, không đè mép bìa', () => {
    mount(<ShopHeader inStoreGrid title="Shop" badges={<span>Chính hãng</span>} action={<button type="button">Theo dõi</button>} note="Đồ xanh" />);
    const cover = q('shop-cover')!;
    const root = cover.parentElement!;
    expect(root.className.split(/\s+/)).toContain('lg:contents');
    const coverCls = cover.className.split(/\s+/);
    expect(coverCls).toEqual(expect.arrayContaining(['lg:col-start-1', 'lg:row-span-2', 'lg:row-start-1', 'lg:h-auto', `h-[${SHOP_COVER_HEIGHT}px]`]));
    const info = cover.nextElementSibling as HTMLElement;
    expect(info.className.split(/\s+/)).toEqual(expect.arrayContaining(['lg:col-start-2', 'lg:row-start-1', 'lg:grid']));
    const avatarRow = q('shop-avatar')!.parentElement!.parentElement!;
    expect(avatarRow.className.split(/\s+/)).toEqual(expect.arrayContaining(['-mt-7', 'lg:contents']));
    expect(q('shop-avatar')!.parentElement!.className.split(/\s+/)).toContain('lg:col-start-1');
    const nameCell = document.querySelector('h1')!.parentElement!;
    expect(nameCell.className.split(/\s+/)).toEqual(expect.arrayContaining(['lg:col-start-2', 'lg:row-start-1', 'lg:mt-0']));
    // Không còn style nội tuyến nào đè được lớp lg: ở phần tử xếp lưới.
    for (const el of [cover, info, nameCell, avatarRow]) expect(el.style.display).toBe('');
    expect(info.style.padding).toBe('');
  });

  it('badges và action hiện trong đầu shop', () => {
    mount(<ShopHeader title="Shop" badges={<span>Chính hãng</span>} action={<button type="button">Theo dõi</button>} />);
    expect(document.body.textContent).toContain('Chính hãng');
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Theo dõi')).toBe(true);
  });

  it('ghi chú dài: cắt 2 dòng, "Xem thêm" mở hết rồi "Thu gọn"; ngắn không có nút', () => {
    const note = 'Mình bán đồ sống xanh chọn lọc, dùng thử kỹ rồi mới giới thiệu cho bạn bè. '.repeat(3);
    const a = mount(<ShopHeader title="Shop" note={note} />);
    const more = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Xem thêm')!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(q('shop-note')!.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    click(more);
    const less = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Thu gọn')!;
    expect(less.getAttribute('aria-expanded')).toBe('true');
    expect(q('shop-note')!.style.getPropertyValue('-webkit-line-clamp')).toBe('');
    a.unmount();
    mount(<ShopHeader title="Shop" note="Đồ xanh chọn lọc" />);
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Xem thêm')).toBe(false);
  });

  it('note rỗng hoặc null: không vẽ dòng ghi chú', () => {
    mount(<ShopHeader title="Shop" note={null} />);
    expect(q('shop-note')).toBeNull();
  });

  it('render phía máy chủ (trang server truyền dữ liệu thuần) ra h1 và ghi chú đã cắt', () => {
    const html = renderToString(<ShopHeader title="Shop Lan" note="Đồ xanh" badges={<span>Mẫu</span>} />);
    expect(html).toContain('<h1');
    expect(html).toContain('Shop Lan');
    expect(html).toContain('Đồ xanh');
  });
});
