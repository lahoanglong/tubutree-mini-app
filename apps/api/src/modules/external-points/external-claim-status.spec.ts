import { decideStatusAction } from './external-claim-status';

type S = Parameters<typeof decideStatusAction>[0];
type C = Parameters<typeof decideStatusAction>[1];
const claim = (state: C['state'], over: Partial<C> = {}): C => ({ state, autoVoided: false, flaggedPartial: false, ...over });
const act = (status: S, c: C) => decideStatusAction(status, c).action;

describe('decideStatusAction (status Pancake 4/5/6/7/15 và giao sau huỷ)', () => {
  it('4 đang hoàn: giữ nguyên mọi trạng thái claim', () => {
    for (const s of ['PENDING', 'REVIEW', 'CREDITED', 'VOIDED'] as const) expect(act('RETURNING', claim(s))).toBe('NONE');
  });
  it('OPEN: không đổi gì', () => {
    expect(act('OPEN', claim('PENDING'))).toBe('NONE');
  });
  it('5 đã hoàn, 6 huỷ, 7 xoá: PENDING/REVIEW/HELD huỷ claim', () => {
    for (const status of ['RETURNED', 'CANCELLED', 'DELETED'] as const) {
      for (const s of ['PENDING', 'REVIEW', 'HELD_NO_MEMBER'] as const) expect(act(status, claim(s))).toBe('VOID');
    }
  });
  it('5/6/7 với claim đã CREDITED: đảo điểm', () => {
    for (const status of ['RETURNED', 'CANCELLED', 'DELETED'] as const) expect(act(status, claim('CREDITED'))).toBe('REVERSE');
  });
  it('5/6/7 với claim đã ở trạng thái cuối: không làm gì (idempotent)', () => {
    for (const s of ['VOIDED', 'REVERSED', 'LAPSED'] as const) expect(act('CANCELLED', claim(s))).toBe('NONE');
  });
  it('15 hoàn một phần: chưa cộng thì REVIEW; đã cộng thì gắn cờ vào hàng cần xử lý (một lần)', () => {
    expect(decideStatusAction('PARTIAL_RETURN', claim('PENDING'))).toEqual({ action: 'TO_REVIEW', reason: 'Đơn hoàn một phần trên sàn, cần nhân viên kiểm' });
    expect(act('PARTIAL_RETURN', claim('CREDITED'))).toBe('FLAG_PARTIAL');
    expect(act('PARTIAL_RETURN', claim('CREDITED', { flaggedPartial: true }))).toBe('NONE');
    expect(act('PARTIAL_RETURN', claim('REVIEW'))).toBe('NONE');
    expect(act('PARTIAL_RETURN', claim('PENDING', { humanDecided: true }))).toBe('NONE');
  });
  it('đã giao: PENDING/REVIEW đồng bộ mốc cộng; CREDITED không đổi', () => {
    expect(act('DELIVERED', claim('PENDING'))).toBe('SYNC_RELEASE');
    expect(act('DELIVERED', claim('REVIEW'))).toBe('SYNC_RELEASE');
    expect(act('DELIVERED', claim('CREDITED'))).toBe('NONE');
  });
  it('giao sau khi tự huỷ vì đơn bị huỷ: REVIEW; claim do admin huỷ thì giữ nguyên', () => {
    expect(decideStatusAction('DELIVERED', claim('VOIDED', { autoVoided: true }))).toEqual({ action: 'TO_REVIEW', reason: 'Đơn được giao sau khi đã bị huỷ hoặc hoàn trên sàn' });
    expect(act('DELIVERED', claim('VOIDED'))).toBe('NONE');
    expect(act('DELIVERED', claim('REVERSED', { autoVoided: true }))).toBe('NONE');
  });
});
