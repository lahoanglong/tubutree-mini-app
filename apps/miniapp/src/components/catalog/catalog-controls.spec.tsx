import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Baby, LayoutGrid } from 'lucide-react';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { SEGMENT_ENTRIES } from '../../hooks/use-categories';
import { CategoryGrid } from './category-grid';
import { SORT_OPTIONS, SortChips } from './sort-chips';
import { ResultHeader } from './result-header';

const ENTRIES = [
  { kind: 'category' as const, key: 'cat-a', label: 'Tẩy rửa sinh học', icon: LayoutGrid },
  { kind: 'segment' as const, key: 'mom_baby', label: 'Cho mẹ & bé', icon: Baby },
];

describe('CategoryGrid', () => {
  it('vùng "Danh mục" với 1 nút cho mỗi mục; chạm → onSelect(mục)', () => {
    const onSelect = vi.fn();
    render(<CategoryGrid entries={ENTRIES} isLoading={false} onSelect={onSelect} />);
    const region = screen.getByRole('region', { name: 'Danh mục' });
    fireEvent.click(screen.getByRole('button', { name: 'Cho mẹ & bé' }));
    expect(onSelect).toHaveBeenCalledWith(ENTRIES[1]);
    expect(region.querySelectorAll('button')).toHaveLength(2);
  });

  it('mỗi mục là <button> thật: Tab tới được và Enter / Space chọn', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CategoryGrid entries={ENTRIES} isLoading={false} onSelect={onSelect} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Tẩy rửa sinh học' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(ENTRIES[0]);
    await user.tab();
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenLastCalledWith(ENTRIES[1]);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('tiêu đề tuỳ biến đặt tên cho vùng', () => {
    render(<CategoryGrid entries={ENTRIES} isLoading={false} onSelect={vi.fn()} title="Mua theo nhu cầu" />);
    expect(screen.getByRole('region', { name: 'Mua theo nhu cầu' })).toBeInTheDocument();
  });

  it('đang tải → khung chờ aria-hidden, chưa có nút; số ô chờ = số phân khúc dự phòng (4)', () => {
    render(<CategoryGrid entries={ENTRIES} isLoading onSelect={vi.fn()} />);
    const loading = screen.getByTestId('category-grid-loading');
    expect(loading).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button')).toBeNull();
    expect(SEGMENT_ENTRIES).toHaveLength(4);
    expect(loading.children).toHaveLength(SEGMENT_ENTRIES.length);
  });

  it('placeholderCount tuỳ biến đổi số ô chờ, và ô chờ cao bằng ô thật (48px)', () => {
    const { rerender } = render(<CategoryGrid entries={ENTRIES} isLoading placeholderCount={6} onSelect={vi.fn()} />);
    const loading = screen.getByTestId('category-grid-loading');
    expect(loading.children).toHaveLength(6);
    expect((loading.children[0] as HTMLElement).style.height).toBe('48px');
    rerender(<CategoryGrid entries={ENTRIES} isLoading={false} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cho mẹ & bé' }).style.minHeight).toBe('48px');
  });
});

describe('SortChips', () => {
  it('5 lựa chọn theo spec; đang chọn có aria-pressed; chạm "Bán chạy" → best_seller; chạm lại cái đang chọn → không gọi', () => {
    expect(SORT_OPTIONS.map((o) => o.label)).toEqual(['Gợi ý', 'Bán chạy', 'Mới nhất', 'Giá tăng', 'Giá giảm']);
    const onChange = vi.fn();
    render(<SortChips value={undefined} onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Sắp xếp' });
    expect(group.querySelector('[aria-pressed="true"]')).toHaveTextContent('Gợi ý');
    expect(group.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Bán chạy' }));
    expect(onChange).toHaveBeenCalledWith('best_seller');
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('chọn "Giá giảm" → chỉ chip đó pressed; chạm "Gợi ý" → onChange(undefined)', () => {
    const onChange = vi.fn();
    render(<SortChips value="price_desc" onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Sắp xếp' });
    expect(group.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Giá giảm' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Giá giảm' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('hàng chip cuộn ngang có đệm dọc ≥ 4px để vùng chạm 44px của Chip không bị cắt', () => {
    render(<SortChips value={undefined} onChange={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Sắp xếp' });
    expect(group).toHaveClass('scroll-x');
    expect(parseFloat(group.style.paddingTop)).toBeGreaterThanOrEqual(4);
    expect(parseFloat(group.style.paddingBottom)).toBeGreaterThanOrEqual(4);
  });
});

describe('ResultHeader', () => {
  const base = { total: 1234, isLoading: false, chips: [], filterCount: 0, filtersIgnored: false, onOpenFilters: vi.fn(), onPatch: vi.fn() };

  it('hiện số kết quả (định dạng vi-VN) và nút "Bộ lọc"', () => {
    render(<ResultHeader {...base} />);
    expect(screen.getByTestId('result-count')).toHaveTextContent('1.234 sản phẩm');
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc' }));
    expect(base.onOpenFilters).toHaveBeenCalled();
  });

  it('số kết quả nằm trong vùng aria-live="polite" (không role alert) và đổi theo total', () => {
    const { rerender } = render(<ResultHeader {...base} total={3} />);
    const el = screen.getByTestId('result-count');
    expect(el).toHaveAttribute('aria-live', 'polite');
    expect(el).toHaveAttribute('aria-atomic', 'true');
    expect(el).toHaveTextContent('3 sản phẩm');
    rerender(<ResultHeader {...base} total={0} />);
    expect(screen.getByTestId('result-count')).toHaveTextContent('0 sản phẩm');
  });

  it('đang tải → chưa hiện số nhưng vẫn giữ chiều cao 1 dòng (không nhảy layout); có bộ lọc → "Bộ lọc (2)"; chip "Bỏ lọc Tubu" gọi onPatch(patch)', () => {
    const onPatch = vi.fn();
    render(
      <ResultHeader
        {...base}
        isLoading
        filterCount={2}
        onPatch={onPatch}
        chips={[{ key: 'brand:Tubu', label: 'Tubu', patch: { brands: [] } }, { key: 'inStock', label: 'Còn hàng', patch: { inStock: false } }]}
      />,
    );
    const count = screen.getByTestId('result-count');
    expect(count).not.toHaveTextContent('sản phẩm');
    // Chỉ khoảng trắng không-ngắt (U+00A0) mới tạo dòng; khoảng trắng thường sẽ sập về 0px.
    expect(count.textContent).toBe(' ');
    expect(screen.getByRole('button', { name: 'Bộ lọc (2)' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Đang lọc' });
    expect(parseFloat(group.style.paddingTop)).toBeGreaterThanOrEqual(4);
    expect(parseFloat(group.style.paddingBottom)).toBeGreaterThanOrEqual(4);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Tubu' }));
    expect(onPatch).toHaveBeenCalledWith({ brands: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Còn hàng' }));
    expect(onPatch).toHaveBeenLastCalledWith({ inStock: false });
  });

  it('không có chip → không dựng nhóm "Đang lọc"; không có cờ → không có câu báo', () => {
    render(<ResultHeader {...base} />);
    expect(screen.queryByRole('group', { name: 'Đang lọc' })).toBeNull();
    expect(screen.queryByText(/Bộ lọc nâng cao chưa dùng được/)).toBeNull();
  });

  it('API cũ bỏ qua bộ lọc → câu báo nhẹ', () => {
    render(<ResultHeader {...base} filtersIgnored />);
    expect(screen.getByText(/Bộ lọc nâng cao chưa dùng được/)).toBeInTheDocument();
  });
});
