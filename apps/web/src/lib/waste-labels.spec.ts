import { describe, expect, it } from 'vitest';
import {
  WASTE_ACTOR_ROLE_LABELS,
  WASTE_ADMIN_SECTIONS,
  WASTE_EVENT_KIND_LABELS,
  WASTE_MATCH_BASIS_LABELS,
  summarizeOpeningHours,
  wasteActorRoleLabel,
  wasteEventKindLabel,
  wasteEventMetaLines,
  WASTE_CLOSE_REASON_LABELS,
  WASTE_GIFT_KIND_LABELS,
  WASTE_GIFT_REDEMPTION_STATUS_LABELS,
  WASTE_GIFT_STATUS_LABELS,
  WASTE_ITEM_STATUS_LABELS,
  WASTE_METHOD_LABELS,
  WASTE_POINT_KIND_LABELS,
  WASTE_POINT_STATUS_LABELS,
  WASTE_REJECTION_REASON_LABELS,
  WASTE_REQUEST_STATUS_LABELS,
  WASTE_SECTION_LABELS,
  WASTE_SHORTFALL_REASON_LABELS,
  WASTE_STAFF_SECTIONS,
  WASTE_UNMATCHED_REASON_LABELS,
} from './waste-labels';
import { expectNoBannedCopy } from '@/test-utils/fixtures/waste-admin';

describe('waste-labels', () => {
  it('nhãn trạng thái món đúng ba giá trị của spec 9', () => {
    expect(Object.values(WASTE_ITEM_STATUS_LABELS)).toEqual(['Đang nhận', 'Sắp nhận', 'Ẩn']);
  });

  it('lý do thiếu đúng bảy nhãn của spec 4.10', () => {
    expect(Object.values(WASTE_SHORTFALL_REASON_LABELS)).toEqual(['Ướt', 'Bẩn', 'Lẫn vật lạ', 'Sai loại', 'Hỏng', 'Không nhận', 'Khác']);
  });

  it('lý do từ chối có đủ 10 mã, thêm Quá khổ / Hàng nguy hại / Chưa trả đủ cước', () => {
    expect(Object.keys(WASTE_REJECTION_REASON_LABELS)).toHaveLength(10);
    expect(WASTE_REJECTION_REASON_LABELS.UNPAID_POSTAGE).toBe('Chưa trả đủ cước');
    expect(WASTE_REJECTION_REASON_LABELS.OVERSIZE).toBe('Quá khổ');
    expect(WASTE_REJECTION_REASON_LABELS.HAZARDOUS).toBe('Hàng nguy hại (pin, hoá chất)');
  });

  it('quà TREE ghi "Góp quỹ trồng cây"', () => {
    expect(WASTE_GIFT_KIND_LABELS.TREE).toBe('Góp quỹ trồng cây');
  });

  it('năm mục theo thứ tự, nhân viên chỉ có Yêu cầu và Quà', () => {
    expect(WASTE_ADMIN_SECTIONS.map((s) => WASTE_SECTION_LABELS[s])).toEqual(['Hàng nhận', 'Điểm nhận', 'Yêu cầu', 'Quà', 'Cấu hình chung']);
    expect(WASTE_STAFF_SECTIONS).toEqual(['requests', 'gifts']);
  });

  it('không nhãn nào chứa chữ cấm', () => {
    const records: Record<string, string>[] = [
      WASTE_METHOD_LABELS,
      WASTE_REQUEST_STATUS_LABELS,
      WASTE_CLOSE_REASON_LABELS,
      WASTE_SHORTFALL_REASON_LABELS,
      WASTE_REJECTION_REASON_LABELS,
      WASTE_ITEM_STATUS_LABELS,
      WASTE_POINT_STATUS_LABELS,
      WASTE_POINT_KIND_LABELS,
      WASTE_GIFT_KIND_LABELS,
      WASTE_GIFT_STATUS_LABELS,
      WASTE_GIFT_REDEMPTION_STATUS_LABELS,
      WASTE_UNMATCHED_REASON_LABELS,
      WASTE_SECTION_LABELS,
    ];
    expectNoBannedCopy(records.flatMap((r) => Object.values(r)).join(' '));
  });

  it('nhật ký sự kiện: nhãn có chữ, kind lạ là "Sự kiện khác", meta chỉ ra câu đã biết', () => {
    expect(wasteEventKindLabel('REQUEST_CONFIRMED')).toBe('Xác nhận và cộng điểm');
    expect(wasteEventKindLabel('NOPE')).toBe('Sự kiện khác');
    expect(wasteEventKindLabel('toString')).toBe('Sự kiện khác');
    expect(wasteActorRoleLabel('SYSTEM')).toBe('Hệ thống');
    expect(wasteEventMetaLines('REQUEST_CONFIRMED', null)).toEqual([]);
    expect(wasteEventMetaLines('REQUEST_CONFIRMED', { subjectUserId: 'u-1', device: { ua: 'x' }, before: { status: 'OPEN' } })).toEqual([]);
    expect(wasteEventMetaLines('REQUEST_CONFIRMED', { after: { pointsAwarded: 3000 } })).toEqual(['Cộng 3.000 điểm']);
    expect(wasteEventMetaLines('REQUEST_CONFIRMED', { pointsAwarded: 0 })).toEqual(['Cộng 0 điểm']);
    expect(wasteEventMetaLines('POINTS_REVERSED', { reason: 'Nhầm', pointsAwarded: 17000, pointsTaken: 5000, shortfallPoints: 12000 })).toEqual([
      'Thu hồi 5.000 điểm',
      'Còn thiếu 12.000 điểm chưa thu hồi được',
      'Lý do: Nhầm',
    ]);
    expect(wasteEventMetaLines('POINTS_REVERSED', { pointsTaken: 500, shortfallPoints: 0, reason: ' Nhầm ' })).toEqual(['Thu hồi 500 điểm', 'Lý do: Nhầm']);
    const unmatched = wasteEventMetaLines('PARCEL_UNMATCHED', { reason: 'EXPIRED_REQUEST', unmatchedId: 'x' });
    expect(unmatched).toEqual(['Lý do: Yêu cầu đã hết hạn']);
    expect(unmatched.join(' ')).not.toContain('EXPIRED_REQUEST');
    expect(wasteEventMetaLines('PARCEL_UNMATCHED', { reason: 'SOMETHING_NEW' })).toEqual([]);
    for (const k of ['POINTS_REVERSED', 'REQUEST_CLOSED_LOST', 'REQUEST_REOPENED', 'USER_FLAGS_UPDATED', 'GIFT_CANCELLED']) {
      expect(wasteEventMetaLines(k, { reason: 'Khách nhờ' })).toEqual(['Lý do: Khách nhờ']);
    }
    expect(wasteEventMetaLines('UNMATCHED_CLOSED', { reason: 'NO_MATCH' })).toEqual([]);
    expectNoBannedCopy([...Object.values(WASTE_EVENT_KIND_LABELS), ...Object.values(WASTE_ACTOR_ROLE_LABELS), ...Object.values(WASTE_MATCH_BASIS_LABELS)].join(' '));
  });

  it('giờ mở cửa: gộp ngày liền nhau cùng khung giờ, bỏ ngày nghỉ', () => {
    const wk = [{ open: '08:00', close: '17:00' }];
    expect(summarizeOpeningHours({})).toEqual([]);
    expect(summarizeOpeningHours({ MON: wk, TUE: wk, WED: wk, SAT: [{ open: '08:00', close: '12:00' }] })).toEqual(['T2–T4 08:00–17:00', 'T7 08:00–12:00']);
    expect(summarizeOpeningHours({ MON: wk, WED: wk })).toEqual(['T2 08:00–17:00', 'T4 08:00–17:00']);
    expect(summarizeOpeningHours({ SUN: [{ open: '08:00', close: '11:00' }, { open: '14:00', close: '17:00' }] })).toEqual(['CN 08:00–11:00, 14:00–17:00']);
  });
});
