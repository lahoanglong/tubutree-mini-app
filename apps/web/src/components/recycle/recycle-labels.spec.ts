import { describe, expect, it } from 'vitest';
import { closedLabel, equivalentUnits, formatLineQty, impactLine, nextRewardProgress, ruleText, timelineFor } from './recycle-labels';
import { makeRewardCatalog } from '@/components/loyalty/reward-fixtures';
import { ITEM_CARTON, ITEM_MILK } from './recycle-fixtures';

describe('nhãn Đổi rác', () => {
  it('impactLine: dưới 50 g không có dòng, từ 50 g làm tròn một chữ số', () => {
    expect(impactLine(null)).toBeNull();
    expect(impactLine(49)).toBeNull();
    expect(impactLine(50)).toBe('Bạn đã gửi khoảng 0,1 kg bao bì cho Tubu');
    expect(impactLine(1940)).toBe('Bạn đã gửi khoảng 1,9 kg bao bì cho Tubu');
  });
  it('ruleText và formatLineQty', () => {
    expect(ruleText(ITEM_CARTON)).toBe('1 thùng = 1.000 điểm');
    expect(ruleText(ITEM_MILK)).toBe('5 vỏ = 1.000 điểm');
    expect(formatLineQty('Thùng carton cũ', 3, 'thùng')).toBe('Thùng carton cũ: 3 thùng');
  });
  it('timelineFor: đường kho đi 0/1/2, đóng thì null, xong là bước 4', () => {
    expect(timelineFor({ method: 'MAIL_IN', status: 'IN_TRANSIT', orderCode: null })?.current).toBe(1);
    expect(timelineFor({ method: 'DROP_OFF', status: 'OPEN', orderCode: null })?.current).toBe(1);
    expect(timelineFor({ method: 'PICKUP', status: 'OPEN', orderCode: 'TB-1' })?.current).toBe(2);
    expect(timelineFor({ method: 'DROP_OFF', status: 'COMPLETED', orderCode: null })?.current).toBe(4);
    expect(timelineFor({ method: 'DROP_OFF', status: 'CANCELLED', orderCode: null })).toBeNull();
  });
  it('closedLabel: từ chối kèm lý do, hết hạn, huỷ, thu hồi', () => {
    const base = { closeReason: null, rejectionReason: null, rejectionNote: null, reversedPoints: null, reversalReason: null };
    expect(closedLabel({ ...base, status: 'REJECTED', rejectionReason: 'WET', rejectionNote: 'thấm nước' })).toEqual({ label: 'Bị từ chối', reason: 'Ướt: thấm nước' });
    expect(closedLabel({ ...base, status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' })).toEqual({ label: 'Hết hạn giữ chỗ', reason: null });
    expect(closedLabel({ ...base, status: 'CANCELLED' })).toEqual({ label: 'Đã huỷ', reason: 'bạn huỷ' });
    expect(closedLabel({ ...base, status: 'REVERSED', reversedPoints: 4000, reversalReason: 'nhầm' })).toEqual({ label: 'Đã thu hồi 4.000 điểm', reason: 'nhầm' });
    expect(closedLabel({ ...base, status: 'OPEN' })).toBeNull();
  });
  it('nextRewardProgress bỏ quà hết hàng và cây, equivalentUnits làm tròn lên', () => {
    const p = nextRewardProgress(makeRewardCatalog({ redeemablePoints: 14_000 }));
    expect(p).toMatchObject({ rewardName: 'mã giảm giá Miễn phí vận chuyển', missing: 6000, have: 14_000 });
    expect(nextRewardProgress(undefined)).toBeNull();
    expect(equivalentUnits(6000, ITEM_CARTON)).toBe(6);
    expect(equivalentUnits(1500, ITEM_MILK)).toBe(10);
  });
});
