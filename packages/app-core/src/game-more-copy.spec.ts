import { describe, expect, it } from 'vitest';
import { collapseMissions } from './game-more-copy';

describe('collapseMissions', () => {
  const m = (code: string, claimed = false) => ({ code, claimed });
  it('chỉ hiện tối đa 3 việc chưa nhận thưởng, kèm nút xem tất cả', () => {
    const r = collapseMissions([m('a', true), m('b'), m('c'), m('d'), m('e')], false);
    expect(r.items.map((x) => x.code)).toEqual(['b', 'c', 'd']);
    expect(r.collapsible).toBe(true);
    expect(collapseMissions([m('a', true), m('b'), m('c'), m('d'), m('e')], true).items).toHaveLength(5);
  });
  it('không có gì để giấu thì không có nút', () => {
    expect(collapseMissions([m('a'), m('b')], false)).toEqual({ items: [m('a'), m('b')], collapsible: false });
  });
  it('xong hết cả thì vẫn hiện cả danh sách', () => {
    expect(collapseMissions([m('a', true), m('b', true)], false)).toEqual({ items: [m('a', true), m('b', true)], collapsible: false });
  });
});
