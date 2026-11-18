import { describe, expect, it } from 'vitest';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { addPins, draftFromPin, draftIssues, isDirty, movePin, previewCards, removePin, toPinInputs, updatePin, type DraftPin } from './editor';

// Thẻ rút gọn: các hàm ở đây chỉ đọc `id` của thẻ, dựng đủ ProductCard chỉ làm test dài thêm.
const card = (id: string) => ({ id, slug: id, name: id }) as unknown as ProductCard;
const pin = (id: string, over: Partial<DraftPin> = {}): DraftPin => ({
  productId: id,
  name: `Món ${id}`,
  brand: 'Tubu',
  thumbnail: `https://img/${id}.jpg`,
  warnings: [],
  card: card(id),
  startsLocal: '',
  endsLocal: '',
  note: '',
  ...over,
});
const ids = (l: readonly DraftPin[]) => l.map((p) => p.productId);

describe('addPins', () => {
  it('thêm vào cuối, bỏ món đã có, dừng ở trần', () => {
    const r = addPins([pin('a')], [pin('a'), pin('b'), pin('c'), pin('d')], 3);
    expect(ids(r.list)).toEqual(['a', 'b', 'c']);
    expect(r).toMatchObject({ added: 2, skipped: 2 });
  });
});

describe('movePin', () => {
  it('đưa món tới vị trí mới, kẹp trong danh sách, không đổi mảng gốc', () => {
    const l = ['a', 'b', 'c', 'd'];
    expect(movePin(l, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(movePin(l, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(movePin(l, 1, 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(movePin(l, 1, -5)).toEqual(['b', 'a', 'c', 'd']);
    expect(movePin(l, 7, 0)).toEqual(l);
    expect(l).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('removePin / updatePin', () => {
  it('gỡ đúng món; sửa giờ/ghi chú đúng món', () => {
    expect(ids(removePin([pin('a'), pin('b')], 'a'))).toEqual(['b']);
    const u = updatePin([pin('a'), pin('b')], 'b', { note: 'Tết' });
    expect(u.map((p) => p.note)).toEqual(['', 'Tết']);
  });
});

describe('draftFromPin / toPinInputs: giờ hiệu lực theo giờ Việt Nam', () => {
  it('ISO máy chủ hiện thành giờ VN; gửi lại đúng ISO; rỗng là null; ghi chú cắt trắng, rỗng là null', () => {
    const d = draftFromPin({
      productId: 'a',
      name: 'A',
      brand: 'B',
      slug: 'a',
      thumbnail: null,
      warnings: [],
      card: null,
      position: 0,
      startsAt: '2026-11-18T01:00:00.000Z',
      endsAt: null,
      note: null,
      live: false,
    });
    expect(d).toMatchObject({ startsLocal: '2026-11-18T08:00', endsLocal: '', note: '' });
    expect(toPinInputs([{ ...d, note: '  khai trương  ' }, pin('b', { note: '   ' })])).toEqual([
      { productId: 'a', startsAt: '2026-11-18T01:00:00.000Z', endsAt: null, note: 'khai trương' },
      { productId: 'b', startsAt: null, endsAt: null, note: null },
    ]);
  });
});

describe('draftIssues', () => {
  it('chặn lưu: chưa có ảnh, giờ gõ dở, kết thúc không sau bắt đầu; món hợp lệ không báo', () => {
    const issues = draftIssues([
      pin('ok', { startsLocal: '2026-11-18T08:00', endsLocal: '2026-11-19T08:00' }),
      pin('img', { warnings: ['NO_IMAGE'] }),
      pin('half', { startsLocal: '2026-11-18' }),
      pin('back', { startsLocal: '2026-11-18T08:00', endsLocal: '2026-11-18T08:00' }),
      pin('soft', { warnings: ['NO_SHORT_DESC', 'OUT_OF_STOCK'] }),
    ]);
    expect(issues.map((i) => i.productId)).toEqual(['img', 'half', 'back']);
    expect(issues[0]!.text).toContain('chưa có ảnh');
    expect(issues[2]!.text).toContain('giờ kết thúc phải sau giờ bắt đầu');
  });
});

describe('isDirty', () => {
  it('đổi thứ tự, giờ, ghi chú là có thay đổi; khoảng trắng thừa ở ghi chú thì không', () => {
    const saved = [pin('a'), pin('b')];
    expect(isDirty([pin('a'), pin('b')], saved)).toBe(false);
    expect(isDirty([pin('b'), pin('a')], saved)).toBe(true);
    expect(isDirty([pin('a', { endsLocal: '2026-11-19T08:00' }), pin('b')], saved)).toBe(true);
    expect(isDirty([pin('a', { note: '  ' }), pin('b')], saved)).toBe(false);
  });
});

describe('previewCards', () => {
  it('chỉ món khách thấy lúc này: có thẻ, không ẩn/hết hàng/không ảnh/ngoài danh mục, trong khung giờ', () => {
    const now = Date.parse('2026-11-18T03:00:00.000Z');
    const out = previewCards(
      [
        pin('a'),
        pin('hidden', { warnings: ['NOT_ON_SALE'] }),
        pin('oos', { warnings: ['OUT_OF_STOCK'] }),
        pin('outside', { warnings: ['OUTSIDE_CATEGORY'] }),
        pin('soft', { warnings: ['NO_SHORT_DESC'] }),
        pin('nocard', { card: null }),
        pin('future', { startsLocal: '2026-11-18T11:00' }),
        pin('ended', { endsLocal: '2026-11-18T10:00' }),
        pin('window', { startsLocal: '2026-11-18T09:00', endsLocal: '2026-11-18T11:00' }),
      ],
      now,
    );
    expect(out.map((c) => c.id)).toEqual(['a', 'soft', 'window']);
  });
});
