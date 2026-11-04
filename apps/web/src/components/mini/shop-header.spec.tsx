// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { SHOP_COVER_HEIGHT, ShopHeader } from './shop-header';

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('ShopHeader (web)', () => {
  it('titleAs đổi thẻ tiêu đề (đầu xem trước trong trình dựng không thêm h1 thứ hai); mặc định h1', () => {
    const a = mount(<ShopHeader title="Gian hàng Lan" />);
    expect(a.container.querySelectorAll('h1')).toHaveLength(1);
    a.unmount();
    const b = mount(<ShopHeader title="Gian hàng Lan" titleAs="h2" />);
    expect(b.container.querySelectorAll('h1')).toHaveLength(0);
    expect(b.container.querySelector('h2')!.textContent).toBe('Gian hàng Lan');
  });

  it('chưa có ảnh bìa: bìa phẳng màu token, không gradient, không thẻ img', () => {
    mount(<ShopHeader title="Gian hàng Lan" />);
    expect(q('shop-cover')!.style.background).toContain('var(--color-bg-cover)');
    expect(q('shop-cover')!.style.background).not.toContain('gradient');
    expect(q('shop-cover')!.querySelector('img')).toBeNull();
  });

  it('có ảnh bìa: là thẻ img phủ kín khung (absolute, object-fit cover), eager + fetchpriority high, không dùng nền CSS', () => {
    mount(<ShopHeader title="Shop" coverUrl="https://res.cloudinary.com/tubutree/image/upload/v1/cover.jpg" />);
    const cover = q('shop-cover')!;
    const img = cover.querySelector('img')!;
    expect(cover.style.background).not.toContain('url(');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('fetchpriority')).toBe('high');
    expect(img.style.position).toBe('absolute');
    expect(img.style.objectFit).toBe('cover');
    expect(img.getAttribute('src')).toContain('/img?w=960&u=');
    expect(img.getAttribute('srcset')).toMatch(/ 320w, .* 480w, .* 640w, .* 960w$/);
    expect(img.getAttribute('sizes')).toBe('(max-width: 1023px) 100vw, 500px');
  });

  it('ảnh bìa host lạ: dùng nguyên URL làm src (thuộc tính, không thoát khỏi chuỗi), không srcset', () => {
    mount(<ShopHeader title="Shop" coverUrl={'https://x.vn/a") ,url("evil.png'} />);
    const img = q('shop-cover')!.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://x.vn/a") ,url("evil.png');
    expect(img.hasAttribute('srcset')).toBe(false);
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

  it('avatar đi qua bộ đổi cỡ 160w kèm width/height', () => {
    mount(<ShopHeader title="Gian hàng Lan" avatarUrl="https://res.cloudinary.com/tubutree/image/upload/v1/av.jpg" />);
    const img = q('shop-avatar')!.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('/img?w=160&u=');
    expect(img.getAttribute('width')).toBe('56');
    expect(img.getAttribute('height')).toBe('56');
  });

  it('gian hàng CTV: ảnh trên host khác (Pancake, cloud khác) giữ URL gốc; thương hiệu (admin nhập) thì mọi host https đi qua bộ đổi cỡ', () => {
    mount(<ShopHeader title="Shop" coverUrl="https://content.pancake.vn/a/cover.jpg" avatarUrl="https://evil.example/av.jpg" />);
    expect(q('shop-cover')!.querySelector('img')!.getAttribute('src')).toBe('https://content.pancake.vn/a/cover.jpg');
    expect(q('shop-avatar')!.querySelector('img')!.getAttribute('src')).toBe('https://evil.example/av.jpg');
    document.body.replaceChildren();
    mount(<ShopHeader title="Hiệu" imageSource="brand" coverUrl="https://content.pancake.vn/a/cover.jpg" avatarUrl="https://content.pancake.vn/a/av.jpg" />);
    expect(q('shop-cover')!.querySelector('img')!.getAttribute('src')).toContain('/img?w=');
    expect(q('shop-avatar')!.querySelector('img')!.getAttribute('src')).toContain('/img?w=160&u=');
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

  it('khung nút (action) có position: bìa là phần tử định vị nên không có thì bìa đè 18px đầu nút ở khổ md (hàng avatar lùi -mt-7)', () => {
    mount(<ShopHeader title="Shop" action={<button type="button">Chia sẻ gian hàng</button>} />);
    const wrapper = document.querySelector('button')!.parentElement!;
    expect(wrapper.className.split(/\s+/)).toContain('relative');
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
