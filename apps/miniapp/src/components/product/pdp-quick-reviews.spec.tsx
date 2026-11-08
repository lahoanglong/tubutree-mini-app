import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdpQuickReviews } from './pdp-quick-reviews';

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, rating: 5, comment: `Dùng rất ổn ${id}`, images: [] as string[], videoUrl: null as string | null, createdAt: '2026-10-01T00:00:00.000Z', author: 'Lan', ...over,
});

describe('PdpQuickReviews', () => {
  it('hiện điểm, số lượt, đúng 2 đánh giá có chữ và nút "Xem tất cả (n)" cuộn tới danh sách đầy đủ', () => {
    const onSeeAll = vi.fn();
    render(<PdpQuickReviews average={4.4} count={27} items={[item('a'), item('b', { comment: null }), item('c', { images: ['x.jpg'] }), item('d')]} onSeeAll={onSeeAll} />);
    const title = screen.getByRole('heading', { level: 2, name: 'Đánh giá' });
    // Tiêu đề khối là Inter (font-ui), không phải Fraunces của tiêu đề trang (§4 Q1).
    expect(title.style.fontFamily).toBe('var(--font-ui)');
    expect(screen.getByText(/4,4/)).toBeInTheDocument();
    // Tên đọc của dải sao đầu khối là điểm trung bình (như số đang hiện); mỗi đánh giá là điểm một khách chấm.
    expect(screen.getByRole('img', { name: '4,4 trên 5 sao' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: '5 trên 5 sao' })).toHaveLength(2);
    expect(screen.getAllByTestId('quick-review')).toHaveLength(2);
    expect(screen.getByText('Dùng rất ổn c')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả (27)' }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('không có đánh giá có chữ thì không render gì', () => {
    const { container } = render(<PdpQuickReviews average={4} count={3} items={[item('a', { comment: null })]} onSeeAll={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PdpQuickReviews (Mini): số đều, huy hiệu "Đã mua", dải ảnh thu nhỏ (W51A)', () => {
  const ABS = 'https://res.cloudinary.com/tubu/image/upload/a.jpg';
  const show = (items: Array<ReturnType<typeof item>>) =>
    render(<PdpQuickReviews average={4.4} count={27} items={items} onSeeAll={() => undefined} />);
  const rowOf = (author: string) => screen.getAllByTestId('quick-review').find((r) => r.textContent!.includes(author))!;

  it('section có data-section="pdp-quick-reviews" như web (e2e đo riêng khối này bằng thuộc tính đó)', () => {
    show([item('a')]);
    expect(screen.getByRole('region', { name: 'Đánh giá nhanh' }).getAttribute('data-section')).toBe('pdp-quick-reviews');
  });

  it('"điểm · số lượt" và nút "Xem tất cả (n)" dùng số đều (tabular-nums)', () => {
    show([item('a')]);
    expect(screen.getByText('4,4 · 27').style.fontVariantNumeric).toBe('tabular-nums');
    expect(screen.getByRole('button', { name: 'Xem tất cả (27)' }).style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('huy hiệu "Đã mua" chỉ hiện ở đánh giá verifiedPurchase=true, cùng hàng với tên người đánh giá', () => {
    show([item('a', { author: 'Lan', verifiedPurchase: true }), item('b', { author: 'Mai', verifiedPurchase: false })]);
    const badge = within(rowOf('Lan')).getByTestId('quick-review-verified');
    expect(badge).toHaveTextContent('Đã mua');
    expect(badge.parentElement).toBe(within(rowOf('Lan')).getByText('Lan').parentElement);
    expect(within(rowOf('Mai')).queryByTestId('quick-review-verified')).toBeNull();
    expect(screen.getAllByTestId('quick-review-verified')).toHaveLength(1);
  });

  it('đánh giá không có trường verifiedPurchase (API cũ) thì không có huy hiệu', () => {
    show([item('a')]);
    expect(screen.queryByTestId('quick-review-verified')).toBeNull();
  });

  it('dải ảnh thu nhỏ nằm dưới nhận xét: tối đa 3 ảnh, ảnh trang trí (alt rỗng, lazy)', () => {
    show([item('a', { images: ['/reviews/r1/images/0', '/reviews/r1/images/1', '/reviews/r1/images/2', '/reviews/r1/images/3'] })]);
    const strip = screen.getByTestId('quick-review-photos');
    const imgs = Array.from(strip.querySelectorAll('img'));
    expect(imgs).toHaveLength(3);
    imgs.forEach((img) => {
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('loading')).toBe('lazy');
      // Ảnh gốc (Cloudinary) có thể rộng cả nghìn px: không có lớp 48px này thì tràn khung 375px (số đo ở css/pdp-quick-reviews.css).
      expect(img).toHaveClass('tubu-qr-photo');
    });
    expect(strip.previousElementSibling!.textContent).toBe('Dùng rất ổn a');
  });

  it('ảnh do API phục vụ (đường dẫn "/…") được ghép gốc API, URL tuyệt đối (Cloudinary) giữ nguyên', () => {
    show([item('a', { images: [ABS, '/reviews/r1/images/0'] })]);
    const srcs = Array.from(screen.getByTestId('quick-review-photos').querySelectorAll('img')).map((img) => img.getAttribute('src'));
    expect(srcs).toHaveLength(2);
    expect(srcs[0]).toBe(ABS);
    expect(srcs[1]).toMatch(/^https?:\/\/.+\/reviews\/r1\/images\/0$/);
  });

  it('không có ảnh thì không dựng dải ảnh', () => {
    show([item('a')]);
    expect(screen.queryByTestId('quick-review-photos')).toBeNull();
  });

  it('có huy hiệu và dải ảnh: mọi nút vẫn có tên và cao tối thiểu 44px, ảnh không thành control', () => {
    show([item('a', { verifiedPurchase: true, images: ['/reviews/r1/images/0', ABS] }), item('b', { verifiedPurchase: true })]);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const button = screen.getByRole('button');
    expect(button).toHaveAccessibleName('Xem tất cả (27)');
    expect(button.style.minHeight).toBe('44px');
    expect(screen.getByTestId('quick-review-photos').querySelector('button, a, [tabindex]')).toBeNull();
  });
});

describe('css/pdp-quick-reviews.css: số đo của huy hiệu và dải ảnh', () => {
  const css = readFileSync(resolve(__dirname, '../../css/pdp-quick-reviews.css'), 'utf8');
  afterEach(() => document.head.querySelectorAll('style').forEach((s) => s.remove()));
  const rule = (sel: string) => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return (Array.from(style.sheet!.cssRules).find((r) => 'selectorText' in r && (r as CSSStyleRule).selectorText === sel) as CSSStyleRule | undefined)?.style;
  };

  it('ảnh vuông 48px, không co, cắt đầy khung theo bo góc media', () => {
    const r = rule('.tubu-qr-photo')!;
    expect(r.getPropertyValue('width')).toBe('48px');
    expect(r.getPropertyValue('height')).toBe('48px');
    expect(r.getPropertyValue('object-fit')).toBe('cover');
    expect(r.getPropertyValue('border-radius')).toBe('var(--radius-media)');
    expect(r.getPropertyValue('flex-shrink')).toBe('0');
  });

  it('dải ảnh: hàng ngang cách 6px, cách nhận xét 2px (web: gap-1.5 và mt-0.5)', () => {
    const r = rule('.tubu-qr-photos')!;
    expect(r.getPropertyValue('display')).toBe('flex');
    expect(r.getPropertyValue('gap')).toBe('6px');
    expect(r.getPropertyValue('margin-top')).toBe('2px');
  });

  it('huy hiệu: biểu tượng và chữ cùng hàng, căn giữa, cách 2px (web: gap-0.5)', () => {
    const r = rule('.tubu-qr-badge')!;
    expect(r.getPropertyValue('display')).toBe('inline-flex');
    expect(r.getPropertyValue('align-items')).toBe('center');
    expect(r.getPropertyValue('gap')).toBe('2px');
  });
});
