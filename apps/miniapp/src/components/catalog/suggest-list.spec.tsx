import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Baby, SprayCan } from 'lucide-react';
import type { ProductSuggestion } from '../../services/shop-api';
import { SUGGEST_LIMITS, SuggestList } from './suggest-list';

const CATS = [
  { kind: 'segment' as const, key: 'mom_baby', label: 'Cho mẹ & bé', icon: Baby },
  { kind: 'segment' as const, key: 'home_clean', label: 'Nhà bếp xanh', icon: SprayCan },
];
const PRODUCTS: ProductSuggestion[] = [
  { slug: 'nrc', name: 'Nước rửa chén Tubu', thumbnail: null, basePrice: 65000 },
  { slug: 'nrbs', name: 'Nước rửa bình sữa', thumbnail: null, basePrice: 90000 },
];
const FIRST: ProductSuggestion = { slug: 'nrc', name: 'Nước rửa chén Tubu', thumbnail: null, basePrice: 65000 };
function renderList(over: Partial<Parameters<typeof SuggestList>[0]> = {}) {
  const props = {
    draft: '', recent: ['nước rửa', 'xà phòng'], categories: CATS, products: [], loading: false,
    onPickKeyword: vi.fn(), onPickCategory: vi.fn(), onPickProduct: vi.fn(), onClearRecent: vi.fn(), ...over,
  };
  const view = render(<SuggestList {...props} />);
  return { ...props, container: view.container };
}

describe('SuggestList', () => {
  it('chưa gõ → toàn bộ "Tìm gần đây"; nút xoá lịch sử nằm ở đầu nhóm (trước các từ khoá); chạm từ khoá → onPickKeyword', () => {
    const p = renderList();
    const recent = screen.getByRole('group', { name: 'Tìm gần đây' });
    // Thứ tự DOM thật: tiêu đề nhóm + nút "Xoá lịch sử tìm" rồi mới tới các từ khoá.
    expect(within(recent).getAllByRole('button').map((b) => b.textContent)).toEqual(['Xoá lịch sử tìm', 'nước rửa', 'xà phòng']);
    fireEvent.click(screen.getByRole('button', { name: 'xà phòng' }));
    expect(p.onPickKeyword).toHaveBeenCalledWith('xà phòng');
    fireEvent.click(screen.getByRole('button', { name: 'Xoá lịch sử tìm' }));
    expect(p.onClearRecent).toHaveBeenCalledTimes(1);
  });

  it('chưa gõ và chưa có lịch sử → không vẽ gì (không có khung rỗng)', () => {
    const { container } = renderList({ recent: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('chưa gõ → không hiện nhóm Danh mục / Sản phẩm', () => {
    renderList({ products: PRODUCTS });
    expect(screen.queryByRole('group', { name: 'Danh mục' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Sản phẩm' })).toBeNull();
  });

  it('gõ không dấu → dòng "Tìm “…”", từ khoá gần đây + danh mục khớp không dấu, sản phẩm gợi ý theo thứ tự', () => {
    const p = renderList({ draft: 'nuoc', products: PRODUCTS, recent: ['nước rửa', 'xà phòng'] });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm “nuoc”' }));
    expect(p.onPickKeyword).toHaveBeenCalledWith('nuoc');
    const recent = within(screen.getByRole('group', { name: 'Tìm gần đây' }));
    expect(recent.getAllByRole('button').map((b) => b.textContent)).toEqual(['nước rửa']);
    expect(recent.queryByRole('button', { name: 'Xoá lịch sử tìm' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Danh mục' })).toBeNull();
    const products = within(screen.getByRole('group', { name: 'Sản phẩm' })).getAllByRole('button');
    expect(products.map((b) => b.textContent)).toEqual(['Nước rửa chén Tubu65.000đ', 'Nước rửa bình sữa90.000đ']);
    fireEvent.click(screen.getByRole('button', { name: /Nước rửa bình sữa/ }));
    expect(p.onPickProduct).toHaveBeenCalledWith(PRODUCTS[1], 1);
  });

  it('danh mục khớp không dấu → chạm → onPickCategory', () => {
    const p = renderList({ draft: 'bep', recent: [] });
    fireEvent.click(within(screen.getByRole('group', { name: 'Danh mục' })).getByRole('button', { name: 'Nhà bếp xanh' }));
    expect(p.onPickCategory).toHaveBeenCalledWith(CATS[1]);
  });

  it('mọi dòng là <button type="button"> thật (Tab / Enter / Space dùng được); ảnh sản phẩm trang trí alt=""', () => {
    renderList({
      draft: 'nuoc', products: [{ ...FIRST, thumbnail: 'https://cdn.test/a.jpg' }], recent: ['nước rửa'],
      categories: [{ kind: 'category', key: 'c1', label: 'Nước giặt', icon: SprayCan }],
    });
    const rows = screen.getAllByRole('button');
    expect(rows.map((b) => b.textContent)).toEqual(['Tìm “nuoc”', 'nước rửa', 'Nước giặt', 'Nước rửa chén Tubu65.000đ']);
    for (const b of rows) {
      expect(b.tagName).toBe('BUTTON');
      expect(b).toHaveAttribute('type', 'button');
    }
    const imgs = document.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('alt', '');
  });

  it('tên sản phẩm là dữ liệu: ký tự HTML được hiện nguyên văn, không thành phần tử', () => {
    const evil: ProductSuggestion = { slug: 'x', name: '<img src=x onerror=alert(1)> Nước', thumbnail: null, basePrice: 1000 };
    const { container } = renderList({ draft: 'nuoc', products: [evil], recent: [] });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: /<img src=x onerror=alert\(1\)> Nước/ })).toBeInTheDocument();
  });

  it(`giới hạn: tối đa ${SUGGEST_LIMITS.recent} từ khoá gần đây và ${SUGGEST_LIMITS.categories} danh mục khi gõ`, () => {
    const recent = ['nước 1', 'nước 2', 'nước 3', 'nước 4', 'nước 5'];
    const categories = Array.from({ length: 6 }, (_, i) => ({ kind: 'category' as const, key: `c${i}`, label: `Nước loại ${i}`, icon: Baby }));
    renderList({ draft: 'nuoc', recent, categories });
    expect(within(screen.getByRole('group', { name: 'Tìm gần đây' })).getAllByRole('button')).toHaveLength(SUGGEST_LIMITS.recent);
    expect(within(screen.getByRole('group', { name: 'Danh mục' })).getAllByRole('button')).toHaveLength(SUGGEST_LIMITS.categories);
  });

  it('tên dài không làm vỡ dòng: nhãn bị cắt (ellipsis) trong vùng min-width:0', () => {
    renderList({ draft: 'nuoc', recent: [], products: [{ ...FIRST, name: 'Nước rửa chén '.repeat(20) }] });
    const label = screen.getByText(/Nước rửa chén Nước rửa chén/);
    expect(label).toHaveStyle({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  });

  it('không có gợi ý nào (≥2 ký tự) nhưng đang tải → chưa hiện câu "Chưa có gợi ý"', () => {
    renderList({ draft: 'zzz', recent: [], loading: true });
    expect(screen.queryByText(/Chưa có gợi ý/)).toBeNull();
  });

  it('không có gợi ý, đã tải xong → câu hướng dẫn', () => {
    renderList({ draft: 'zzz', recent: [] });
    expect(screen.getByText('Chưa có gợi ý — nhấn Tìm để xem kết quả')).toBeInTheDocument();
  });

  it('mới gõ 1 ký tự → chưa có câu "Chưa có gợi ý" (chưa đủ 2 ký tự để gợi ý)', () => {
    renderList({ draft: 'z', recent: [] });
    expect(screen.queryByText(/Chưa có gợi ý/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Tìm “z”' })).toBeInTheDocument();
  });
});
