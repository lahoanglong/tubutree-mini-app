import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from '../shop-copy';
import {
  BUILDER_COPY,
  builderCopy,
  KIND_LABEL,
  LAYOUT_LABEL,
  SECTION_STYLES,
  clampComboPct,
  comboPctOutcome,
  isCustomerVisible,
  moveAnnouncement,
  moveBlockedAnnouncement,
  moveBlockReason,
  moveButtonLabel,
  newSectionDto,
  overflowSectionsNotice,
  parseComboPct,
  questStripView,
  sectionHref,
  sectionIdFromSearch,
  sectionCardView,
  sectionStyleOf,
  styleLockNote,
  styleOptions,
  suggestedSectionTitle,
  visibleCollection,
  type BuilderCollection,
} from './storefront-builder';

let seq = 0;
const item = (over: Partial<BuilderCollection['items'][number]> & { pid?: string; thumb?: string | null } = {}) => {
  const n = ++seq;
  return {
    isHidden: over.isHidden,
    hiddenReason: over.hiddenReason,
    product: { id: over.pid ?? `p${n}`, thumbnail: over.thumb === undefined ? `/img/${n}.jpg` : over.thumb },
  };
};
const col = (over: Partial<BuilderCollection> & { n?: number } = {}): BuilderCollection => ({
  id: over.id ?? `c${++seq}`,
  title: over.title ?? 'Bếp xanh',
  kind: over.kind ?? 'NORMAL',
  layout: over.layout ?? 'CAROUSEL',
  comboDiscountPct: over.comboDiscountPct ?? null,
  items: over.items ?? Array.from({ length: over.n ?? 4 }, () => item()),
});

describe('nhãn và kiểu khối', () => {
  it('thứ tự và chữ: Kệ ngang, Lưới, Danh sách, Combo', () => {
    expect(SECTION_STYLES).toEqual(['CAROUSEL', 'GRID', 'STACK', 'COMBO']);
    expect(LAYOUT_LABEL).toEqual({ CAROUSEL: 'Kệ ngang', GRID: 'Lưới', STACK: 'Danh sách' });
    expect(KIND_LABEL).toEqual({ NORMAL: 'Thường', COMBO: 'Combo' });
  });

  it('sectionStyleOf: COMBO thắng layout, layout lạ rơi về lưới', () => {
    expect(sectionStyleOf({ kind: 'COMBO', layout: 'GRID' })).toBe('COMBO');
    expect(sectionStyleOf({ kind: 'NORMAL', layout: 'CAROUSEL' })).toBe('CAROUSEL');
    expect(sectionStyleOf({ kind: 'NORMAL', layout: 'MASONRY' })).toBe('GRID');
  });

  it('styleOptions: khối mới mở cả 4 ô; khối có sẵn khoá kiểu', () => {
    expect(styleOptions(null).map((o) => o.disabled)).toEqual([false, false, false, false]);
    const normal = styleOptions({ kind: 'NORMAL' });
    expect(normal.filter((o) => o.disabled).map((o) => o.style)).toEqual(['COMBO']);
    const combo = styleOptions({ kind: 'COMBO' });
    expect(combo.filter((o) => !o.disabled).map((o) => o.style)).toEqual(['COMBO']);
  });

  it('styleLockNote theo kind; kind lạ thì không có', () => {
    expect(styleLockNote('NORMAL')).toBe('Kiểu Combo chọn lúc tạo khối.');
    expect(styleLockNote('COMBO')).toBe('Khối Combo giữ kiểu Combo; bạn chỉnh được mức giảm.');
    expect(styleLockNote('X')).toBeNull();
  });
});

describe('% combo', () => {
  it('clampComboPct: số nguyên trong [0, giới hạn DTO]; trần cấu hình của máy chủ không bị đoán trước', () => {
    expect(clampComboPct(150)).toBe(100);
    expect(clampComboPct(50)).toBe(50);
    expect(clampComboPct(12.6)).toBe(13);
    expect(clampComboPct(-4)).toBe(0);
    expect(clampComboPct(Number.NaN)).toBe(0);
    expect(clampComboPct(50, 40)).toBe(40);
  });

  it('parseComboPct: chỉ nhận số nguyên dương; trần cấu hình (có thể là 40) không bị cắt về 30 ở máy khách', () => {
    expect(parseComboPct('15')).toBe(15);
    expect(parseComboPct(' 15 ')).toBe(15);
    expect(parseComboPct('35')).toBe(35);
    expect(parseComboPct('99')).toBe(99);
    expect(parseComboPct('150')).toBe(100);
    expect(parseComboPct('99', 30)).toBe(30);
    for (const bad of ['', 'abc', '0', '-3', '1.5', '1000']) expect(parseComboPct(bad), bad).toBeNull();
  });

  it('comboPctOutcome: máy chủ lưu thấp hơn số gửi thì báo đã hạ; bằng hoặc thiếu thì báo đã lưu', () => {
    expect(comboPctOutcome(50, 30)).toEqual({ saved: 30, clamped: true, text: 'Mức giảm tối đa hiện là 30%.' });
    expect(comboPctOutcome(25, 25)).toEqual({ saved: 25, clamped: false, text: 'Đã lưu mức giảm 25%.' });
    expect(comboPctOutcome(25, undefined)).toEqual({ saved: 25, clamped: false, text: 'Đã lưu mức giảm 25%.' });
    expect(comboPctOutcome(25, null).clamped).toBe(false);
  });

  it('newSectionDto: combo gửi kind, layout, comboDiscountPct trong giới hạn DTO; kiểu thường không có comboDiscountPct', () => {
    expect(newSectionDto({ style: 'COMBO', title: ' Bộ đôi ', comboPct: 50 })).toEqual({ title: 'Bộ đôi', kind: 'COMBO', layout: 'CAROUSEL', comboDiscountPct: 50 });
    expect(newSectionDto({ style: 'COMBO', title: 'A', comboPct: 400 }).comboDiscountPct).toBe(100);
    expect(newSectionDto({ style: 'COMBO', title: 'A' }).comboDiscountPct).toBe(10);
    const grid = newSectionDto({ style: 'GRID', title: 'A' });
    expect(grid).toEqual({ title: 'A', kind: 'NORMAL', layout: 'GRID' });
    expect('comboDiscountPct' in grid).toBe(false);
    expect(newSectionDto({ style: 'STACK', title: 'A' }).layout).toBe('STACK');
  });

  it('suggestedSectionTitle: có gợi ý cho từng kiểu', () => {
    for (const s of SECTION_STYLES) expect(suggestedSectionTitle(s).length).toBeGreaterThan(2);
  });
});

describe('địa chỉ trang chi tiết khối', () => {
  it('sectionHref ghi id vào ?khoi= (có mã hoá) và sectionIdFromSearch đọc lại đúng', () => {
    expect(sectionHref('/storefront', 'c1')).toBe('/storefront?khoi=c1');
    const href = sectionHref('/ctv/gian-hang', 'a b&c');
    expect(href).toBe('/ctv/gian-hang?khoi=a%20b%26c');
    expect(sectionIdFromSearch(href.slice(href.indexOf('?')))).toBe('a b&c');
  });

  it('sectionIdFromSearch: không có tham số hoặc rỗng thì là danh sách khối (null)', () => {
    expect(sectionIdFromSearch('')).toBeNull();
    expect(sectionIdFromSearch('?khoi=')).toBeNull();
    expect(sectionIdFromSearch('?x=1')).toBeNull();
    expect(sectionIdFromSearch('?x=1&khoi=c2')).toBe('c2');
  });
});

describe('thẻ khối', () => {
  it('isCustomerVisible: ẩn hoặc có lý do thì khách không thấy', () => {
    expect(isCustomerVisible({ isHidden: true })).toBe(false);
    expect(isCustomerVisible({ hiddenReason: 'Ngừng bán' })).toBe(false);
    expect(isCustomerVisible({})).toBe(true);
  });

  it('visibleCollection chỉ giữ món khách thấy', () => {
    const c = col({ items: [item(), item({ isHidden: true }), item({ hiddenReason: 'Ngừng bán' })] });
    expect(visibleCollection(c).items).toHaveLength(1);
  });

  it('đếm món khách thấy, không đếm món ẩn', () => {
    const c = col({ items: [item(), item(), item(), item({ isHidden: true })] });
    const v = sectionCardView(c, [c]);
    expect(v.total).toBe(3);
    expect(v.countText).toBe('Kệ ngang · 3 món');
    expect(v.warnings).toEqual([]);
  });

  it('thiếu món: Kệ ngang/Lưới cần 2, Danh sách chỉ cần 1', () => {
    const grid = col({ layout: 'GRID', n: 1 });
    expect(sectionCardView(grid, [grid]).warnings).toEqual(['Thêm ít nhất 1 món nữa.']);
    const stack = col({ layout: 'STACK', n: 1 });
    expect(sectionCardView(stack, [stack]).warnings).toEqual([]);
  });

  it('khối rỗng hoặc toàn món ẩn: cảnh báo và không có ảnh', () => {
    const c = col({ items: [item({ isHidden: true })] });
    const v = sectionCardView(c, [c]);
    expect(v.warnings).toEqual(['Chưa có món nào khách thấy được.']);
    expect(v.thumbs).toEqual([]);
    expect(v.total).toBe(0);
  });

  it('vượt ngân sách: nói khách thấy bao nhiêu và phần còn lại ở tab Sản phẩm', () => {
    const grid = col({ layout: 'GRID', n: 9 });
    expect(sectionCardView(grid, [grid]).warnings).toEqual(['Khách thấy 6/9 món ở tab Shop; 3 món còn lại ở tab Sản phẩm.']);
    const rail = col({ layout: 'CAROUSEL', n: 14 });
    expect(sectionCardView(rail, [rail]).warnings).toEqual(['Khách thấy 10/14 món ở tab Shop; 4 món còn lại ở tab Sản phẩm.']);
    const stack = col({ layout: 'STACK', n: 8 });
    expect(sectionCardView(stack, [stack]).warnings[0]).toContain('5/8');
  });

  it('combo: nhãn có %, đủ 2 món khác nhau thì không cảnh báo', () => {
    const c = col({ kind: 'COMBO', comboDiscountPct: 10, n: 3 });
    const v = sectionCardView(c, [c]);
    expect(v.style).toBe('COMBO');
    expect(v.countText).toBe('Combo -10% · 3 món');
    expect(v.warnings).toEqual([]);
  });

  it('combo thiếu món khác nhau hoặc quá 5 món thì cảnh báo', () => {
    const one = col({ kind: 'COMBO', comboDiscountPct: 10, n: 1 });
    expect(sectionCardView(one, [one]).warnings).toEqual(['Combo cần ít nhất 2 món khác nhau, khách chưa thấy ưu đãi.']);
    const dup = col({ kind: 'COMBO', comboDiscountPct: 10, items: [item({ pid: 'same' }), item({ pid: 'same' })] });
    expect(sectionCardView(dup, [dup]).warnings).toEqual(['Combo cần ít nhất 2 món khác nhau, khách chưa thấy ưu đãi.']);
    const six = col({ kind: 'COMBO', comboDiscountPct: 10, n: 6 });
    expect(sectionCardView(six, [six]).warnings).toEqual(['Combo nên có 2–5 món.']);
  });

  it('ảnh: tối đa 5, bỏ món không có ảnh', () => {
    const c = col({ items: [item({ thumb: null }), ...Array.from({ length: 7 }, () => item())] });
    const v = sectionCardView(c, [c]);
    expect(v.thumbs).toHaveLength(5);
    expect(v.thumbs.every(Boolean)).toBe(true);
  });

  it('spoken đọc tên, kiểu, số món rồi cảnh báo', () => {
    const c = col({ layout: 'GRID', n: 1, title: 'Bếp xanh' });
    expect(sectionCardView(c, [c]).spoken).toBe('Bếp xanh, Lưới, 1 món. Thêm ít nhất 1 món nữa.');
  });

  it('từ khối thứ 7 chỉ hiện ở tab Danh mục; khối rỗng không chiếm chỗ', () => {
    const empty = col({ id: 'empty', items: [] });
    const full = Array.from({ length: 8 }, (_, i) => col({ id: `f${i + 1}` }));
    const all = [empty, ...full];
    const flags = Object.fromEntries(all.map((c) => [c.id, sectionCardView(c, all).tabOnly]));
    expect(flags).toMatchObject({ empty: false, f1: false, f6: false, f7: true, f8: true });
  });

  it('overflowSectionsNotice: chỉ nhắc khi quá 6 khối thật', () => {
    const six = Array.from({ length: 6 }, () => col());
    expect(overflowSectionsNotice(six)).toBeNull();
    const seven = Array.from({ length: 7 }, () => col());
    const note = overflowSectionsNotice(seven)!;
    expect(note).toContain('6 khối đầu');
    expect(note).toContain('tab Danh mục');
  });
});

describe('chữ nút sắp xếp', () => {
  it('nhãn nút có tên món/khối', () => {
    expect(moveButtonLabel('up', 'Kem dưỡng')).toBe('Đưa Kem dưỡng lên');
    expect(moveButtonLabel('down', 'Bếp xanh', 'section')).toBe('Đưa khối Bếp xanh xuống');
  });

  it('báo vị trí mới và lý do không dời được', () => {
    expect(moveAnnouncement({ name: 'Kem', dir: 'up', index: 1, total: 10 })).toBe('Đã đưa Kem lên vị trí 2/10');
    expect(moveAnnouncement({ name: 'Kem', dir: 'down', index: 2, total: 3 })).toBe('Đã đưa Kem xuống vị trí 3/3');
    expect(moveBlockedAnnouncement({ name: 'Kem', dir: 'up', reason: 'edge' })).toBe('Kem đã ở đầu danh sách');
    expect(moveBlockedAnnouncement({ name: 'Kem', dir: 'down', reason: 'edge' })).toBe('Kem đã ở cuối danh sách');
    expect(moveBlockedAnnouncement({ name: 'Kem', dir: 'up', reason: 'pin' })).toBe('Món ghim luôn nằm trên món thường.');
  });
});

describe('lý do không dời được', () => {
  const row = (id: string, isPinned = false) => ({ id, isPinned });
  const same = (a: { isPinned: boolean }, b: { isPinned: boolean }) => a.isPinned === b.isPinned;

  it('đầu và cuối danh sách là "edge"; dời được là null', () => {
    const list = [row('a'), row('b'), row('c')];
    expect(moveBlockReason(list, 'a', 'up', same)).toBe('edge');
    expect(moveBlockReason(list, 'c', 'down', same)).toBe('edge');
    expect(moveBlockReason(list, 'b', 'up', same)).toBeNull();
    expect(moveBlockReason(list, 'b', 'down', same)).toBeNull();
  });

  it('hàng xóm khác nhóm ghim là "pin", kể cả khi đi xuống từ món ghim cuối', () => {
    const list = [row('p1', true), row('p2', true), row('n1'), row('n2')];
    expect(moveBlockReason(list, 'n1', 'up', same)).toBe('pin');
    expect(moveBlockReason(list, 'p2', 'down', same)).toBe('pin');
    expect(moveBlockReason(list, 'p1', 'down', same)).toBeNull();
  });

  it('id lạ coi như không dời được ("edge") và không ném lỗi', () => {
    expect(moveBlockReason([row('a')], 'zzz', 'up', same)).toBe('edge');
  });
});

describe('dải Hành trình', () => {
  const fmt = (n: number) => `${n.toLocaleString('vi-VN')} điểm`;
  const quest = (over: Partial<{ title: string; goal: number; progress: number; done: boolean; claimed: boolean; rewardPoints: number }> = {}) => ({
    title: 'Viết lý do cho 3 sản phẩm', goal: 3, progress: 0, done: false, claimed: false, rewardPoints: 1000, ...over,
  });

  it('có thưởng chờ: đếm và cộng điểm', () => {
    const v = questStripView({ quests: [quest({ done: true, rewardPoints: 1000 }), quest({ done: true, rewardPoints: 2000 }), quest()], totalEarnedPoints: 0 }, fmt);
    expect(v.text).toBe('2 phần thưởng đang chờ · 3.000 điểm');
    expect(v.hasReward).toBe(true);
    expect(v.spoken).toBe('2 phần thưởng đang chờ, 3.000 điểm. Mở Hành trình gian hàng.');
  });

  it('không có thưởng chờ: nói việc kế tiếp', () => {
    const v = questStripView({ quests: [quest({ claimed: true, done: true }), quest({ progress: 0 })], totalEarnedPoints: 1000 }, fmt);
    expect(v.text).toBe('Viết lý do cho 3 sản phẩm · 0/3');
    expect(v.hasReward).toBe(false);
    expect(v.spoken).not.toContain('·');
  });

  it('nhận hết: nói tổng điểm đã nhận', () => {
    const v = questStripView({ quests: [quest({ claimed: true, done: true })], totalEarnedPoints: 5000 }, fmt);
    expect(v.text).toBe('Đã nhận 5.000 điểm');
    expect(v.hasReward).toBe(false);
  });
});

describe('BUILDER_COPY', () => {
  it('nút thêm món trong khối có một chữ chung cho hai app', () => {
    expect(BUILDER_COPY.addProduct).toBe('Thêm sản phẩm');
  });

  it('không dùng thuật ngữ cấm và không có dấu ba chấm', () => {
    for (const [key, text] of Object.entries(BUILDER_COPY)) {
      for (const t of FORBIDDEN_TERMS) expect(t.pattern.test(text), `${key}: ${text}`).toBe(false);
    }
  });

  it('một tên gọi "khối" cho mọi chữ của màn dựng; chữ về trần % không ghi số cố định (trần là cấu hình của máy chủ)', () => {
    for (const [key, text] of Object.entries(BUILDER_COPY)) expect(/bộ sưu tập/i.test(text), `${key}: ${text}`).toBe(false);
    expect(/\d/.test(BUILDER_COPY.comboPctHint)).toBe(false);
    expect(BUILDER_COPY.renameSection).toBe('Đổi tên khối');
    expect(BUILDER_COPY.deleteSection).toBe('Xoá khối');
  });

  it('builderCopy điền {n}, thiếu biến thì ném lỗi', () => {
    expect(builderCopy('comboPctClamped', { n: 20 })).toBe('Mức giảm tối đa hiện là 20%.');
    expect(() => builderCopy('comboPctClamped')).toThrow(/thiếu biến/);
  });
});
