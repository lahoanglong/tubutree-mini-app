import { decideTier } from './tier-policy';

const TIERS = [
  { id: 'mam', sortOrder: 0 },
  { id: 'loc', sortOrder: 1 },
  { id: 'dai', sortOrder: 2 },
  { id: 'co', sortOrder: 3 },
];
const NOW = new Date('2026-06-25T00:00:00Z');
const DAY = 86400000;

describe('decideTier (grace khi rớt hạng §6.6)', () => {
  it('chưa có hạng → áp hạng đạt được ngay, không grace', () => {
    const r = decideTier({ currentTierId: null, tiers: TIERS, qualifiedId: 'loc', graceUntil: null, now: NOW, graceDays: 30 });
    expect(r).toEqual({ tierId: 'loc', graceUntil: null });
  });

  it('lên hạng → áp ngay, xoá grace cũ nếu có', () => {
    const r = decideTier({ currentTierId: 'loc', tiers: TIERS, qualifiedId: 'dai', graceUntil: new Date(NOW.getTime() + 5 * DAY), now: NOW, graceDays: 30 });
    expect(r).toEqual({ tierId: 'dai', graceUntil: null });
  });

  it('giữ nguyên hạng → xoá grace', () => {
    const r = decideTier({ currentTierId: 'dai', tiers: TIERS, qualifiedId: 'dai', graceUntil: new Date(NOW.getTime() + 5 * DAY), now: NOW, graceDays: 30 });
    expect(r).toEqual({ tierId: 'dai', graceUntil: null });
  });

  it('rớt hạng LẦN ĐẦU (chưa grace) → GIỮ hạng cũ + đặt graceUntil = now + graceDays', () => {
    const r = decideTier({ currentTierId: 'dai', tiers: TIERS, qualifiedId: 'mam', graceUntil: null, now: NOW, graceDays: 30 });
    expect(r.tierId).toBe('dai'); // chưa rớt, đang trong grace
    expect(r.graceUntil).toEqual(new Date(NOW.getTime() + 30 * DAY));
  });

  it('rớt hạng nhưng CÒN grace → giữ hạng cũ + giữ nguyên graceUntil (không gia hạn)', () => {
    const grace = new Date(NOW.getTime() + 10 * DAY);
    const r = decideTier({ currentTierId: 'dai', tiers: TIERS, qualifiedId: 'mam', graceUntil: grace, now: NOW, graceDays: 30 });
    expect(r.tierId).toBe('dai');
    expect(r.graceUntil).toBe(grace); // KHÔNG reset mỗi lần chạy
  });

  it('rớt hạng + grace ĐÃ HẾT → áp hạng thấp, xoá grace', () => {
    const grace = new Date(NOW.getTime() - 1 * DAY); // đã qua
    const r = decideTier({ currentTierId: 'dai', tiers: TIERS, qualifiedId: 'mam', graceUntil: grace, now: NOW, graceDays: 30 });
    expect(r).toEqual({ tierId: 'mam', graceUntil: null });
  });
});
