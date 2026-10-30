import { describe, expect, it } from 'vitest';
import { WAREHOUSE_ONLY_RETURN_NOTE, deskClosedText, deskDoneCopy, deskInitialLines, isPartnerWarehouseOnly } from './waste-desk';

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
