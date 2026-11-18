import { describe, expect, it } from 'vitest';
import { COMBOBOX_CLOSED, comboboxKey, suggestOptions, type ComboboxState } from './combobox';

const open = (active: number): ComboboxState => ({ open: true, active });
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .trim();

describe('comboboxKey', () => {
  it('↓ mở hộp ở dòng đầu, xuống tiếp, hết thì vòng lên đầu', () => {
    expect(comboboxKey(COMBOBOX_CLOSED, 'ArrowDown', 3)).toEqual({ state: open(0), effect: 'none', preventDefault: true });
    expect(comboboxKey(open(0), 'ArrowDown', 3).state).toEqual(open(1));
    expect(comboboxKey(open(2), 'ArrowDown', 3).state).toEqual(open(0));
    expect(comboboxKey(COMBOBOX_CLOSED, 'ArrowDown', 0).state, 'hộp đóng chưa dựng dòng: vẫn chọn dòng đầu').toEqual(open(0));
    expect(comboboxKey(open(-1), 'ArrowDown', 0).state).toEqual(open(-1));
  });
  it('↑ lên dòng trước, chưa chọn hay ở đầu thì xuống cuối; hộp đóng thì để ô nhập tự xử lý', () => {
    expect(comboboxKey(open(2), 'ArrowUp', 3).state).toEqual(open(1));
    expect(comboboxKey(open(0), 'ArrowUp', 3).state).toEqual(open(2));
    expect(comboboxKey(open(-1), 'ArrowUp', 3).state).toEqual(open(2));
    expect(comboboxKey(COMBOBOX_CLOSED, 'ArrowUp', 3)).toEqual({ state: COMBOBOX_CLOSED, effect: 'none', preventDefault: false });
  });
  it('Enter mở dòng đang chọn; chưa chọn dòng nào thì để form gửi', () => {
    expect(comboboxKey(open(1), 'Enter', 3)).toEqual({ state: COMBOBOX_CLOSED, effect: 'pick', preventDefault: true });
    expect(comboboxKey(open(-1), 'Enter', 3)).toEqual({ state: COMBOBOX_CLOSED, effect: 'submit', preventDefault: false });
    expect(comboboxKey(open(5), 'Enter', 3).effect).toBe('submit');
  });
  it('Esc đóng (chặn mặc định), Esc khi đã đóng không làm gì; Tab đóng mà vẫn đi tiếp', () => {
    expect(comboboxKey(open(1), 'Escape', 3)).toEqual({ state: COMBOBOX_CLOSED, effect: 'close', preventDefault: true });
    expect(comboboxKey(COMBOBOX_CLOSED, 'Escape', 3)).toEqual({ state: COMBOBOX_CLOSED, effect: 'none', preventDefault: false });
    expect(comboboxKey(open(1), 'Tab', 3)).toEqual({ state: COMBOBOX_CLOSED, effect: 'close', preventDefault: false });
  });
  it('phím khác giữ nguyên', () => {
    expect(comboboxKey(open(1), 'a', 3)).toEqual({ state: open(1), effect: 'none', preventDefault: false });
  });
});

describe('suggestOptions', () => {
  const categories = [{ label: 'Giặt xả' }, { label: 'Nước giặt cho bé' }, { label: 'Rau củ' }];
  const products = [{ slug: 'a' }, { slug: 'b' }];
  it('đang gõ: Tìm … → từ gần đây khớp (≤3) → danh mục khớp (≤4) → sản phẩm', () => {
    const out = suggestOptions({ draft: ' giặt ', recent: ['nuoc giat', 'giat say', 'xa vai', 'giặt tay', 'GIAT 2'], popular: ['granola'], categories, products, fold });
    expect(out.map((o) => o.kind)).toEqual(['search', 'recent', 'recent', 'recent', 'category', 'category', 'product', 'product']);
    expect(out[0]).toEqual({ kind: 'search', term: 'giặt' });
    expect(out[6]).toEqual({ kind: 'product', product: { slug: 'a' }, index: 0 });
  });
  it('ô trống: mọi từ gần đây rồi cụm phổ biến, bỏ cụm trùng (so không dấu)', () => {
    const out = suggestOptions({ draft: '', recent: ['Nước giặt'], popular: ['nuoc giat', 'granola'], categories, products, fold });
    expect(out).toEqual([
      { kind: 'recent', term: 'Nước giặt' },
      { kind: 'popular', term: 'granola' },
    ]);
  });
});
