import { describe, expect, it } from 'vitest';
import {
  SIGNUP_STEPS,
  STOREFRONT_NOTE_MAX,
  STOREFRONT_REVIEW_PROMISE,
  signupGate,
  storefrontStatusView,
  validateStorefrontInfo,
} from './storefront-signup';

describe('SIGNUP_STEPS', () => {
  it('có đúng 4 bước theo thứ tự điều kiện, thông tin, sản phẩm, gửi duyệt', () => {
    expect(SIGNUP_STEPS.map((s) => s.key)).toEqual(['conditions', 'info', 'products', 'review']);
  });
});

describe('storefrontStatusView', () => {
  it('đã đăng nhưng chờ duyệt: nhãn "Chờ duyệt", không cho chia sẻ, không ghi "Đang hiển thị"', () => {
    const v = storefrontStatusView({ status: 'PENDING_APPROVAL', isPublished: true });
    expect(v.label).toBe('Chờ duyệt');
    expect(v.tone).toBe('warning');
    expect(v.canShare).toBe(false);
    expect(v.hint).toContain('1 ngày làm việc');
  });

  it('đang hiển thị: cho chia sẻ', () => {
    expect(storefrontStatusView({ status: 'LIVE', isPublished: true })).toMatchObject({ label: 'Đang hiển thị', canShare: true });
  });

  it('nháp, bị gỡ, bị ẩn đều không cho chia sẻ', () => {
    for (const status of ['DRAFT', 'TAKEN_DOWN', 'HIDDEN'] as const) expect(storefrontStatusView({ status, isPublished: false }).canShare).toBe(false);
  });

  it('API cũ chưa trả status: suy từ isPublished', () => {
    expect(storefrontStatusView({ isPublished: true }).code).toBe('LIVE');
    expect(storefrontStatusView({ isPublished: false }).code).toBe('DRAFT');
  });

  it('lời hứa duyệt nói rõ thời hạn', () => {
    expect(STOREFRONT_REVIEW_PROMISE).toContain('1 ngày làm việc');
  });
});

describe('signupGate', () => {
  it('CTV được mở gian hàng: sẵn sàng', () => {
    expect(signupGate({ isAffiliate: true, canRegister: false, canOpenStorefront: true })).toBe('READY');
  });
  it('khách thường đăng ký CTV được: dẫn đi đăng ký, không cho tạo gian hàng', () => {
    expect(signupGate({ isAffiliate: false, canRegister: true, canOpenStorefront: false })).toBe('NEEDS_CTV');
  });
  it('đại lý/nhân viên không đăng ký CTV được: báo không mở được', () => {
    expect(signupGate({ isAffiliate: false, canRegister: false, canOpenStorefront: false })).toBe('CANNOT_BE_CTV');
  });
  it('đại lý có hoa hồng nhưng không còn gian hàng CTV: không phải sẵn sàng', () => {
    expect(signupGate({ isAffiliate: true, canRegister: false, canOpenStorefront: false })).toBe('CANNOT_BE_CTV');
  });
  it('chưa có dữ liệu: coi như cần đăng ký', () => {
    expect(signupGate(undefined)).toBe('NEEDS_CTV');
  });
});

describe('validateStorefrontInfo', () => {
  it('tên trống bị chặn, mô tả quá dài bị chặn, hợp lệ trả null', () => {
    expect(validateStorefrontInfo({ title: '  ', headerNote: '' })).toContain('tên');
    expect(validateStorefrontInfo({ title: 'Góc Xanh', headerNote: 'a'.repeat(STOREFRONT_NOTE_MAX + 1) })).toContain('Mô tả');
    expect(validateStorefrontInfo({ title: 'Góc Xanh', headerNote: '' })).toBeNull();
  });
});
