import type { MiniKitchenCorner, MiniProductCard, MiniReview, MiniRoundContent } from '@tubutree/shared-types';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { claimsIn } from '../commerce/copy-claims-guard';
import { GAME_MINI_COPY_MAX, gameCopy } from './copy';
import { miniGameDesc, miniGameRules, miniGameTitle, miniProgressLabel, miniWebOnlyLine } from './format';
import {
  kitchenDiscovered,
  kitchenDoneCount,
  kitchenIsLast,
  kitchenNext,
  kitchenReviewRows,
  kitchenStart,
  kitchenSwap,
  kitchenSwapped,
} from './kitchen';
import { KITCHEN_COPY, KITCHEN_COPY_MAX, kitchenCopy, kitchenCornerName, type KitchenCopyKey } from './kitchen-copy';

const card = (slug: string, name = slug): MiniProductCard => ({ slug, name, imageUrl: null, price: 100_000, inStock: true });

const CORNERS: MiniKitchenCorner[] = ['table', 'kitchen', 'bag'];

const content: MiniRoundContent = {
  game: 'kitchen_swap',
  swaps: CORNERS.map((corner, i) => ({
    id: `k${i}`,
    corner,
    item: `Món ${i}`,
    emoji: null,
    hidden: `Đang giấu ${i}`,
    options: [card(`dung-${i}`, `Đúng ${i}`), card(`sai-${i}`, `Sai ${i}`), card(`khac-${i}`, `Khác ${i}`)].map((product) => ({ product, fact: 'Nhãn ghi' })),
  })),
};

const review = (given: (string | null)[], expected = ['dung-0', 'dung-1', 'dung-2']): MiniReview => ({
  game: 'kitchen_swap',
  items: CORNERS.map((corner, i) => ({
    contentId: `k${i}`,
    correct: given[i] === expected[i],
    corner,
    item: `Món ${i}`,
    given: given[i] ?? null,
    expected: expected[i]!,
    explanation: `Vì sao ${i}`,
    sourceUrl: `https://example.org/${i}`,
  })),
});

describe('Căn Bếp Xanh: bàn chơi', () => {
  it('ván mới: món đầu, chưa đổi món nào', () => {
    const p = kitchenStart(3);
    expect(p).toEqual({ index: 0, answers: [null, null, null] });
    expect(kitchenSwapped(p)).toBe(false);
    expect(kitchenDoneCount(p)).toBe(0);
    expect(kitchenIsLast(p)).toBe(false);
  });

  it('đổi một lần rồi khoá: chạm lần hai hay chạm slug lạ trả lại đúng object cũ', () => {
    const allowed = ['dung-0', 'sai-0', 'khac-0'];
    const p0 = kitchenStart(3);
    expect(kitchenSwap(p0, 'dung-1', allowed)).toBe(p0);
    const p1 = kitchenSwap(p0, 'sai-0', allowed);
    expect(p1.answers).toEqual(['sai-0', null, null]);
    expect(p0.answers).toEqual([null, null, null]);
    expect(kitchenSwap(p1, 'dung-0', allowed)).toBe(p1);
    expect(kitchenDoneCount(p1)).toBe(1);
  });

  it('chỉ sang góc tiếp khi món đang mở đã đổi, và không vượt món cuối', () => {
    let p = kitchenStart(3);
    expect(kitchenNext(p)).toBe(p);
    p = kitchenNext(kitchenSwap(p, 'dung-0', ['dung-0']));
    expect(p.index).toBe(1);
    p = kitchenNext(kitchenSwap(p, 'dung-1', ['dung-1']));
    expect(p.index).toBe(2);
    expect(kitchenIsLast(p)).toBe(true);
    const done = kitchenSwap(p, 'dung-2', ['dung-2']);
    expect(kitchenNext(done)).toBe(done);
    expect(done.answers).toEqual(['dung-0', 'dung-1', 'dung-2']);
    expect(kitchenDoneCount(done)).toBe(3);
  });

  it('nhãn tiến độ của game là "Đã đổi n/m"', () => {
    expect(miniProgressLabel('kitchen_swap', 2, 3)).toBe('Đã đổi 2/3');
  });
});

describe('Căn Bếp Xanh: màn kết quả', () => {
  it('3 sản phẩm khám phá là sản phẩm đúng việc của từng góc, theo thứ tự ván, kể cả góc khách đổi sai hay bỏ trống', () => {
    const got = kitchenDiscovered(review(['sai-0', null, 'dung-2']), content);
    expect(got.map((p) => p.slug)).toEqual(['dung-0', 'dung-1', 'dung-2']);
    expect(got[0]).toEqual(card('dung-0', 'Đúng 0'));
  });

  it('không trùng sản phẩm, bỏ qua slug không có trong nội dung ván, và rỗng với game khác', () => {
    expect(kitchenDiscovered(review([null, null, null], ['dung-0', 'dung-0', 'la']), content).map((p) => p.slug)).toEqual(['dung-0']);
    expect(kitchenDiscovered(review([null, null, null]), undefined)).toEqual([]);
    expect(kitchenDiscovered({ game: 'sort', items: [] }, content)).toEqual([]);
  });

  it('dòng "Vì sao": tiêu đề góc và món, tên sản phẩm thay cho slug, trạng thái đúng/sai/bỏ trống', () => {
    const rows = kitchenReviewRows(review(['dung-0', 'sai-1', null]), content);
    expect(rows).toEqual([
      { key: 'k0-0', title: 'Bàn ăn: Món 0', state: 'correct', given: 'Đúng 0', expected: 'Đúng 0', explanation: 'Vì sao 0', sourceUrl: 'https://example.org/0' },
      { key: 'k1-1', title: 'Gian bếp: Món 1', state: 'wrong', given: 'Sai 1', expected: 'Đúng 1', explanation: 'Vì sao 1', sourceUrl: 'https://example.org/1' },
      { key: 'k2-2', title: 'Túi đi làm: Món 2', state: 'skipped', given: null, expected: 'Đúng 2', explanation: 'Vì sao 2', sourceUrl: 'https://example.org/2' },
    ]);
    expect(kitchenReviewRows({ game: 'sort', items: [] }, content)).toEqual([]);
    expect(kitchenReviewRows(review([null, null, null]), undefined)[0]!.expected).toBe('dung-0');
  });
});

describe('Căn Bếp Xanh: chữ', () => {
  const keys = Object.keys(KITCHEN_COPY) as KitchenCopyKey[];
  const sample = { n: 2, m: 3, corner: 'Phòng tắm', item: 'Sữa rửa mặt có hạt', name: 'Nước rửa tay dạng gel Fuwa3e 300ml' };

  it('không dùng thuật ngữ cấm và không có lời tuyên bố (mức strict)', () => {
    for (const key of keys) {
      for (const { pattern, use } of FORBIDDEN_TERMS) expect(KITCHEN_COPY[key], `${key}: dùng "${use}"`).not.toMatch(pattern);
      expect(claimsIn(kitchenCopy(key, sample), 'strict'), key).toEqual([]);
    }
    for (const text of [miniGameTitle('kitchen_swap'), miniGameDesc('kitchen_swap'), miniGameRules('kitchen_swap')]) {
      for (const { pattern, use } of FORBIDDEN_TERMS) expect(text, `dùng "${use}"`).not.toMatch(pattern);
      expect(claimsIn(text, 'strict'), text).toEqual([]);
    }
  });

  it('trong ngân sách độ dài sau khi điền biến', () => {
    for (const [key, max] of Object.entries(KITCHEN_COPY_MAX) as Array<[KitchenCopyKey, number]>) {
      expect(kitchenCopy(key, sample).length, key).toBeLessThanOrEqual(max);
    }
  });

  it('không hứa Giọt nước hay Điểm Xanh trên bàn chơi', () => {
    expect(keys.filter((k) => /Giọt nước|Điểm Xanh|thưởng/i.test(KITCHEN_COPY[k]))).toEqual([]);
  });

  it('đủ tên cho cả 4 góc nhà', () => {
    expect((['table', 'kitchen', 'bathroom', 'bag'] as const).map(kitchenCornerName)).toEqual(['Bàn ăn', 'Gian bếp', 'Phòng tắm', 'Túi đi làm']);
  });

  it('Mini: Căn Bếp Xanh nằm trong dòng "chơi trên tubutree.com", vẫn trong ngân sách khi đủ 5 tên', () => {
    const line = miniWebOnlyLine(['match', 'origin', 'basket', 'kitchen_swap'], [gameCopy('game.matcher.title')])!;
    expect(line).toBe('Ghép Cặp, Đoán Xuất Xứ, Giỏ Đúng Việc, Căn Bếp Xanh, Chọn Chuẩn Xanh: chơi trên tubutree.com');
    expect(line.length).toBeLessThanOrEqual(GAME_MINI_COPY_MAX['entry.webOnly']!);
  });
});
