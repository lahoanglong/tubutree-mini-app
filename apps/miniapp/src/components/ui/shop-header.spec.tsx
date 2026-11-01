import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShopHeader } from './shop-header';

const cover = () => screen.getByTestId('shop-cover');

describe('ShopHeader', () => {
  it('chưa có ảnh bìa: bìa phẳng màu token, không gradient', () => {
    render(<ShopHeader title="Gian hàng Lan" />);
    expect(cover().style.background).toContain('var(--color-bg-cover)');
    expect(cover().style.background).not.toContain('gradient');
  });

  it('có ảnh bìa: URL được đặt trong ngoặc kép và ký tự phá chuỗi bị mã hoá', () => {
    render(<ShopHeader title="Shop" coverUrl={'https://x.vn/a") ,url("evil.png'} />);
    const bg = cover().style.background;
    expect(bg).toContain('%22evil.png');
    expect(bg).not.toContain('"evil');
  });

  it('avatar chưa có ảnh: nền chủ đạo và biểu tượng lá, không chữ cái; có ảnh thì ảnh không alt (tên đã ở h1)', () => {
    const { unmount } = render(<ShopHeader title="Gian hàng Lan" />);
    expect(screen.getByTestId('shop-avatar').querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('shop-avatar')).not.toHaveTextContent('G');
    unmount();
    render(<ShopHeader title="Gian hàng Lan" avatarUrl="/a.png" />);
    const img = screen.getByTestId('shop-avatar').querySelector('img');
    expect(img).toHaveAttribute('src', '/a.png');
    expect(img).toHaveAttribute('alt', '');
  });

  it('verified: dấu tích có tên "Đã được Tubu Tree duyệt"; không verified thì không có', () => {
    const { unmount } = render(<ShopHeader title="Shop" verified />);
    expect(screen.getByRole('img', { name: 'Đã được Tubu Tree duyệt' })).toBeInTheDocument();
    unmount();
    render(<ShopHeader title="Shop" />);
    expect(screen.queryByRole('img', { name: 'Đã được Tubu Tree duyệt' })).toBeNull();
  });

  it('tên là h1; tên dài có dấu cắt 2 dòng, không tràn ngang', () => {
    const long = 'Gian hàng Nguyễn Thị Phương Thảo - Sản phẩm xanh sạch từ vườn nhà Đà Lạt';
    render(<ShopHeader title={long} />);
    const h1 = screen.getByRole('heading', { level: 1, name: long });
    expect(h1.style.overflow).toBe('hidden');
    expect(h1.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    expect(h1.style.minWidth).toBe('0px');
  });

  it('badges và action hiện trong đầu shop', () => {
    render(<ShopHeader title="Shop" badges={<span>Chính hãng</span>} action={<button type="button">Theo dõi</button>} />);
    expect(screen.getByText('Chính hãng')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Theo dõi' })).toBeVisible();
  });

  it('ghi chú dài: cắt 2 dòng, nút "Xem thêm" mở hết rồi "Thu gọn"; ghi chú ngắn không có nút', () => {
    const note = 'Mình bán đồ sống xanh chọn lọc, dùng thử kỹ rồi mới giới thiệu cho bạn bè. '.repeat(3);
    const { unmount } = render(<ShopHeader title="Shop" note={note} />);
    const more = screen.getByRole('button', { name: 'Xem thêm' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('shop-note').style.getPropertyValue('-webkit-line-clamp')).toBe('2');
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Thu gọn' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('shop-note').style.getPropertyValue('-webkit-line-clamp')).toBe('');
    unmount();
    render(<ShopHeader title="Shop" note="Đồ xanh chọn lọc" />);
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
  });

  it('note rỗng hoặc null: không vẽ dòng ghi chú', () => {
    render(<ShopHeader title="Shop" note={null} />);
    expect(screen.queryByTestId('shop-note')).toBeNull();
  });
});
