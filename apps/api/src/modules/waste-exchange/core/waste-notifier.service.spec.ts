import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { WASTE_CLOSE_REASON_VALUES, WASTE_REJECTION_REASON_VALUES } from '@tubutree/shared-types';
import { WASTE_EXPIRED_DETAIL_TEXT, WASTE_REJECTION_REASON_TEXT, WasteNotifierService, stripTrailingStop } from './waste-notifier.service';
import type { NotificationsService } from '../../notifications/notifications.service';

const make = (fail = false) => {
  const notify = jest.fn(() => (fail ? Promise.reject(new Error('down')) : Promise.resolve()));
  return { svc: new WasteNotifierService({ notify } as unknown as NotificationsService), notify };
};
const req = { id: 'r1', code: 'TR-A2C4E' };
type Call = (s: WasteNotifierService) => Promise<void>;

describe('WasteNotifierService (spec 10.2, 11.6; registry 4.4)', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each<[string, Call, string, string, Record<string, string>, string]>([
    ['parcelReceived', (s) => s.parcelReceived('u1', req, 'ev9'), 'u1', 'WASTE_PARCEL_RECEIVED', { code: 'TR-A2C4E', request_id: 'r1' }, 'waste:r1:RECEIVED:ev9'],
    ['pointsCredited points and drops', (s) => s.pointsCredited('u1', req, 12_000, 4), 'u1', 'WASTE_POINTS_CREDITED', { code: 'TR-A2C4E', result: 'Tubu đã cộng 12.000 Điểm Xanh và 4 giọt nước', request_id: 'r1' }, 'waste:r1:COMPLETED'],
    ['pointsCredited points only', (s) => s.pointsCredited('u1', req, 12_000, 0), 'u1', 'WASTE_POINTS_CREDITED', { code: 'TR-A2C4E', result: 'Tubu đã cộng 12.000 Điểm Xanh', request_id: 'r1' }, 'waste:r1:COMPLETED'],
    ['pointsCredited zero', (s) => s.pointsCredited('u1', req, 0, 0), 'u1', 'WASTE_POINTS_CREDITED', { code: 'TR-A2C4E', result: 'Số đếm được chưa đủ để cộng Điểm Xanh', request_id: 'r1' }, 'waste:r1:COMPLETED'],
    ['pointsCredited zero points with drops', (s) => s.pointsCredited('u1', req, 0, 6), 'u1', 'WASTE_POINTS_CREDITED', { code: 'TR-A2C4E', result: 'Số đếm được chưa đủ để cộng Điểm Xanh, Tubu đã thêm 6 giọt nước vào bình của bạn', request_id: 'r1' }, 'waste:r1:COMPLETED'],
    ['requestRejected HAZARDOUS', (s) => s.requestRejected('u1', req, 'HAZARDOUS'), 'u1', 'WASTE_REQUEST_REJECTED', { code: 'TR-A2C4E', reason: 'có vật không nhận', request_id: 'r1' }, 'waste:r1:REJECTED'],
    ['requestExpired HOLD_EXPIRED', (s) => s.requestExpired('u1', req, 'HOLD_EXPIRED', new Date('2026-10-20T03:00:00.000Z')), 'u1', 'WASTE_REQUEST_EXPIRED', { code: 'TR-A2C4E', detail: 'hết hạn giữ chỗ, phần trần của bạn đã được trả lại', request_id: 'r1' }, 'waste:r1:EXPIRED:2026-10-20T03:00:00.000Z'],
    ['requestExpired LOST_AT_WAREHOUSE', (s) => s.requestExpired('u1', req, 'LOST_AT_WAREHOUSE', new Date('2026-10-21T03:00:00.000Z')), 'u1', 'WASTE_REQUEST_EXPIRED', { code: 'TR-A2C4E', detail: 'kiện bị thất lạc tại kho Tubu, xin lỗi bạn. Bạn nhắn Tubu Tree để được hỗ trợ', request_id: 'r1' }, 'waste:r1:EXPIRED:2026-10-21T03:00:00.000Z'],
    ['requestExpired PICKUP_NOT_DISPATCHED', (s) => s.requestExpired('u1', req, 'PICKUP_NOT_DISPATCHED', new Date('2026-10-22T03:00:00.000Z')), 'u1', 'WASTE_REQUEST_EXPIRED', { code: 'TR-A2C4E', detail: 'Tubu chưa sắp xếp được người đến lấy rác thu kèm đơn, xin lỗi bạn. Bạn có thể gửi về kho Tubu ở lần sau', request_id: 'r1' }, 'waste:r1:EXPIRED:2026-10-22T03:00:00.000Z'],
    ['pickupStarted', (s) => s.pickupStarted('u1', req, new Date('2026-10-20T17:30:00.000Z')), 'u1', 'WASTE_PICKUP_STARTED', { code: 'TR-A2C4E', until: '21/10/2026', request_id: 'r1' }, 'waste:r1:IN_TRANSIT'],
    ['pickupCancelled', (s) => s.pickupCancelled('u1', req), 'u1', 'WASTE_PICKUP_CANCELLED', { code: 'TR-A2C4E', request_id: 'r1' }, 'waste:r1:CANCELLED'],
    ['pointsReversed', (s) => s.pointsReversed('u1', req, 7_000, 'Gian lận số lượng.'), 'u1', 'WASTE_POINTS_REVERSED', { code: 'TR-A2C4E', points: '7.000', reason: 'Gian lận số lượng', request_id: 'r1' }, 'waste:r1:REVERSED'],
    ['shipLocked', (s) => s.shipLocked('u1', new Date('2026-10-18T01:02:03.000Z')), 'u1', 'WASTE_SHIP_LOCKED', {}, 'waste-lock:u1:2026-10-18T01:02:03.000Z'],
    ['giftCancelled refunded', (s) => s.giftCancelled('u1', { id: 'g1', giftName: 'Hạt giống rau' }, 50_000), 'u1', 'WASTE_GIFT_CANCELLED', { gift: 'Hạt giống rau', points_note: ' Tubu đã hoàn 50.000 Điểm Xanh vào tài khoản của bạn.', redemption_id: 'g1' }, 'waste-gift:g1:CANCELLED'],
    ['giftCancelled not refunded', (s) => s.giftCancelled('u1', { id: 'g1', giftName: 'Hạt giống rau' }, 0), 'u1', 'WASTE_GIFT_CANCELLED', { gift: 'Hạt giống rau', points_note: ' Lượt đổi này không được hoàn điểm.', redemption_id: 'g1' }, 'waste-gift:g1:CANCELLED'],
    ['perkReviewed approved', (s) => s.perkReviewed('o1', { id: 'p1', name: 'Tạp hoá Cô Ba' }, true, 'ev5'), 'o1', 'WASTE_PERK_REVIEWED', { point: 'Tạp hoá Cô Ba', result: 'đã được duyệt', point_id: 'p1' }, 'waste-perk:p1:ev5'],
    ['perkReviewed rejected', (s) => s.perkReviewed('o1', { id: 'p1', name: 'Tạp hoá Cô Ba' }, false, 'ev6'), 'o1', 'WASTE_PERK_REVIEWED', { point: 'Tạp hoá Cô Ba', result: 'chưa được duyệt', point_id: 'p1' }, 'waste-perk:p1:ev6'],
  ])('%s', async (_n, call, user, code, data, dedupeKey) => {
    const { svc, notify } = make();
    await expect(call(svc)).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith(user, code, data, { dedupeKey });
  });

  it('a failing notify is swallowed with one warning', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc } = make(true);
    await expect(svc.pickupCancelled('u1', req)).resolves.toBeUndefined();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('every rejection and close reason has a text: no full stop at the end, no apostrophe, no voucher, no standalone xu', () => {
    expect(Object.keys(WASTE_REJECTION_REASON_TEXT).sort()).toEqual([...WASTE_REJECTION_REASON_VALUES].sort());
    expect(Object.keys(WASTE_EXPIRED_DETAIL_TEXT).sort()).toEqual([...WASTE_CLOSE_REASON_VALUES].sort());
    for (const t of [...Object.values(WASTE_REJECTION_REASON_TEXT), ...Object.values(WASTE_EXPIRED_DETAIL_TEXT)]) {
      expect(t.endsWith('.')).toBe(false);
      expect(t).not.toContain("'");
      expect(t).not.toMatch(/voucher/i);
      expect(t).not.toMatch(/(?<![\p{L}_])xu(?![\p{L}_])/iu);
    }
  });

  it('pins the rejection and expiry sentences (spec 4.6, 14.1)', () => {
    expect(WASTE_REJECTION_REASON_TEXT).toEqual({ WET: 'hàng bị ướt', DIRTY: 'hàng còn bẩn', FOREIGN_OBJECT: 'có lẫn vật lạ', WRONG_TYPE: 'không đúng loại hàng Tubu nhận', DAMAGED: 'hàng bị hỏng', NOT_ACCEPTED: 'có món Tubu không nhận', OVERSIZE: 'kiện vượt giới hạn cân nặng hoặc kích thước', HAZARDOUS: 'có vật không nhận', UNPAID_POSTAGE: 'kiện còn cước phải trả khi nhận', OTHER: 'lý do khác, Tubu đã ghi chú trong yêu cầu' });
    expect(WASTE_EXPIRED_DETAIL_TEXT).toEqual({ HOLD_EXPIRED: 'hết hạn giữ chỗ, phần trần của bạn đã được trả lại', PICKUP_NO_SHOW: 'kho chưa nhận được rác thu kèm đơn', PICKUP_NOT_DISPATCHED: 'Tubu chưa sắp xếp được người đến lấy rác thu kèm đơn, xin lỗi bạn. Bạn có thể gửi về kho Tubu ở lần sau', LOST: 'đã đóng vì kiện thất lạc trên đường gửi', LOST_AT_WAREHOUSE: 'kiện bị thất lạc tại kho Tubu, xin lỗi bạn. Bạn nhắn Tubu Tree để được hỗ trợ', SHIP_LOCKED: 'đường gửi kho và thu kèm đơn đang tạm dừng', ORDER_CANCELLED: 'đơn mua gắn kèm đã bị huỷ' });
  });

  it('stripTrailingStop removes trailing dots and spaces only', () => {
    expect(stripTrailingStop(' Gian lận số lượng... ')).toBe('Gian lận số lượng');
    expect(stripTrailingStop('Đã kiểm 3.5 kg')).toBe('Đã kiểm 3.5 kg');
  });

  it('passes each of the ten codes as a string literal to notify (notification-templates-seed gate)', () => {
    const src = readFileSync(join(__dirname, 'waste-notifier.service.ts'), 'utf-8');
    for (const code of ['WASTE_PARCEL_RECEIVED', 'WASTE_POINTS_CREDITED', 'WASTE_REQUEST_REJECTED', 'WASTE_REQUEST_EXPIRED', 'WASTE_PICKUP_STARTED', 'WASTE_PICKUP_CANCELLED', 'WASTE_POINTS_REVERSED', 'WASTE_SHIP_LOCKED', 'WASTE_GIFT_CANCELLED', 'WASTE_PERK_REVIEWED']) {
      expect(src).toMatch(new RegExp(`notify\\(\\s*\\w+,\\s*'${code}'`));
    }
  });
});
