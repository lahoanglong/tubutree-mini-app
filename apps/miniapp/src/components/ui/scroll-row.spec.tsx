import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScrollRow } from './scroll-row';
import { SegmentedTabs } from './segmented-tabs';

/** jsdom không có layout: giả lập vùng cuộn rộng 400 trong khung 200 (hoặc không tràn). */
function mockOverflow(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth });
}

afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

describe('ScrollRow', () => {
  it('là vùng .scroll-x có tên (role=region + aria-label) để trình đọc màn hình đọc được', () => {
    render(<ScrollRow label="Dải thương hiệu"><button type="button">A</button></ScrollRow>);
    const region = screen.getByRole('region', { name: 'Dải thương hiệu' });
    expect(region.className).toContain('scroll-x');
  });

  it('tràn ngang mà bên trong KHÔNG có gì focus được → tự focus được bằng bàn phím (axe scrollable-region-focusable)', () => {
    mockOverflow(400, 200);
    render(<ScrollRow label="Ảnh"><div>không bấm được</div></ScrollRow>);
    expect(screen.getByRole('region', { name: 'Ảnh' })).toHaveAttribute('tabindex', '0');
  });

  it('tràn ngang nhưng bên trong đã có nút focus được → không thêm điểm dừng Tab thừa', () => {
    mockOverflow(400, 200);
    render(<ScrollRow label="Chip"><button type="button">A</button></ScrollRow>);
    expect(screen.getByRole('region', { name: 'Chip' })).not.toHaveAttribute('tabindex');
  });

  it('không tràn → không tabindex, không gợi ý mờ mép', () => {
    mockOverflow(200, 200);
    render(<ScrollRow label="Ngắn"><div>x</div></ScrollRow>);
    const region = screen.getByRole('region', { name: 'Ngắn' });
    expect(region).not.toHaveAttribute('tabindex');
    expect(region).not.toHaveAttribute('data-fade-start');
    expect(region).not.toHaveAttribute('data-fade-end');
  });

  it('gợi ý cuộn: đầu hàng mờ mép phải; cuộn giữa mờ cả hai mép; cuối hàng chỉ mờ mép trái', () => {
    mockOverflow(400, 200);
    render(<ScrollRow label="Rail"><button type="button">A</button></ScrollRow>);
    const region = screen.getByRole('region', { name: 'Rail' });
    expect(region).toHaveAttribute('data-fade-end', 'true');
    expect(region).not.toHaveAttribute('data-fade-start');

    region.scrollLeft = 80;
    act(() => { fireEvent.scroll(region); });
    expect(region).toHaveAttribute('data-fade-start', 'true');
    expect(region).toHaveAttribute('data-fade-end', 'true');

    region.scrollLeft = 200;
    act(() => { fireEvent.scroll(region); });
    expect(region).toHaveAttribute('data-fade-start', 'true');
    expect(region).not.toHaveAttribute('data-fade-end');
  });

  it('truyền được style/className/data-testid của chỗ gọi', () => {
    render(<ScrollRow label="X" className="mine" style={{ gap: 8 }} data-testid="rail"><i /></ScrollRow>);
    const el = screen.getByTestId('rail');
    expect(el.className).toContain('mine');
    expect(el.style.gap).toBe('8px');
  });
});

describe('SegmentedTabs scroll', () => {
  const items = [{ key: 'a', label: 'Tất cả' }, { key: 'b', label: 'Chờ thanh toán' }, { key: 'c', label: 'Đang giao' }];

  it('scroll=true: hàng tab tràn ngang có gợi ý mờ mép; vẫn là tablist', () => {
    mockOverflow(400, 200);
    render(<SegmentedTabs items={items} value="a" onChange={() => {}} scroll />);
    const list = screen.getByRole('tablist');
    expect(list.className).toContain('scroll-x');
    expect(list).toHaveAttribute('data-fade-end', 'true');
  });

  it('scroll không bật: không có .scroll-x và không có gợi ý', () => {
    mockOverflow(400, 200);
    render(<SegmentedTabs items={items} value="a" onChange={() => {}} />);
    const list = screen.getByRole('tablist');
    expect(list.className).not.toContain('scroll-x');
    expect(list).not.toHaveAttribute('data-fade-end');
  });
});

describe('tokens.css .tubu-scroll-fade', () => {
  const css = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
  it('mờ mép bằng mask theo data-fade-start / data-fade-end (không cần màu nền)', () => {
    expect(css).toMatch(/\.tubu-scroll-fade\[data-fade-end\]\s*\{[^}]*mask-image:/);
    expect(css).toMatch(/\.tubu-scroll-fade\[data-fade-start\]\s*\{[^}]*mask-image:/);
    expect(css).toMatch(/\.tubu-scroll-fade\[data-fade-start\]\[data-fade-end\]\s*\{[^}]*mask-image:/);
  });
});
