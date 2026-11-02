import { describe, expect, it } from 'vitest';
import type { CartComboGroup } from '@tubutree/shared-types';
import { cartComboBlocks, comboHeadingText, comboRemovalNotice, comboSavingPending } from './cart-combo';

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

  describe('mua kèm (ADDON): sản phẩm chính là dòng khoá không mang giảm, vẫn nằm trong khối của bộ', () => {
    const addon: CartComboGroup = { id: 'bundle:a1', kind: 'ADDON', title: 'Mua kèm nước giặt', discount: 11_000, lineIds: ['i2'], keyLineIds: ['i1'] };

    it('sản phẩm chính vào khối cùng món kèm (không vẽ lẻ bên dưới), đầu nhóm ghi số tiết kiệm, thứ tự theo giỏ', () => {
      const { blocks, loose } = cartComboBlocks(lines, [addon]);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.lines.map((l) => l.id)).toEqual(['i1', 'i2']);
      expect(loose.map((l) => l.id)).toEqual(['i3']);
      expect(comboHeadingText(blocks[0]!)).toBe('Combo: Mua kèm nước giặt · Tiết kiệm 11.000đ');
    });

    it('dòng khoá không mang giảm mà khách bấm xoá là dòng nằm trong khối (hộp báo không hỏi về một món "lẻ")', () => {
      const { blocks } = cartComboBlocks(lines, [addon]);
      const inBlock = new Set(blocks.flatMap((b) => b.lines.map((l) => l.id)));
      expect(comboRemovalNotice([addon], 'i1')).not.toBeNull();
      expect(inBlock.has('i1')).toBe(true);
    });

    it('nơi giao không có món kèm (chỉ có sản phẩm chính): không dựng khối rỗng đầu nhóm, sản phẩm chính là dòng lẻ', () => {
      expect(cartComboBlocks([L('i1'), L('i3')], [addon])).toEqual({ blocks: [], loose: [L('i1'), L('i3')] });
    });

    it('dòng khoá đã thuộc nhóm khác vì mang giảm ở nhóm đó: ở lại nhóm kia, mỗi dòng đúng một chỗ', () => {
      const bundle: CartComboGroup = { ...fuwa, lineIds: ['i1', 'i3'], keyLineIds: ['i1', 'i3'], discount: 5_000 };
      const { blocks, loose } = cartComboBlocks(lines, [addon, bundle]);
      const placed = [...blocks.flatMap((b) => b.lines.map((l) => l.id)), ...loose.map((l) => l.id)].sort();
      expect(placed).toEqual(['i1', 'i2', 'i3']);
      expect(blocks.find((b) => b.group.id === 'bundle:b1')!.lines.map((l) => l.id)).toEqual(['i1', 'i3']);
      expect(blocks.find((b) => b.group.id === 'bundle:a1')!.lines.map((l) => l.id)).toEqual(['i2']);
    });
  });

  describe('giá phần chọn của máy chủ (selection) là nguồn của applied và số Tiết kiệm khi chỉ chọn một phần giỏ', () => {
    it('máy chủ không còn nhóm này trong phần chọn (bỏ chọn hết các phân loại của một sản phẩm không phải dòng khoá): không ghi Tiết kiệm, nhắc chọn đủ', () => {
      const g: CartComboGroup = { id: 'collection:c1', kind: 'STOREFRONT', title: 'Bộ hai', discount: 20_000, lineIds: ['i1', 'i2a', 'i2b'], keyLineIds: ['i1'] };
      const rows = [L('i1'), L('i2a'), L('i2b')];
      const deselected = new Set(['i2a', 'i2b']);
      expect(cartComboBlocks(rows, [g], deselected).blocks[0]).toMatchObject({ applied: true, saving: 'Tiết kiệm 20.000đ' });
      const out = cartComboBlocks(rows, [g], deselected, []).blocks[0]!;
      expect(out).toMatchObject({ applied: false, saving: null, hint: 'Chọn đủ các món để được giảm 20.000đ' });
      expect(comboHeadingText(out)).toBe('Combo: Bộ hai');
    });

    it('máy chủ còn nhóm nhưng giảm ít hơn (bỏ chọn một phân loại không phải dòng khoá): đầu nhóm ghi số của phần chọn, khớp dòng ở chân', () => {
      const g: CartComboGroup = { ...fuwa, lineIds: ['i1', 'i2', 'i3'], keyLineIds: ['i1'], discount: 30_000 };
      const out = cartComboBlocks(lines, [g], new Set(['i3']), [{ ...g, discount: 20_000, lineIds: ['i1', 'i2'] }]).blocks[0]!;
      expect(out).toMatchObject({ applied: true, saving: 'Tiết kiệm 20.000đ', hint: null });
    });

    it('chưa có giá phần chọn (selection null/undefined): dùng luật khoá như trước', () => {
      expect(cartComboBlocks(lines, [fuwa], new Set(['i1']), null).blocks[0]).toMatchObject({ applied: false, saving: null });
      expect(cartComboBlocks(lines, [fuwa], new Set(), undefined).blocks[0]).toMatchObject({ applied: true, saving: 'Tiết kiệm 65.250đ' });
    });
  });

  describe('giỏ vừa sửa ở máy khách, chờ máy chủ tính lại (pending): số của nhóm là số lần trước', () => {
    it('giữ chỗ của số (saving vẫn có chữ, savingPending) nhưng chữ đọc của đầu nhóm không ghi số cũ: đầu nhóm không đổi số dòng khi chờ', () => {
      const idle = cartComboBlocks(lines, [fuwa]).blocks[0]!;
      const waiting = cartComboBlocks(lines, [fuwa], new Set(), null, true).blocks[0]!;
      expect(idle).toMatchObject({ saving: 'Tiết kiệm 65.250đ', savingPending: false });
      expect(waiting).toMatchObject({ saving: 'Tiết kiệm 65.250đ', savingPending: true, applied: true });
      expect(comboHeadingText(waiting)).toBe('Combo: Bộ giặt sạch Fuwa3e');
      expect(comboHeadingText(idle)).toBe('Combo: Bộ giặt sạch Fuwa3e · Tiết kiệm 65.250đ');
    });

    it('khối không ghi số (bộ không áp) thì không có gì chờ: savingPending false', () => {
      expect(cartComboBlocks(lines, [fuwa], new Set(['i1']), null, true).blocks[0]).toMatchObject({ saving: null, savingPending: false });
    });

    it('nhóm số 0 (dữ liệu lạ): không ghi "Tiết kiệm 0đ", không nhắc "được giảm 0đ"', () => {
      const zero: CartComboGroup = { ...fuwa, discount: 0 };
      expect(cartComboBlocks(lines, [zero]).blocks[0]).toMatchObject({ saving: null, savingPending: false, hint: null });
      expect(cartComboBlocks(lines, [zero], new Set(['i1'])).blocks[0]).toMatchObject({ applied: false, saving: null, hint: null });
      expect(comboRemovalNotice([zero], 'i1')).toBeNull();
    });

    it('vẫn báo "mất giảm" bằng số lần trước khi khách bỏ món khoá trong lúc lần sửa trước còn bay', () => {
      expect(comboRemovalNotice([fuwa], 'i1')).toMatchObject({ discount: 65_250 });
    });
  });

  describe('hai bộ chung món, chọn một phần giỏ: đầu nhóm cộng đúng dòng "Giảm giá combo" ở chân', () => {
    // Bộ A 20% gồm P1, P2, P3; bộ B 10% gồm P1, P2. Giỏ đầy đủ: A lấy cả ba dòng. Bỏ chọn P3 (dòng khoá của A): A hết khớp, máy chủ trả bộ B cho P1 + P2.
    const A: CartComboGroup = { id: 'collection:a', kind: 'STOREFRONT', title: 'Bộ A', discount: 30_000, lineIds: ['p1', 'p2', 'p3'], keyLineIds: ['p1', 'p2', 'p3'] };
    const B: CartComboGroup = { id: 'collection:b', kind: 'STOREFRONT', title: 'Bộ B', discount: 10_000, lineIds: ['p1', 'p2'], keyLineIds: ['p1', 'p2'] };
    const rows = [L('p1'), L('p2'), L('p3')];
    const deselected = new Set(['p3']);
    const sum = (blocks: { saving: string | null }[]) =>
      blocks.reduce((s, b) => s + (b.saving ? Number(b.saving.replace(/\D/g, '')) : 0), 0);

    for (const [name, groups] of [
      ['giỏ đầy đủ chỉ trả bộ A', [A]],
      ['giỏ đầy đủ trả cả hai bộ (bộ B không có dòng nào để giữ)', [A, B]],
    ] as const) {
      it(`${name}: bộ B có khối riêng với số của phần chọn, bộ A giữ dòng bỏ chọn và nhắc chọn đủ; tổng đầu nhóm = số ở chân`, () => {
        const { blocks, loose } = cartComboBlocks(rows, groups, deselected, [B]);
        expect(blocks.map((b) => [b.group.id, b.lines.map((l) => l.id), b.saving, b.hint])).toEqual([
          ['collection:b', ['p1', 'p2'], 'Tiết kiệm 10.000đ', null],
          ['collection:a', ['p3'], null, 'Chọn đủ các món để được giảm 30.000đ'],
        ]);
        expect(loose).toEqual([]);
        expect(sum(blocks)).toBe(B.discount);
        const placed = [...blocks.flatMap((b) => b.lines.map((l) => l.id)), ...loose.map((l) => l.id)].sort();
        expect(placed).toEqual(['p1', 'p2', 'p3']);
      });
    }

    it('chọn cả giỏ (máy chủ trả bộ A): vẫn bộ A giữ cả ba dòng, không có khối B', () => {
      const { blocks } = cartComboBlocks(rows, [A], new Set(), [A]);
      expect(blocks.map((b) => [b.group.id, b.lines.map((l) => l.id), b.saving])).toEqual([['collection:a', ['p1', 'p2', 'p3'], 'Tiết kiệm 30.000đ']]);
    });

    it('máy chủ không trả nhóm nào cho phần chọn: không dựng khối thêm, bộ A nhắc chọn đủ', () => {
      const { blocks } = cartComboBlocks(rows, [A], deselected, []);
      expect(blocks.map((b) => [b.group.id, b.lines.map((l) => l.id), b.saving])).toEqual([['collection:a', ['p1', 'p2', 'p3'], null]]);
    });
  });
});

describe('comboSavingPending: số đầu nhóm chỉ đúng khi chọn cả giỏ hoặc máy chủ đã trả giá phần chọn', () => {
  it.each([
    ['chọn cả giỏ, giỏ không vừa sửa', { partial: false, priced: false }, false],
    ['chọn cả giỏ, giỏ vừa sửa ở máy khách', { editing: true, partial: false, priced: false }, true],
    ['chọn một phần, chưa có giá phần chọn (debounce, đang tải, refetch, lỗi)', { partial: true, priced: false }, true],
    ['chọn một phần, máy chủ đã trả giá đúng phần chọn', { partial: true, priced: true }, false],
    ['chọn một phần, đã có giá nhưng giỏ vừa sửa ở máy khách', { editing: true, partial: true, priced: true }, true],
  ] as const)('%s', (_name, input, expected) => {
    expect(comboSavingPending(input)).toBe(expected);
  });

  it('nối với cartComboBlocks: chọn một phần chưa có giá thì khối giữ chỗ của số, không đưa số cả giỏ vào chữ đọc', () => {
    // Bỏ chọn dòng không phải dòng khoá: luật khoá vẫn nói bộ áp, nên số của cả giỏ là thứ duy nhất có thể hiện nhầm.
    const group: CartComboGroup = { ...fuwa, keyLineIds: ['i1'] };
    const pending = comboSavingPending({ partial: true, priced: false });
    const block = cartComboBlocks(lines, [group], new Set(['i2']), null, pending).blocks[0]!;
    expect(block).toMatchObject({ applied: true, saving: 'Tiết kiệm 65.250đ', savingPending: true });
    expect(comboHeadingText(block)).toBe('Combo: Bộ giặt sạch Fuwa3e');
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
