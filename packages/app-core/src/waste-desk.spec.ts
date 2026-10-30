import { describe, expect, it } from 'vitest';
import { WAREHOUSE_ONLY_RETURN_NOTE, deskClosedText, deskGiftReadOnly, deskDoneCopy, deskInitialLines, isPartnerWarehouseOnly } from './waste-desk';

const fmt = (n: number) => `${n.toLocaleString('vi-VN')} điểm`;
const LINES = [
  { itemId: 'milk', declaredQty: 10, warehouseOnly: true },
  { itemId: 'can', declaredQty: 4, warehouseOnly: false },
];

describe('deskInitialLines: số nhận mặc định của quầy', () => {
  it('điểm đối tác: món chỉ kho nhận mặc định 0 và có sẵn lý do "Không nhận", món khác mặc định số khai', () => {
    expect(deskInitialLines(LINES, 'PARTNER')).toEqual({ received: { milk: 0, can: 4 }, reasons: { milk: 'NOT_ACCEPTED', can: '' } });
  });
  it('kho Tubu: mọi món mặc định số khai, chưa chọn lý do nào', () => {
    expect(deskInitialLines(LINES, 'WAREHOUSE')).toEqual({ received: { milk: 10, can: 4 }, reasons: { milk: '', can: '' } });
  });
  it('isPartnerWarehouseOnly chỉ đúng khi điểm là đối tác và món chỉ kho nhận', () => {
    expect(isPartnerWarehouseOnly(LINES[0]!, 'PARTNER')).toBe(true);
    expect(isPartnerWarehouseOnly(LINES[0]!, 'WAREHOUSE')).toBe(false);
    expect(isPartnerWarehouseOnly(LINES[1]!, 'PARTNER')).toBe(false);
  });
  it('câu giải thích cho nhân viên', () => expect(WAREHOUSE_ONLY_RETURN_NOTE).toBe('Chỉ kho HCMC nhận, trả lại khách'));
});

describe('deskDoneCopy: chữ sau khi duyệt', () => {
  it('có điểm: nói Tubu sẽ cộng bao nhiêu', () => {
    expect(deskDoneCopy(2000, fmt)).toEqual({ heading: `Đã ghi nhận. Tubu sẽ cộng ${fmt(2000)} cho khách`, toast: `Tubu sẽ cộng ${fmt(2000)} cho khách` });
  });
  it('0 điểm: không nói "cộng 0 điểm", nói lần này chưa đủ để cộng', () => {
    const c = deskDoneCopy(0, fmt);
    expect(c.heading).toBe('Đã ghi nhận. Lần này chưa đủ để cộng điểm');
    expect(c.toast).toBe('Đã ghi nhận. Lần này chưa đủ để cộng điểm');
    expect(c.heading + c.toast).not.toMatch(/cộng 0/);
  });
});

describe('deskClosedText: yêu cầu vừa đóng, chỉ đọc', () => {
  it('COMPLETED: "Đã duyệt lúc HH:mm" theo giờ Việt Nam', () => {
    const now = new Date('2026-10-28T08:00:00.000Z');
    expect(deskClosedText({ status: 'COMPLETED', closedAt: '2026-10-28T03:05:00.000Z' }, now)).toBe('Đã duyệt lúc 10:05');
    expect(deskClosedText({ status: 'COMPLETED', closedAt: '2026-10-28T17:30:00.000Z' }, new Date('2026-10-28T18:00:00.000Z'))).toBe('Đã duyệt lúc 00:30');
  });
  it('đóng từ hôm trước (giờ Việt Nam) thì thêm ngày, để nhân viên không hiểu nhầm là hôm nay', () => {
    const now = new Date('2026-10-29T02:00:00.000Z');
    expect(deskClosedText({ status: 'COMPLETED', closedAt: '2026-10-28T03:05:00.000Z' }, now)).toBe('Đã duyệt lúc 10:05 ngày 28/10');
    expect(deskClosedText({ status: 'COMPLETED', closedAt: '2026-10-05T03:05:00.000Z' }, now)).toBe('Đã duyệt lúc 10:05 ngày 05/10');
  });
  it('cùng ngày giờ Việt Nam thì chỉ hiện giờ, kể cả khi giờ UTC đã sang ngày khác', () => {
    const now = new Date('2026-10-29T02:00:00.000Z');
    expect(deskClosedText({ status: 'COMPLETED', closedAt: '2026-10-28T17:30:00.000Z' }, now)).toBe('Đã duyệt lúc 00:30');
    expect(deskClosedText({ status: 'COMPLETED', closedAt: '2026-10-28T16:59:00.000Z' }, now)).toBe('Đã duyệt lúc 23:59 ngày 28/10');
  });
  it('COMPLETED thiếu giờ đóng: "Đã duyệt"', () => expect(deskClosedText({ status: 'COMPLETED', closedAt: null })).toBe('Đã duyệt'));
  it('REJECTED: "Đã từ chối"', () => expect(deskClosedText({ status: 'REJECTED', closedAt: '2026-10-28T03:05:00.000Z' })).toBe('Đã từ chối'));
});

describe('deskGiftReadOnly: thẻ quà chỉ đọc ở quầy', () => {
  const fmtDt = (iso: string) => `T(${iso})`;
  const f = { dateTime: fmtDt, points: fmt };
  const now = new Date('2026-11-20T00:00:00.000Z');

  it('READY còn hạn hoặc không có hạn: null (hiện nút Trao quà)', () => {
    expect(deskGiftReadOnly({ status: 'READY', claimExpiresAt: '2026-11-21T00:00:00.000Z' }, f, now)).toBeNull();
    expect(deskGiftReadOnly({ status: 'READY', claimExpiresAt: null }, f, now)).toBeNull();
  });
  it('READY có hạn sớm hơn trong cùng ngày VN: chưa quá hạn, vẫn trao được; sang ngày VN kế tiếp mới quá hạn', () => {
    expect(deskGiftReadOnly({ status: 'READY', claimExpiresAt: '2026-11-19T17:30:00.000Z' }, f, new Date('2026-11-20T07:00:00.000Z'))).toBeNull();
    expect(deskGiftReadOnly({ status: 'READY', claimExpiresAt: '2026-11-19T17:30:00.000Z' }, f, new Date('2026-11-20T17:00:00.000Z'))!.heading).toBe('Quà đã quá hạn nhận');
  });
  it('READY đã quá hạn: nói rõ quầy không trao được, hệ thống sẽ huỷ và hoàn điểm', () => {
    const r = deskGiftReadOnly({ status: 'READY', claimExpiresAt: '2026-11-19T00:00:00.000Z' }, f, now)!;
    expect(r.heading).toBe('Quà đã quá hạn nhận');
    expect(r.notes).toEqual(['Quầy không trao được nữa. Tubu sẽ xử lý lượt đổi này và báo khách']);
  });
  it('FULFILLED: đã trao, giờ trao, số điểm khách đã đổi', () => {
    expect(deskGiftReadOnly({ status: 'FULFILLED', claimExpiresAt: null, fulfilledAt: '2026-11-10T03:00:00.000Z', pointsCost: 30000 }, f, now)).toEqual({
      heading: 'Quà đã được trao',
      notes: ['Trao lúc T(2026-11-10T03:00:00.000Z)', `Khách đổi bằng ${fmt(30000)}`],
    });
  });
  it('CANCELLED do quá hạn: giờ huỷ, lý do, điểm đã hoàn', () => {
    expect(deskGiftReadOnly({ status: 'CANCELLED', claimExpiresAt: null, cancelledAt: '2026-11-11T03:00:00.000Z', cancelReason: 'Quá hạn nhận', refundedPoints: 30000 }, f, now)).toEqual({
      heading: 'Lượt đổi quà đã huỷ',
      notes: ['Huỷ lúc T(2026-11-11T03:00:00.000Z)', 'Lý do: Quá hạn nhận', `Đã hoàn ${fmt(30000)} cho khách`],
    });
  });
  it('bản API cũ không gửi chi tiết: vẫn ra tiêu đề, không có ghi chú', () => {
    expect(deskGiftReadOnly({ status: 'CANCELLED', claimExpiresAt: null }, f, now)).toEqual({ heading: 'Lượt đổi quà đã huỷ', notes: [] });
    expect(deskGiftReadOnly({ status: 'CANCELLED', claimExpiresAt: null, refundedPoints: 0 }, f, now)!.notes).toEqual([]);
  });
});
