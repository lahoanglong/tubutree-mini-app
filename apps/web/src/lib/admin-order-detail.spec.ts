import { describe, it, expect } from 'vitest';
import {
  actorLabel,
  canIssueInvoice,
  formatShippingAddress,
  invoiceStatusLabel,
  invoiceUrlError,
} from './admin-order-detail';

// C-092/C-094: CSKH tra địa chỉ giao + lịch sử trạng thái, kế toán xử lý đơn yêu cầu VAT ngay trong chi tiết đơn.
describe('formatShippingAddress', () => {
  it('ghép đường, phường/xã, quận/huyện, tỉnh/thành và bỏ phần rỗng (hệ 2 cấp không có quận)', () => {
    expect(
      formatShippingAddress({ recipient: 'Nguyễn A', phone: '0900000001', street: '12 Lê Lợi', ward: 'Bến Nghé', district: '', province: 'TP. Hồ Chí Minh' }),
    ).toEqual({ recipient: 'Nguyễn A', phone: '0900000001', line: '12 Lê Lợi, Bến Nghé, TP. Hồ Chí Minh' });
    expect(
      formatShippingAddress({ recipient: 'B', phone: '1', street: '1 A', ward: 'P1', district: 'Q1', province: 'HCM' })?.line,
    ).toBe('1 A, P1, Q1, HCM');
  });

  it('thiếu hẳn / rỗng / không phải object → null (UI hiện "chưa có địa chỉ giao")', () => {
    expect(formatShippingAddress(undefined)).toBeNull();
    expect(formatShippingAddress(null)).toBeNull();
    expect(formatShippingAddress({})).toBeNull();
    expect(formatShippingAddress({ recipient: '  ', street: '' })).toBeNull();
    expect(formatShippingAddress('lạ' as never)).toBeNull();
  });

  it('chỉ có người nhận hoặc chỉ có địa chỉ vẫn hiện phần có', () => {
    expect(formatShippingAddress({ recipient: 'A' })).toEqual({ recipient: 'A', phone: '', line: '' });
    expect(formatShippingAddress({ street: '5 B' })).toEqual({ recipient: '', phone: '', line: '5 B' });
  });
});

describe('actorLabel', () => {
  it('nhãn tiếng Việt theo loại tác nhân; ADMIN kèm tên/SĐT nếu có', () => {
    expect(actorLabel({ actorType: 'PANCAKE', actor: null })).toBe('Pancake');
    expect(actorLabel({ actorType: 'SYSTEM', actor: null })).toBe('Hệ thống');
    expect(actorLabel({ actorType: 'CUSTOMER', actor: { id: 'u', fullName: 'Lan', phone: '09' } })).toBe('Khách · Lan');
    expect(actorLabel({ actorType: 'ADMIN', actor: { id: 'u', fullName: null, phone: '0900000009' } })).toBe('Admin · 0900000009');
    expect(actorLabel({ actorType: 'ADMIN', actor: null })).toBe('Admin');
    expect(actorLabel({ actorType: 'LẠ', actor: null })).toBe('LẠ');
  });
});

describe('invoiceStatusLabel', () => {
  it('REQUESTED chờ xuất, ISSUED đã xuất, FAILED lỗi; NOT_REQUESTED/null không hiện', () => {
    expect(invoiceStatusLabel('REQUESTED')).toEqual({ label: 'Chờ xuất hoá đơn', tone: 'warning' });
    expect(invoiceStatusLabel('ISSUED')).toEqual({ label: 'Đã xuất hoá đơn', tone: 'success' });
    expect(invoiceStatusLabel('FAILED')).toEqual({ label: 'Xuất hoá đơn lỗi', tone: 'danger' });
    expect(invoiceStatusLabel('NOT_REQUESTED')).toBeNull();
    expect(invoiceStatusLabel(null)).toBeNull();
    expect(invoiceStatusLabel(undefined)).toBeNull();
  });
});

describe('canIssueInvoice — cùng luật với AdminService.issueOrderInvoice', () => {
  const req = { taxCode: '0312345678', companyName: 'ABC', address: 'x', email: 'a@b.vn' };
  it('có yêu cầu VAT + chưa ISSUED + đơn chưa huỷ/trả → bấm được', () => {
    expect(canIssueInvoice({ invoiceRequest: req, invoiceStatus: 'REQUESTED', status: 'DELIVERED' })).toBe(true);
    expect(canIssueInvoice({ invoiceRequest: req, invoiceStatus: 'FAILED', status: 'CONFIRMED' })).toBe(true);
    expect(canIssueInvoice({ invoiceRequest: req, invoiceStatus: null, status: 'CONFIRMED' })).toBe(true);
  });
  it('đã ISSUED / không có yêu cầu / đơn huỷ-trả → không', () => {
    expect(canIssueInvoice({ invoiceRequest: req, invoiceStatus: 'ISSUED', status: 'DELIVERED' })).toBe(false);
    expect(canIssueInvoice({ invoiceRequest: null, invoiceStatus: 'REQUESTED', status: 'DELIVERED' })).toBe(false);
    expect(canIssueInvoice({ invoiceRequest: undefined, invoiceStatus: undefined, status: 'DELIVERED' })).toBe(false);
    expect(canIssueInvoice({ invoiceRequest: req, invoiceStatus: 'REQUESTED', status: 'CANCELLED' })).toBe(false);
    expect(canIssueInvoice({ invoiceRequest: req, invoiceStatus: 'REQUESTED', status: 'RETURNED' })).toBe(false);
  });
});

describe('invoiceUrlError — khớp IssueInvoiceDto (https, ≤ 500)', () => {
  it('rỗng hợp lệ (link tuỳ chọn); https hợp lệ', () => {
    expect(invoiceUrlError('')).toBeNull();
    expect(invoiceUrlError('   ')).toBeNull();
    expect(invoiceUrlError('https://hoadon.example.vn/abc?x=1')).toBeNull();
  });
  it('http / javascript: / không phải link / quá dài → báo lỗi', () => {
    expect(invoiceUrlError('http://hd.vn/1')).toMatch(/https/);
    expect(invoiceUrlError('javascript:alert(1)')).toMatch(/https/);
    expect(invoiceUrlError('hoadon của tôi')).toMatch(/https/);
    expect(invoiceUrlError(`https://hd.vn/${'a'.repeat(500)}`)).toMatch(/500/);
  });
});
