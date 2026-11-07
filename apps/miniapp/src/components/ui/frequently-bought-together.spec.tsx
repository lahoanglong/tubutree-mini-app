import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { frequentlyBoughtSummary, type FbtLine } from '@tubutree/app-core/commerce/frequently-bought';
import { FrequentlyBoughtTogether } from './frequently-bought-together';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

const line = (n: number, over: Partial<FbtLine> = {}): FbtLine => ({
  key: `v${n}`,
  productId: `p${n}`,
  slug: `sp-${n}`,
  variationId: `v${n}`,
  name: `Món ${n}`,
  thumbnail: null,
  price: 50_000,
  compareAt: null,
  isCurrent: n === 0,
  ...over,
});
const LINES = [line(0, { price: 100_000, compareAt: 120_000 }), line(1), line(2, { price: 40_000 })];

function renderFbt(over: { picked?: string[]; busy?: boolean; onToggle?: (k: string) => void; onAdd?: () => void; lines?: FbtLine[] } = {}) {
  const lines = over.lines ?? LINES;
  const picked = new Set(over.picked ?? lines.map((l) => l.key));
  return render(
    <FrequentlyBoughtTogether
      lines={lines}
      picked={picked}
      onToggle={over.onToggle ?? vi.fn()}
      summary={frequentlyBoughtSummary(lines, picked)}
      busy={over.busy}
      onAdd={over.onAdd ?? vi.fn()}
    />,
  );
}

describe('FrequentlyBoughtTogether (Mini)', () => {
  it('vùng "Gợi ý mua kèm hợp vị": mỗi món một dòng tick, món đang xem có nhãn "Món đang xem" và đứng đầu', () => {
    renderFbt();
    const region = screen.getByRole('region', { name: 'Gợi ý mua kèm hợp vị' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Gợi ý mua kèm hợp vị' })).toBeInTheDocument();
    const rows = within(region).getAllByTestId('fbt-row');
    expect(rows.map((r) => r.getAttribute('data-variation-id'))).toEqual(['v0', 'v1', 'v2']);
    expect(within(rows[0]!).getByText('Món đang xem')).toBeInTheDocument();
    expect(within(rows[1]!).queryByText('Món đang xem')).toBeNull();
  });

  it('dòng là checkbox có tên truy cập {tên}, {giá} và trạng thái đúng theo tập đã chọn', () => {
    renderFbt({ picked: ['v0', 'v2'] });
    expect(screen.getByRole('checkbox', { name: 'Món 0, 100.000đ' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Món 1, 50.000đ' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: 'Món 2, 40.000đ' })).toHaveAttribute('aria-checked', 'true');
  });

  it('chạm dòng hay Enter/Space trên dòng gọi onToggle đúng khoá; chạm ô tick không bắn đôi', () => {
    const onToggle = vi.fn();
    renderFbt({ onToggle });
    const row = screen.getByRole('checkbox', { name: 'Món 1, 50.000đ' });
    fireEvent.click(row);
    expect(onToggle).toHaveBeenLastCalledWith('v1');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(row, { key: ' ' });
    expect(onToggle).toHaveBeenCalledTimes(3);
    expect(onToggle).toHaveBeenCalledWith('v1');
  });

  it('giá gạch qua PriceTag cho món có giá gạch; món không giảm thì không gạch', () => {
    renderFbt();
    const [first, second] = screen.getAllByTestId('fbt-row');
    expect(within(first!).getByText('120.000đ').style.textDecoration).toBe('line-through');
    expect(within(second!).queryByText(/120/)).toBeNull();
    expect(within(second!).getByText('50.000đ').style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('nút ghi số món và tổng tiền đã chọn; bấm gọi onAdd', () => {
    const onAdd = vi.fn();
    renderFbt({ onAdd });
    const btn = screen.getByTestId('fbt-add');
    expect(btn).toHaveTextContent('Thêm 3 món vào giỏ · 190.000đ');
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('bỏ tick một món: nút đổi số món và tổng (190.000đ - 50.000đ)', () => {
    renderFbt({ picked: ['v0', 'v2'] });
    expect(screen.getByTestId('fbt-add')).toHaveTextContent('Thêm 2 món vào giỏ · 140.000đ');
  });

  it('dòng "Tiết kiệm" ghi phần giá gạch của các món ĐANG tick (20.000đ), không ghi khi món có giá gạch bị bỏ tick', () => {
    const { unmount } = renderFbt();
    expect(screen.getByTestId('fbt-save')).toHaveTextContent('Tiết kiệm 20.000đ');
    unmount();
    renderFbt({ picked: ['v1', 'v2'] });
    expect(screen.getByTestId('fbt-save')).toBeEmptyDOMElement();
  });

  it('dòng "Tiết kiệm" luôn có mặt (giữ chỗ, vùng đọc polite) để nút bên dưới không nhảy', () => {
    renderFbt({ lines: [line(0), line(1)] });
    const save = screen.getByTestId('fbt-save');
    expect(save).toHaveAttribute('aria-live', 'polite');
    expect(save).toBeEmptyDOMElement();
  });

  it('bỏ tick hết: nút khoá, nhãn mời chọn; không gọi onAdd', () => {
    const onAdd = vi.fn();
    renderFbt({ picked: [], onAdd });
    const btn = screen.getByTestId('fbt-add');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Chọn món muốn thêm');
    fireEvent.click(btn);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('đang thêm (busy): nút báo bận', () => {
    renderFbt({ busy: true });
    expect(screen.getByTestId('fbt-add')).toHaveAttribute('aria-busy', 'true');
  });

  it('không có dòng nào: không vẽ gì', () => {
    const { container } = renderFbt({ lines: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('chữ khách đọc không có dấu chấm than, không thuật ngữ cấm, không màu thô; số đo nằm ở CSS (không style px trên dòng)', () => {
    const { container } = renderFbt();
    expect(container.textContent).not.toContain('!');
    expect(container.textContent).not.toMatch(/freeship|voucher|flash sale/i);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    container.querySelectorAll('.tubu-fbt, .tubu-fbt-list, .tubu-fbt-row, .tubu-fbt-body').forEach((el) => expect(el.hasAttribute('style'), el.className).toBe(false));
  });
});

describe('css/frequently-bought.css', () => {
  const css = readFileSync(resolve(__dirname, '../../css/frequently-bought.css'), 'utf8');

  it('dòng cao tối thiểu 64px (vùng chạm cả dòng >= 44), số đều, nền token', () => {
    expect(css).toMatch(/\.tubu-fbt-row\s*{[^}]*min-height:\s*64px/);
    expect(css).toMatch(/\.tubu-fbt\s*{[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(css).toMatch(/\.tubu-fbt\s*{[^}]*background:\s*var\(--color-bg-surface\)/);
  });

  it('không màu thô, không primitive --stone/--forest', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/var\(--(stone|forest|p-)/);
  });
});
