import { decideCancel } from './cancel-rule';

const base = {
  now: new Date('2026-07-01T00:00:00Z'),
  workStart: new Date('2026-07-10T01:00:00Z'), // 9 ngày sau
  isEmergency: false,
  hasEvidence: false,
  emergencyCountThisMonth: 0,
  noticeDays: 3,
  emergencyCap: 3,
};

describe('decideCancel', () => {
  it('báo trước ≥3 ngày → miễn phạt', () => {
    expect(decideCancel(base)).toEqual({ allowed: true, penalty: false });
  });

  it('báo <3 ngày, không đột xuất → phạt', () => {
    const r = decideCancel({ ...base, workStart: new Date('2026-07-02T01:00:00Z') });
    expect(r).toEqual({ allowed: true, penalty: true });
  });

  it('báo <3 ngày, đột xuất có chứng cứ, dưới cap → miễn', () => {
    const r = decideCancel({
      ...base,
      workStart: new Date('2026-07-02T01:00:00Z'),
      isEmergency: true,
      hasEvidence: true,
      emergencyCountThisMonth: 2,
    });
    expect(r).toEqual({ allowed: true, penalty: false });
  });

  it('báo <3 ngày, đột xuất KHÔNG chứng cứ → phạt', () => {
    const r = decideCancel({
      ...base,
      workStart: new Date('2026-07-02T01:00:00Z'),
      isEmergency: true,
      hasEvidence: false,
    });
    expect(r).toEqual({ allowed: true, penalty: true });
  });

  it('báo <3 ngày, đột xuất có chứng cứ nhưng đã đủ cap (3) → phạt', () => {
    const r = decideCancel({
      ...base,
      workStart: new Date('2026-07-02T01:00:00Z'),
      isEmergency: true,
      hasEvidence: true,
      emergencyCountThisMonth: 3,
    });
    expect(r).toEqual({ allowed: true, penalty: true });
  });

  it('đúng biên 3 ngày (=noticeDays) → miễn phạt', () => {
    const r = decideCancel({ ...base, now: new Date('2026-07-07T01:00:00Z') }); // đúng 3 ngày
    expect(r).toEqual({ allowed: true, penalty: false });
  });
});
