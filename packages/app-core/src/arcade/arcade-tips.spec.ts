import { describe, expect, it } from 'vitest';
import routeMap from '../route-map.json';
import { FORBIDDEN_TERMS } from '../shop-copy';
import { endTip, type ArcadeTip } from './arcade-tips';

type RouteMap = { routes: { items: { miniapp: string; web: string }[] }[] };
const pairs = (routeMap as RouteMap).routes.flatMap((lane) => lane.items.map((i) => [i.miniapp, i.web] as const));
const pathOf = (url: string) => url.split('?')[0]!;

const ecoTips = () => {
  const texts = new Set<string>();
  for (let i = 0; i <= 100; i++) texts.add(endTip('dew_catcher', { dodgedHazards: 0, correct: 0 }, () => i / 100).text);
  return [...texts];
};

describe('endTip: hai nhánh có tên sản phẩm', () => {
  it('né từ 3 giọt hoá chất trở lên: nêu số giọt đã né và claim 0% Paraben & SLS, kèm chip tìm Bồ Hòn', () => {
    for (const n of [3, 4, 11]) {
      const tip = endTip('dew_catcher', { dodgedHazards: n }, () => 0);
      expect(tip.text).toBe(`Bạn vừa né ${n} giọt hoá chất! Nước rửa chén Bồ Hòn TubuTree cũng 0% Paraben & SLS, dịu êm cho da tay mẹ.`);
      expect(tip.chip?.to.miniapp).toBe(`/browse?q=${encodeURIComponent('bồ hòn')}`);
      expect(tip.chip?.to.web).toBe(`/san-pham?q=${encodeURIComponent('bồ hòn')}`);
      expect(tip.chip?.label.trim()).not.toBe('');
    }
  });

  it('né dưới 3 giọt thì quay về mẹo sống xanh không chip', () => {
    for (const n of [0, 1, 2]) {
      const tip = endTip('dew_catcher', { dodgedHazards: n }, () => 0);
      expect(tip.chip).toBeUndefined();
      expect(tip.text).not.toContain('Paraben');
      expect(tip.text).not.toContain('Bồ Hòn TubuTree');
    }
  });

  it('chai đúng từ 5 trở lên (Refill Rush): nhắc Điểm Xanh và Quà tặng, chip tới Đổi rác', () => {
    for (const correct of [5, 6, 40]) {
      const tip = endTip('refill_rush', { correct }, () => 0.5);
      expect(tip.text).toBe('Mỗi vỏ chai TubuTree giữ lại đều đổi được Điểm Xanh & Quà tặng!');
      expect(tip.chip?.to).toEqual({ miniapp: '/recycle', web: '/doi-rac' });
    }
  });

  it('chai đúng dưới 5 thì chỉ có mẹo sống xanh', () => {
    for (const correct of [0, 4]) expect(endTip('refill_rush', { correct }, () => 0).chip).toBeUndefined();
  });

  it('thống kê của game này không kích hoạt nhánh của game kia', () => {
    expect(endTip('refill_rush', { dodgedHazards: 9 }, () => 0).chip).toBeUndefined();
    expect(endTip('dew_catcher', { correct: 9 }, () => 0).chip).toBeUndefined();
  });

  it('chip trỏ đúng cặp route có thật trong route-map.json', () => {
    const chips = [endTip('dew_catcher', { dodgedHazards: 3 }).chip!, endTip('refill_rush', { correct: 5 }).chip!];
    for (const chip of chips) {
      expect(pairs.some(([m, w]) => m === pathOf(chip.to.miniapp) && w === pathOf(chip.to.web)), chip.to.miniapp).toBe(true);
    }
    expect(pathOf(chips[0]!.to.miniapp)).toBe('/browse');
    expect(pathOf(chips[0]!.to.web)).toBe('/san-pham');
  });
});

describe('mẹo sống xanh', () => {
  it('có ít nhất 6 mẹo khác nhau, rng 0 và rng 1 đều ra mẹo hợp lệ (không lệch chỉ số)', () => {
    const tips = ecoTips();
    expect(tips.length).toBeGreaterThanOrEqual(6);
    for (const r of [0, 0.999999, 1]) expect(endTip('refill_rush', { correct: 0 }, () => r).text.trim()).not.toBe('');
    expect(endTip('refill_rush', {}, () => 1).text).toBe(endTip('refill_rush', {}, () => 0.999999).text);
  });

  it('cùng rng cho cùng mẹo, rng khác cho mẹo khác', () => {
    expect(endTip('dew_catcher', {}, () => 0.3)).toEqual(endTip('dew_catcher', {}, () => 0.3));
    expect(endTip('dew_catcher', {}, () => 0).text).not.toBe(endTip('dew_catcher', {}, () => 0.99).text);
  });

  it('mẹo thường không nêu tên sản phẩm, không hứa công dụng, không số liệu y tế', () => {
    for (const text of ecoTips()) {
      expect(text, text).not.toMatch(/TubuTree|Bồ Hòn TubuTree|Paraben|SLS|\d+%|chữa|diệt khuẩn|an toàn tuyệt đối|100%/i);
    }
  });

  it('mọi câu ngắn gọn (tối đa 120 ký tự), sạch từ cấm, có dấu chấm câu cuối', () => {
    const all: ArcadeTip[] = [
      ...ecoTips().map((text) => ({ text })),
      endTip('dew_catcher', { dodgedHazards: 3 }),
      endTip('dew_catcher', { dodgedHazards: 99 }),
      endTip('refill_rush', { correct: 5 }),
    ];
    for (const tip of all) {
      expect(tip.text.length, tip.text).toBeLessThanOrEqual(120);
      expect(tip.text).toMatch(/[.!]$/);
      for (const { pattern } of FORBIDDEN_TERMS) expect(tip.text, String(pattern)).not.toMatch(pattern);
      if (tip.chip) for (const { pattern } of FORBIDDEN_TERMS) expect(tip.chip.label, String(pattern)).not.toMatch(pattern);
    }
  });

  it('rng mặc định (Math.random) vẫn trả mẹo hợp lệ', () => {
    for (let i = 0; i < 50; i++) expect(endTip('dew_catcher', {}).text.length).toBeGreaterThan(10);
  });
});
