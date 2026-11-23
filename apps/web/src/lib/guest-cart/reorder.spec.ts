// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { GuestReorderDTO } from '@tubutree/shared-types';
import { GUEST_CART_MAX_LINES, readGuestCart } from './store';
import { GUEST_CART_KEY } from '../guest-prebuilt';
import { GUEST_REORDER_NOTE_KEY, addReorderLines, saveGuestReorderNote, takeGuestReorderNote } from './reorder';

const line = (id: string, quantity: number, maxQty: number, variationName: string | null = null) => ({
  variationId: id,
  slug: `sp-${id}`,
  quantity,
  maxQty,
  productName: `Món ${id}`,
  variationName,
});
const dto = (lines: GuestReorderDTO['lines'], skipped: GuestReorderDTO['skipped'] = []): GuestReorderDTO => ({ lines, skipped });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('addReorderLines', () => {
  it('thêm món vào giỏ khách, món máy chủ bỏ vào lời báo kèm lý do', () => {
    const out = addReorderLines(
      dto([line('v1', 2, 5, 'Chai 500ml')], [
        { productName: 'Xà phòng', variationName: '100g', reason: 'OUT_OF_STOCK' },
        { productName: 'Nước lau sàn', variationName: null, reason: 'INACTIVE' },
      ]),
    );
    expect(out).toEqual({
      kind: 'added',
      note: { skipped: [{ name: 'Xà phòng (100g)', reason: 'OUT_OF_STOCK' }, { name: 'Nước lau sàn', reason: 'INACTIVE' }] },
    });
    expect(readGuestCart().map((l) => [l.variationId, l.quantity])).toEqual([['v1', 2]]);
  });

  it('cộng dồn món đã có nhưng kẹp theo tồn máy chủ báo; đã đủ số hàng còn thì vẫn tính là đã có, không báo bỏ', () => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify([{ variationId: 'v1', slug: 'sp-v1', quantity: 2, addedAt: 1 }, { variationId: 'v2', slug: 'sp-v2', quantity: 3, addedAt: 1 }]));
    const out = addReorderLines(dto([line('v1', 2, 3), line('v2', 1, 3)]));
    expect(out).toEqual({ kind: 'added', note: null });
    expect(readGuestCart().map((l) => [l.variationId, l.quantity])).toEqual([['v1', 3], ['v2', 3]]);
  });

  it('giỏ khách đủ 30 dòng: món mới vào lời báo "chưa thêm được"; không món nào vào giỏ thì kind none', () => {
    localStorage.setItem(
      GUEST_CART_KEY,
      JSON.stringify(Array.from({ length: GUEST_CART_MAX_LINES }, (_, i) => ({ variationId: `x${i}`, slug: `x-${i}`, quantity: 1, addedAt: 1 }))),
    );
    expect(addReorderLines(dto([line('v9', 1, 5)]))).toEqual({ kind: 'none', note: { skipped: [{ name: 'Món v9', reason: 'NOT_ADDED' }] } });
  });

  it('mọi món đều bị máy chủ bỏ: kind none với đủ danh sách, giỏ không đổi', () => {
    const out = addReorderLines(dto([], [{ productName: 'Xà phòng', variationName: null, reason: 'OUT_OF_STOCK' }]));
    expect(out).toEqual({ kind: 'none', note: { skipped: [{ name: 'Xà phòng', reason: 'OUT_OF_STOCK' }] } });
    expect(localStorage.getItem(GUEST_CART_KEY)).toBeNull();
  });
});

describe('lời báo mua lại (sessionStorage)', () => {
  it('ghi rồi đọc đúng một lần', () => {
    saveGuestReorderNote({ skipped: [{ name: 'Xà phòng', reason: 'OUT_OF_STOCK' }] }, 1_000);
    expect(takeGuestReorderNote(2_000)).toEqual({ skipped: [{ name: 'Xà phòng', reason: 'OUT_OF_STOCK' }] });
    expect(takeGuestReorderNote(2_000)).toBeNull();
  });

  it('quá 10 phút, giờ lùi, hỏng hay lý do lạ: null và xoá khỏi bộ nhớ', () => {
    saveGuestReorderNote({ skipped: [{ name: 'Xà phòng', reason: 'OUT_OF_STOCK' }] }, 0);
    expect(takeGuestReorderNote(10 * 60_000 + 1)).toBeNull();
    saveGuestReorderNote({ skipped: [{ name: 'Xà phòng', reason: 'OUT_OF_STOCK' }] }, 5_000);
    expect(takeGuestReorderNote(1_000)).toBeNull();
    sessionStorage.setItem(GUEST_REORDER_NOTE_KEY, '{oops');
    expect(takeGuestReorderNote()).toBeNull();
    expect(sessionStorage.getItem(GUEST_REORDER_NOTE_KEY)).toBeNull();
    sessionStorage.setItem(GUEST_REORDER_NOTE_KEY, JSON.stringify({ skipped: [{ name: 'A', reason: 'HACK' }, { name: ' ', reason: 'INACTIVE' }, { name: 'B', reason: 'INACTIVE' }], at: Date.now() }));
    expect(takeGuestReorderNote()).toEqual({ skipped: [{ name: 'B', reason: 'INACTIVE' }] });
  });
});
