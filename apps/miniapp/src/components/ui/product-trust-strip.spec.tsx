import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { productTrustStrip } from '@tubutree/app-core/commerce/product-trust-strip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductTrustStrip } from './product-trust-strip';

const view = (returnWindowDays: unknown = 7) => productTrustStrip({ fulfillerKind: 'TUBU', returnWindowDays })!;

describe('ProductTrustStrip (Mini)', () => {
  it('view null (hàng gian hàng tự giao): không vẽ gì', () => {
    const { container } = render(<ProductTrustStrip view={null} onOpenPolicy={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('một vùng có tên "Cam kết của Tubu Tree…" và ba trụ cột theo thứ tự, chữ lấy từ app-core', () => {
    render(<ProductTrustStrip view={view()} onOpenPolicy={vi.fn()} />);
    const strip = screen.getByRole('region', { name: 'Cam kết của Tubu Tree khi mua sản phẩm này' });
    expect(strip).toBe(screen.getByTestId('product-trust-strip'));
    const items = within(strip).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-testid'))).toEqual(['trust-pillar-origin', 'trust-pillar-delivery', 'trust-pillar-returns']);
    expect(items.map((li) => li.textContent)).toEqual([
      'Nguồn gốc rõ ràngChọn lọc kỹ từng thương hiệu',
      'Giao hàng cẩn thậnĐóng gói kỹ trước khi giao',
      'Đổi trả dễ dàngHỗ trợ nhanh nếu sản phẩm lỗi',
    ]);
  });

  it('icon chỉ để trang trí (aria-hidden), không đọc thành chữ', () => {
    render(<ProductTrustStrip view={view()} onOpenPolicy={vi.fn()} />);
    for (const li of screen.getAllByRole('listitem')) {
      const deco = li.querySelector('.tubu-trust-icon')!;
      expect(deco).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('lối xem chính sách là <button> thật, tên truy cập đầy đủ, chạm gọi onOpenPolicy đúng một lần với chính sách đổi trả', () => {
    const onOpenPolicy = vi.fn();
    render(<ProductTrustStrip view={view()} onOpenPolicy={onOpenPolicy} />);
    const cta = screen.getByRole('button', { name: 'Xem chính sách đổi trả của Tubu Tree' });
    expect(cta).toBe(screen.getByTestId('product-trust-cta'));
    expect(cta.tagName).toBe('BUTTON');
    expect(cta).toHaveAttribute('type', 'button');
    expect(cta).toHaveTextContent('Xem chính sách đổi trả');
    expect(cta.className).toContain('tubu-hit-44');
    fireEvent.click(cta);
    expect(onOpenPolicy).toHaveBeenCalledTimes(1);
    expect(onOpenPolicy).toHaveBeenCalledWith('doi-tra');
  });

  it('đổi trả tắt: hai trụ cột, lối xem chuyển sang chính sách vận chuyển', () => {
    const onOpenPolicy = vi.fn();
    render(<ProductTrustStrip view={view(0)} onOpenPolicy={onOpenPolicy} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('list')).toHaveAttribute('data-count', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Xem chính sách vận chuyển của Tubu Tree' }));
    expect(onOpenPolicy).toHaveBeenCalledWith('van-chuyen');
  });

  it('không style px, không màu thô trong DOM; không chữ cấm và không dấu chấm than', () => {
    const { container } = render(<ProductTrustStrip view={view()} onOpenPolicy={vi.fn()} />);
    expect(container.querySelectorAll('[style]').length).toBe(0);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(container.textContent).not.toContain('!');
    expect(container.textContent).not.toMatch(/hữu cơ|đúng hẹn|chuẩn mát/i);
  });
});

describe('css/product-trust.css', () => {
  const css = readFileSync(resolve(__dirname, '../../css/product-trust.css'), 'utf8');
  function loadSheet() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return style.sheet!;
  }
  afterEach(() => document.head.querySelectorAll('style').forEach((s) => s.remove()));
  const rule = (sel: string) => (Array.from(loadSheet().cssRules).find((r) => 'selectorText' in r && (r as CSSStyleRule).selectorText === sel) as CSSStyleRule).style;

  it('lối xem chính sách cao tối thiểu 44px, rộng hết khối', () => {
    expect(rule('.tubu-trust-cta').getPropertyValue('min-height')).toBe('44px');
    expect(rule('.tubu-trust-cta').getPropertyValue('width')).toBe('100%');
  });

  it('chữ dài không tràn ngang: cột min-width 0, chữ overflow-wrap anywhere', () => {
    expect(parseFloat(rule('.tubu-trust-item').getPropertyValue('min-width'))).toBe(0);
    const grouped = Array.from(loadSheet().cssRules).find((r) => 'selectorText' in r && /tubu-trust-title/.test((r as CSSStyleRule).selectorText) && /tubu-trust-sub/.test((r as CSSStyleRule).selectorText)) as CSSStyleRule;
    expect(grouped.style.getPropertyValue('overflow-wrap')).toBe('anywhere');
  });

  it('chỉ token: không hex, không var(--stone-…)', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/var\(--stone-/);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});
