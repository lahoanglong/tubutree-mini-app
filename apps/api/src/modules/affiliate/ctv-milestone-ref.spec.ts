import { ctvMilestoneDebtReason, ctvMilestoneRevokeReason } from './ctv-milestone-ref';

describe('ctv-milestone-ref', () => {
  // Mini App và web gắn nhãn "Thưởng" cho mọi reason bắt đầu bằng CTV_MILESTONE; dòng thu điểm và dòng nợ không được khớp.
  it('reason thu hồi và ghi nợ không mang tiền tố của dòng thưởng mốc', () => {
    expect(ctvMilestoneRevokeReason('cl1', 2)).not.toMatch(/^CTV_MILESTONE/);
    expect(ctvMilestoneDebtReason('cl1', 2, 190000)).not.toMatch(/^CTV_MILESTONE/);
  });

  it('giữ id claim, lần thu và số nợ trong reason', () => {
    expect(ctvMilestoneRevokeReason('cl1', 2)).toBe('AFFILIATE_MILESTONE_REVOKE:cl1:2');
    expect(ctvMilestoneDebtReason('cl1', 2, 190000)).toBe('AFFILIATE_MILESTONE_DEBT:cl1:2:190000');
  });
});
