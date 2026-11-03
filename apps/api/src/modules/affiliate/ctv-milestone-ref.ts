/** refType của dòng thưởng mốc (claimMilestone) và của dòng thu hồi nó; cùng refId = id claim nên sổ lô ghép được hai dòng. */
export const CTV_MILESTONE_REF_TYPE = 'AFFILIATE_MILESTONE';
export const CTV_MILESTONE_REVOKE_REF_TYPE = 'AFFILIATE_MILESTONE_REVOKE';
export const ctvMilestoneLotKey = (claimId: string): string => `CTV_MILESTONE:${claimId}`;
/** Reason của dòng thu hồi và dòng nợ cố ý KHÔNG bắt đầu bằng CTV_MILESTONE: các màn lịch sử gắn nhãn "Thưởng" theo tiền tố đó. */
export const ctvMilestoneRevokeReason = (claimId: string, generation: number): string => `AFFILIATE_MILESTONE_REVOKE:${claimId}:${generation}`;
export const ctvMilestoneDebtReason = (claimId: string, generation: number, debt: number): string =>
  `AFFILIATE_MILESTONE_DEBT:${claimId}:${generation}:${debt}`;
