import { describe, expect, it } from 'vitest';
import type { ReturnPackagingSuggestion } from '@tubutree/shared-types';
import {
  SECOND_ORDER_INVITE_DAYS,
  packagingWizardLines,
  preferredWasteMethodFromSearch,
  returnPackagingOrderFromSearch,
  secondOrderInviteCopy,
  secondOrderInviteCopyFor,
  secondOrderInvitePath,
  secondOrderInviteDecision,
  secondOrderOrderGate,
  type SecondOrderInviteMe,
  type SecondOrderInviteOrder,
} from './second-order-invite';

const NOW = new Date('2026-11-16T05:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const order = (patch: Partial<SecondOrderInviteOrder> = {}): SecondOrderInviteOrder => ({ status: 'DELIVERED', type: 'RETAIL', source: 'checkout', deliveredAt: daysAgo(1), ...patch });
const me = (patch: Partial<SecondOrderInviteMe> = {}): SecondOrderInviteMe => ({
  programmeEnabled: true,
  eligibility: 'OK',
  blocked: false,
  shipLockedAt: null,
  laneFlags: { dropoff: true, mailin: true, pickup: true },
  thresholds: { mailinMinPoints: 0, pickupMinPoints: 0, maxOpenRequests: 2 },
  openRequests: [],
  ...patch,
});
const open = (method: 'PICKUP' | 'DROP_OFF' | 'MAIL_IN' | 'HOME_PICKUP') => ({ id: `r-${method}`, method }) as SecondOrderInviteMe['openRequests'][number];
const decide = (o = order(), m: SecondOrderInviteMe | null = me(), cfgPickup = true) => secondOrderInviteDecision({ order: o, cfgPickup, me: m ?? undefined, now: NOW });

describe('secondOrderOrderGate — điều kiện chỉ cần đơn', () => {
  it('chỉ đơn DELIVERED qua cổng, mọi trạng thái khác dừng', () => {
    expect(secondOrderOrderGate(order(), NOW)).toBeNull();
    for (const status of ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'RETURNED', 'CANCELLED', 'COMPLETED']) {
      expect(secondOrderOrderGate(order({ status }), NOW)).toBe('ORDER_NOT_DELIVERED');
    }
  });

  it('đơn đại lý và đơn CTV lên hộ không mời', () => {
    expect(secondOrderOrderGate(order({ type: 'DEALER' }), NOW)).toBe('ORDER_NOT_RETAIL');
    expect(secondOrderOrderGate(order({ source: 'ctv_assisted' }), NOW)).toBe('ORDER_NOT_RETAIL');
    expect(secondOrderOrderGate(order({ source: 'dealer' }), NOW)).toBe('ORDER_NOT_RETAIL');
    expect(secondOrderOrderGate(order({ source: 'subscription' }), NOW)).toBeNull();
  });

  it('đơn đã kèm rác thì không mời lần nữa', () => {
    expect(secondOrderOrderGate(order({ hasRecyclingPickup: true }), NOW)).toBe('ALREADY_ATTACHED');
  });

  it('quá 14 ngày kể từ lúc giao thì thôi mời; đúng 14 ngày vẫn còn', () => {
    expect(SECOND_ORDER_INVITE_DAYS).toBe(14);
    expect(secondOrderOrderGate(order({ deliveredAt: daysAgo(14) }), NOW)).toBeNull();
    expect(secondOrderOrderGate(order({ deliveredAt: daysAgo(14.01) }), NOW)).toBe('ORDER_TOO_OLD');
  });

  it('thiếu deliveredAt thì lấy statusTimes.DELIVERED rồi updatedAt làm mốc giao; thiếu hết hoặc sai ngày thì ẩn', () => {
    expect(secondOrderOrderGate(order({ deliveredAt: null, statusTimes: { DELIVERED: daysAgo(2) } }), NOW)).toBeNull();
    expect(secondOrderOrderGate(order({ deliveredAt: null, statusTimes: { DELIVERED: daysAgo(20) }, updatedAt: daysAgo(1) }), NOW)).toBe('ORDER_TOO_OLD');
    expect(secondOrderOrderGate(order({ deliveredAt: null, updatedAt: daysAgo(3) }), NOW)).toBeNull();
    expect(secondOrderOrderGate(order({ deliveredAt: null, updatedAt: daysAgo(30) }), NOW)).toBe('ORDER_TOO_OLD');
    expect(secondOrderOrderGate(order({ deliveredAt: null }), NOW)).toBe('ORDER_TOO_OLD');
    expect(secondOrderOrderGate(order({ deliveredAt: 'không phải ngày' }), NOW)).toBe('ORDER_TOO_OLD');
  });
});

describe('secondOrderInviteDecision — khi nào hiện thẻ', () => {
  it('đủ điều kiện: hiện', () => {
    expect(decide()).toEqual({ show: true });
  });

  it('chưa có /waste/me: ẩn (không nháy thẻ rồi tắt)', () => {
    expect(decide(order(), null)).toEqual({ show: false, reason: 'LOADING' });
  });

  it('đơn không đủ điều kiện thì lý do của đơn đi trước dù chưa có /waste/me', () => {
    expect(decide(order({ status: 'SHIPPING' }), null)).toEqual({ show: false, reason: 'ORDER_NOT_DELIVERED' });
  });

  it.each([
    ['chương trình tắt', me({ programmeEnabled: false }), true],
    ['tài khoản chưa có số điện thoại', me({ eligibility: 'NEED_PHONE' }), true],
    ['khách vãng lai', me({ eligibility: 'GUEST' }), true],
    ['tài khoản bị chặn', me({ blocked: true }), true],
    ['bị khoá đường vận chuyển', me({ shipLockedAt: '2026-11-10T00:00:00.000Z' }), true],
    ['đường kèm đơn tắt ở tài khoản', me({ laneFlags: { dropoff: true, mailin: true, pickup: false } }), true],
    ['đường kèm đơn tắt ở cấu hình công khai', me(), false],
  ])('ẩn khi %s', (_name, m, cfgPickup) => {
    expect(decide(order(), m, cfgPickup)).toEqual({ show: false, reason: 'WASTE_UNAVAILABLE' });
  });

  it('đã có yêu cầu kèm đơn đang chờ thì ẩn (yêu cầu đó sẽ đi cùng đơn kế tiếp)', () => {
    expect(decide(order(), me({ openRequests: [open('PICKUP')] }))).toEqual({ show: false, reason: 'PICKUP_ALREADY_OPEN' });
  });

  it('trần yêu cầu mở (W179, mặc định 2): chạm trần thì ẩn, còn dưới trần thì hiện', () => {
    expect(decide(order(), me({ openRequests: [open('DROP_OFF')] }))).toEqual({ show: true });
    expect(decide(order(), me({ openRequests: [open('DROP_OFF'), open('MAIL_IN')] }))).toEqual({ show: false, reason: 'AT_OPEN_CAP' });
    expect(decide(order(), me({ openRequests: [open('DROP_OFF'), open('MAIL_IN'), open('HOME_PICKUP')] }))).toEqual({ show: false, reason: 'AT_OPEN_CAP' });
    expect(decide(order(), me({ thresholds: { mailinMinPoints: 0, pickupMinPoints: 0, maxOpenRequests: 1 }, openRequests: [open('DROP_OFF')] }))).toEqual({ show: false, reason: 'AT_OPEN_CAP' });
  });
});

describe('preferredWasteMethodFromSearch', () => {
  it('chỉ nhận method=PICKUP', () => {
    expect(preferredWasteMethodFromSearch('?method=PICKUP')).toBe('PICKUP');
    expect(preferredWasteMethodFromSearch('step=items&method=PICKUP')).toBe('PICKUP');
  });

  it.each(['', '?method=DROP_OFF', '?method=HOME_PICKUP', '?method=pickup', '?method=', '?step=method', '?method=PICKUP%20x'])('%s → null', (search) => {
    expect(preferredWasteMethodFromSearch(search)).toBeNull();
  });
});

describe('secondOrderInviteCopy', () => {
  it('tiêu đề ≤ 28 ký tự, mô tả ≤ 36 ký tự, nêu miễn ship 100% và Điểm Xanh', () => {
    expect(secondOrderInviteCopy.title.length).toBeLessThanOrEqual(28);
    expect(secondOrderInviteCopy.subtitle.length).toBeLessThanOrEqual(36);
    expect(secondOrderInviteCopy.subtitle).toMatch(/Miễn ship 100%/);
    expect(secondOrderInviteCopy.subtitle).toMatch(/Điểm Xanh/);
  });
});

describe('thẻ biết bao bì của đơn (checkout.return_packaging_nudge_enabled)', () => {
  const packaging = (patch: Partial<ReturnPackagingSuggestion> = {}): ReturnPackagingSuggestion => ({
    orderCodes: ['TT1'],
    lines: [
      { itemId: 'wi-carton', code: 'CARTON', name: 'Thùng carton cũ', unitLabel: 'thùng', qty: 1, unitsPerPoint: 1, pointsPerGroup: 1000 },
      { itemId: 'wi-tubu-bottle', code: 'TUBU_BOTTLE', name: 'Vỏ chai, hộp Tubu Tree', unitLabel: 'vỏ', qty: 2, unitsPerPoint: 1, pointsPerGroup: 2000 },
    ],
    estimatedPoints: 5000,
    minPoints: 3000,
    ...patch,
  });

  it('đủ ngưỡng: tiêu đề nêu đúng món, dòng dưới hứa miễn ship kèm điểm dự kiến', () => {
    expect(secondOrderInviteCopyFor(packaging())).toEqual({
      title: 'Đơn này có 1 thùng carton, 2 vỏ chai Tubu Tree',
      subtitle: 'Gửi lại kèm đơn sau: miễn ship, +5.000 Điểm Xanh',
      aria: 'Đơn này có 1 thùng carton, 2 vỏ chai Tubu Tree. Gửi lại kèm đơn sau: miễn ship, +5.000 Điểm Xanh',
    });
  });

  it('chưa đủ ngưỡng: không hứa miễn ship, nói rõ ngưỡng điểm', () => {
    const out = secondOrderInviteCopyFor(packaging({ lines: [packaging().lines[0]!], estimatedPoints: 1000 }));
    expect(out.title).toBe('Đơn này có 1 thùng carton');
    expect(out.subtitle).toBe('+1.000 Điểm Xanh, đủ 3.000 điểm thì miễn ship');
  });

  it('không có bao bì (null, chưa tải, rỗng) → chữ cũ', () => {
    expect(secondOrderInviteCopyFor(null)).toBe(secondOrderInviteCopy);
    expect(secondOrderInviteCopyFor(undefined)).toBe(secondOrderInviteCopy);
    expect(secondOrderInviteCopyFor(packaging({ lines: [] }))).toBe(secondOrderInviteCopy);
  });

  it('secondOrderInvitePath: kèm from=<mã đơn> chỉ khi có bao bì và mã hợp lệ', () => {
    expect(secondOrderInvitePath('/recycle/new', 'TT1', true)).toBe('/recycle/new?method=PICKUP&from=TT1');
    expect(secondOrderInvitePath('/doi-rac/tao', 'TT1', false)).toBe('/doi-rac/tao?method=PICKUP');
    expect(secondOrderInvitePath('/doi-rac/tao', null, true)).toBe('/doi-rac/tao?method=PICKUP');
    expect(secondOrderInvitePath('/doi-rac/tao', 'TT 1&x=y', true)).toBe('/doi-rac/tao?method=PICKUP');
  });

  it('returnPackagingOrderFromSearch: chỉ nhận mã đơn đúng dạng', () => {
    expect(returnPackagingOrderFromSearch('?method=PICKUP&from=TT1')).toBe('TT1');
    expect(returnPackagingOrderFromSearch('from=TUBU-2026_11')).toBe('TUBU-2026_11');
    for (const bad of ['', '?from=', '?from=TT%201', `?from=${'X'.repeat(33)}`, '?from=a/b']) expect(returnPackagingOrderFromSearch(bad), bad).toBeNull();
  });

  it('packagingWizardLines: chỉ món màn tạo yêu cầu cho chọn, số nguyên từ 1, kẹp theo trần còn lại và ô số', () => {
    const carton = { id: 'wi-carton', monthRemainingQty: null, dayRemainingQty: null, hazardous: false };
    const bottle = { id: 'wi-tubu-bottle', monthRemainingQty: null, dayRemainingQty: null, hazardous: false };
    expect(packagingWizardLines(packaging(), [carton], 999)).toEqual({ 'wi-carton': 1 });
    expect(packagingWizardLines(packaging(), [carton, bottle], 999)).toEqual({ 'wi-carton': 1, 'wi-tubu-bottle': 2 });
    expect(packagingWizardLines(packaging(), [carton, { ...bottle, monthRemainingQty: 1 }], 999)).toEqual({ 'wi-carton': 1, 'wi-tubu-bottle': 1 });
    expect(packagingWizardLines(packaging(), [carton, { ...bottle, monthRemainingQty: 0 }], 999)).toEqual({ 'wi-carton': 1 });
    expect(packagingWizardLines(packaging(), [carton, bottle], 1)).toEqual({ 'wi-carton': 1, 'wi-tubu-bottle': 1 });
    expect(packagingWizardLines(null, [carton], 999)).toEqual({});
  });
});
