import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProductSuggestion } from '../../services/shop-api';
import { vi as strings } from '../../i18n/vi';
import { SUGGEST_MIN_CHARS } from '../../hooks/use-suggest';

const mocks = vi.hoisted(() => ({ suggestProducts: vi.fn(), haptic: vi.fn() }));

vi.mock('../../services/shop-api', () => ({ suggestProducts: mocks.suggestProducts }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../../utils/use-debounced', () => ({ useDebounced: <T,>(v: T) => v }));

import { ProductPicker } from './product-picker';

const A: ProductSuggestion = { slug: 'nuoc-rua-chen', name: 'Nước rửa chén sinh học', thumbnail: 'https://img/a.jpg', basePrice: 89_000 };
const B: ProductSuggestion = { slug: 'xit-phong', name: 'Xịt phòng tinh dầu', thumbnail: null, basePrice: 120_000 };
const C: ProductSuggestion = { slug: 'tui-vai', name: 'Túi vải tái chế', thumbnail: null, basePrice: 45_000 };

function renderPicker(props: Partial<{ value: ProductSuggestion[]; onChange: (v: ProductSuggestion[]) => void; max: number }> = {}) {
  const onChange = props.onChange ?? vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProductPicker value={props.value ?? []} onChange={onChange} max={props.max} />
    </QueryClientProvider>,
  );
  return { onChange };
}

const search = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText('Tìm sản phẩm để gắn…'), { target: { value: text } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.suggestProducts.mockResolvedValue([A, B]);
});

describe('ProductPicker — hành vi giữ nguyên khi chuyển DS v2', () => {
  it('gõ từ khoá → gợi ý hiện tên và giá, bỏ sản phẩm đã chọn', async () => {
    renderPicker({ value: [B] });
    search('nước');
    expect(await screen.findByText('Nước rửa chén sinh học')).toBeInTheDocument();
    expect(screen.getByText('89.000đ')).toBeInTheDocument();
    expect(mocks.suggestProducts).toHaveBeenCalledWith('nước');
    expect(screen.queryByText('120.000đ')).toBeNull();
  });

  it('chọn một gợi ý → onChange nhận danh sách có thêm sản phẩm đó và ô tìm kiếm được xoá', async () => {
    const { onChange } = renderPicker({ value: [C] });
    search('nước');
    fireEvent.click(await screen.findByText('Nước rửa chén sinh học'));
    expect(onChange).toHaveBeenCalledWith([C, A]);
    expect(mocks.haptic).toHaveBeenCalledWith('light');
    expect(screen.getByPlaceholderText('Tìm sản phẩm để gắn…')).toHaveValue('');
  });

  it('đã đủ số sản phẩm tối đa → báo "Chỉ gắn tối đa 5 sản phẩm", không gọi onChange', async () => {
    const { onChange } = renderPicker({ value: [C], max: 1 });
    search('nước');
    fireEvent.click(await screen.findByText('Nước rửa chén sinh học'));
    expect(screen.getByText('Chỉ gắn tối đa 5 sản phẩm')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('nút Hủy trên chip gỡ đúng sản phẩm khỏi danh sách đã chọn', () => {
    const { onChange } = renderPicker({ value: [A, B] });
    const chip = screen.getByText('Xịt phòng tinh dầu').parentElement as HTMLElement;
    fireEvent.click(within(chip).getByRole('button', { name: 'Hủy' }));
    expect(onChange).toHaveBeenCalledWith([A]);
  });

  it('không có kết quả → báo không tìm thấy sản phẩm phù hợp', async () => {
    mocks.suggestProducts.mockResolvedValue([]);
    renderPicker();
    search('zzz');
    expect(await screen.findByText('Không tìm thấy sản phẩm phù hợp')).toBeInTheDocument();
  });
});

// /search/suggest trả [] cho từ khoá chưa đủ 2 ký tự (sau khi gấp dấu): gọi từ 1 ký tự chỉ cho ra "Không tìm thấy" sai.
describe('ProductPicker — chỉ gợi ý từ 2 ký tự', () => {
  const HINT = 'Nhập ít nhất 2 ký tự';

  it('1 ký tự → không gọi API, báo "Nhập ít nhất 2 ký tự" thay cho "Không tìm thấy"', async () => {
    renderPicker();
    search('n');
    expect(screen.getByText(HINT)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.suggestProducts).not.toHaveBeenCalled();
    expect(screen.queryByText('Không tìm thấy sản phẩm phù hợp')).toBeNull();
  });

  it('ký tự có dấu gấp về 1 ký tự ("đ" → "d") và khoảng trắng thừa cũng chưa đủ', async () => {
    renderPicker();
    search('đ');
    expect(screen.getByText(HINT)).toBeInTheDocument();
    search('  a  ');
    expect(screen.getByText(HINT)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.suggestProducts).not.toHaveBeenCalled();
  });

  it('gõ tới 2 ký tự → gọi API, gợi ý hiện, câu báo biến mất; xoá về 1 ký tự → gợi ý ẩn ngay', async () => {
    renderPicker();
    search('n');
    search('nư');
    expect(await screen.findByText('Nước rửa chén sinh học')).toBeInTheDocument();
    expect(mocks.suggestProducts).toHaveBeenCalledWith('nư');
    expect(screen.queryByText(HINT)).toBeNull();
    search('n');
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(screen.queryByText('Nước rửa chén sinh học')).toBeNull();
  });

  it('câu báo nói đúng ngưỡng của hook gợi ý', () => {
    expect(strings.common.suggestMinChars).toBe(`Nhập ít nhất ${SUGGEST_MIN_CHARS} ký tự`);
  });

  it('ô trống → không có câu báo nào', () => {
    renderPicker();
    expect(screen.queryByText(HINT)).toBeNull();
  });
});

describe('ProductPicker — vùng chạm, bàn phím (C-076)', () => {
  it('nút Hủy trên chip có vùng chạm tối thiểu 44x44', () => {
    renderPicker({ value: [A] });
    const btn = screen.getByRole('button', { name: 'Hủy' });
    expect(Number.parseFloat(btn.style.minWidth)).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('hàng gợi ý là nút thật, Tab tới được và Enter chọn sản phẩm', async () => {
    const { onChange } = renderPicker();
    search('nước');
    await screen.findByText('Nước rửa chén sinh học');
    const row = screen.getByText('Nước rửa chén sinh học').closest('[role="button"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.tabIndex).toBe(0);
    expect(Number.parseFloat(row.style.minHeight)).toBeGreaterThanOrEqual(44);
    fireEvent.keyDown(row, { key: 'Enter' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([A]));
  });
});
