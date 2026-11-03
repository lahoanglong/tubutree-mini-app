/** refType của dòng thưởng mốc (claimMilestone) và của dòng thu hồi nó; cùng refId = id claim nên sổ lô ghép được hai dòng. */
export const CTV_MILESTONE_REF_TYPE = 'AFFILIATE_MILESTONE';
export const CTV_MILESTONE_REVOKE_REF_TYPE = 'AFFILIATE_MILESTONE_REVOKE';
export const ctvMilestoneLotKey = (claimId: string): string => `CTV_MILESTONE:${claimId}`;
