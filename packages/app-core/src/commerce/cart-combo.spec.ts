import { describe, expect, it } from 'vitest';
import type { CartComboGroup } from '@tubutree/shared-types';
import { cartComboBlocks, comboHeadingText, comboRemovalNotice } from './cart-combo';

const L = (id: string) => ({ id, name: `Dòng ${id}` });
const fuwa: CartComboGroup = { id: 'bundle:b1', kind: 'BUNDLE_PCT', title: 'Bộ giặt sạch Fuwa3e', discount: 65_250, lineIds: ['i1', 'i2'], keyLineIds: ['i1', 'i2'] };
const lines = [L('i1'), L('i2'), L('i3')];

describe('cartComboBlocks: chia dòng giỏ thành khối combo + dòng lẻ', () => {
  it('hai dòng của bộ vào một khối có tên và khoản tiết kiệm, dòng còn lại là dòng lẻ', () => {
    const { blocks, loose } = cartComboBlocks(lines, [fuwa]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.lines.map((l) => l.id)).toEqual(['i1', 'i2']);
    expect(loose.map((l) => l.id)).toEqual(['i3']);
    expect(blocks[0]).toMatchObject({ group: fuwa, applied: true, title: 'Combo: Bộ giặt sạch Fuwa3e', saving: 'Tiết kiệm 65.250đ', hint: null });
    expect(comboHeadingText(blocks[0]!)).toBe('Combo: Bộ giặt sạch Fuwa3e · Tiết kiệm 65.250đ');
  });

  it('thứ tự khối theo dòng đầu tiên của bộ trong giỏ; dòng trong khối theo thứ tự giỏ', () => {
    const b2: CartComboGroup = { ...fuwa, id: 'bundle:b2', title: 'Bộ hai', lineIds: ['i3', 'i4'], keyLineIds: ['i3', 'i4'], discount: 1_000 };
    const out = cartComboBlocks([L('i4'), L('i1'), L('i3'), L('i2')], [fuwa, b2]);
    expect(out.blocks.map((b) => [b.group.id, b.lines.map((l) => l.id)])).toEqual([
      ['bundle:b2', ['i4', 'i3']],
      ['bundle:b1', ['i1', 'i2']],
    ]);
    expect(out.loose).toEqual([]);
  });

  it('bỏ chọn một dòng khoá: bộ không còn giảm khi thanh toán phần chọn, đầu nhóm không ghi Tiết kiệm mà nhắc chọn đủ', () => {
    const { blocks } = cartComboBlocks(lines, [fuwa], new Set(['i1']));
    expect(blocks[0]).toMatchObject({ applied: false, saving: null, hint: 'Chọn đủ các món để được giảm 65.250đ' });
    expect(comboHeadingText(blocks[0]!)).toBe('Combo: Bộ giặt sạch Fuwa3e');
  });

  it('bỏ chọn một dòng không khoá (mục có hai phân loại): bộ vẫn áp', () => {
    const g: CartComboGroup = { ...fuwa, lineIds: ['i1', 'i2', 'i3'], keyLineIds: ['i1'] };
    expect(cartComboBlocks(lines, [g], new Set(['i3'])).blocks[0]).toMatchObject({ applied: true, hint: null });
  });

  it('một dòng thuộc hai nhóm chỉ ở nhóm đứng trước: mỗi dòng đúng một chỗ, khối thiếu dòng không ghi Tiết kiệm', () => {
    const b2: CartComboGroup = { ...fuwa, id: 'bundle:b2', title: 'Bộ hai', lineIds: ['i2', 'i3'], keyLineIds: ['i2', 'i3'], discount: 2_000 };
    const { blocks, loose } = cartComboBlocks(lines, [fuwa, b2]);
    const all = [...blocks.flatMap((b) => b.lines.map((l) => l.id)), ...loose.map((l) => l.id)].sort();
    expect(all).toEqual(['i1', 'i2', 'i3']);
    expect(blocks.map((b) => [b.group.id, b.lines.map((l) => l.id), b.saving])).toEqual([
      ['bundle:b1', ['i1', 'i2'], 'Tiết kiệm 65.250đ'],
      ['bundle:b2', ['i3'], null],
    ]);
  });

  it('API cũ chưa có comboGroups hoặc rỗng: mọi dòng là dòng lẻ, giữ nguyên thứ tự', () => {
    expect(cartComboBlocks(lines, undefined)).toEqual({ blocks: [], loose: lines });
    expect(cartComboBlocks(lines, [])).toEqual({ blocks: [], loose: lines });
  });

  it('nhóm không còn dòng nào trong danh sách (ở nơi giao khác) bị bỏ; nhóm thiếu một dòng trong danh sách không ghi Tiết kiệm', () => {
    expect(cartComboBlocks([L('i3')], [fuwa])).toEqual({ blocks: [], loose: [L('i3')] });
    const part = cartComboBlocks([L('i1'), L('i3')], [fuwa]).blocks[0]!;
    expect(part).toMatchObject({ saving: null, applied: true });
    expect(part.lines.map((l) => l.id)).toEqual(['i1']);
  });
});

describe('comboRemovalNotice: báo trước khi bỏ món làm bộ mất giảm', () => {
  it('xoá một dòng khoá: nói bộ nào mất bao nhiêu, kèm hai nút', () => {
    expect(comboRemovalNotice([fuwa], 'i1')).toEqual({
      title: 'Bỏ món khỏi combo?',
      message: 'Combo Bộ giặt sạch Fuwa3e sẽ mất giảm 65.250đ nếu bạn bỏ món này.',
      confirmLabel: 'Vẫn bỏ',
      keepLabel: 'Giữ lại',
      discount: 65_250,
    });
  });

  it('dòng lẻ, hoặc không có nhóm: không báo', () => {
    expect(comboRemovalNotice([fuwa], 'i3')).toBeNull();
    expect(comboRemovalNotice(undefined, 'i1')).toBeNull();
    expect(comboRemovalNotice([], 'i1')).toBeNull();
  });

  it('dòng khoá nhưng không mang khoản giảm (sản phẩm chính của mua kèm): vẫn báo', () => {
    const addon: CartComboGroup = { id: 'bundle:a1', kind: 'ADDON', title: 'Mua kèm nước giặt', discount: 11_000, lineIds: ['i2'], keyLineIds: ['i1'] };
    expect(comboRemovalNotice([addon], 'i1')).toMatchObject({ discount: 11_000, message: 'Combo Mua kèm nước giặt sẽ mất giảm 11.000đ nếu bạn bỏ món này.' });
    expect(comboRemovalNotice([addon], 'i2')).toBeNull();
  });

  it('giảm số lượng còn từ 1 trở lên không làm bộ mất khớp: không báo; về 0 thì báo như xoá', () => {
    expect(comboRemovalNotice([fuwa], 'i1', 1)).toBeNull();
    expect(comboRemovalNotice([fuwa], 'i1', 2)).toBeNull();
    expect(comboRemovalNotice([fuwa], 'i1', 0)).not.toBeNull();
  });

  it('dòng khoá của hai nhóm: cộng khoản giảm, nối tên', () => {
    const b2: CartComboGroup = { ...fuwa, id: 'bundle:b2', title: 'Bộ hai', discount: 2_000, lineIds: ['i3'], keyLineIds: ['i2', 'i3'] };
    expect(comboRemovalNotice([fuwa, b2], 'i2')).toMatchObject({ discount: 67_250, message: 'Combo Bộ giặt sạch Fuwa3e, Bộ hai sẽ mất giảm 67.250đ nếu bạn bỏ món này.' });
  });
});
