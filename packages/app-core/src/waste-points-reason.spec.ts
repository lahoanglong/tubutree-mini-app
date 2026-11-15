import { describe, expect, it } from 'vitest';
import { wastePickupFeeReasonLabel } from './waste-points-reason';

describe('wastePickupFeeReasonLabel', () => {
  it.each([
    ['WASTE_PICKUP_FEE:TR-8K2M9', 'Trừ phí shipper thu gom · TR-8K2M9'],
    ['WASTE_PICKUP_FEE_REFUND:TR-8K2M9', 'Hoàn điểm phí shipper · TR-8K2M9'],
    ['MERGED:guest-1:WASTE_PICKUP_FEE:TR-8K2M9', 'Trừ phí shipper thu gom · TR-8K2M9'],
    ['WASTE_PICKUP_FEE:<script>', 'Trừ phí shipper thu gom'],
  ])('%s', (reason, label) => {
    expect(wastePickupFeeReasonLabel(reason)).toBe(label);
  });
  it.each(['RECYCLE:TR-8K2M9', 'ORDER_DELIVERED:TUBU1', 'WASTE_PICKUP_FEE', 'WASTE_OTHER:TR-1', ''])('không phải dòng phí shipper: %s', (reason) => {
    expect(wastePickupFeeReasonLabel(reason)).toBeNull();
  });
});
