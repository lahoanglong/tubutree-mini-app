import { describe, expect, it } from 'vitest';
import {
  SIGNUP_STEPS,
  STOREFRONT_NOTE_MAX,
  STOREFRONT_REVIEW_PROMISE,
  SIGNUP_COPY,
  sampleShareText,
  storefrontPublishedMessage,
  ctvMenuEntry,
  shouldStartSignupWizard,
  signupGate,
  storefrontNeedsReview,
  storefrontPublishCopy,
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

const COL_EMPTY = [{ items: [] as unknown[] }];
const COL_FULL = [{ items: [{}] as unknown[] }];

describe('3 trường hợp đăng gian hàng: cần duyệt, đã duyệt, cờ duyệt tắt', () => {
  const NEEDS = { needsApproval: true, approved: false };
  const APPROVED = { needsApproval: false, approved: true };
  const FLAG_OFF = { needsApproval: false, approved: false };

  it('storefrontNeedsReview: dùng needsApproval; API cũ thì suy từ approved', () => {
    expect(storefrontNeedsReview(NEEDS)).toBe(true);
    expect(storefrontNeedsReview(APPROVED)).toBe(false);
    expect(storefrontNeedsReview(FLAG_OFF)).toBe(false);
    expect(storefrontNeedsReview({ approved: false })).toBe(true);
    expect(storefrontNeedsReview({})).toBe(true);
    expect(storefrontNeedsReview({ approved: true })).toBe(false);
  });

  it('storefrontPublishCopy: chỉ trường hợp cần duyệt mới nói "Gửi duyệt"', () => {
    expect(storefrontPublishCopy(NEEDS).button).toBe(SIGNUP_COPY.submit);
    expect(storefrontPublishCopy(NEEDS).previewHint).toContain('gửi duyệt');
    const again = storefrontPublishCopy(APPROVED);
    expect(again.button).toBe('Đăng lại');
    expect(`${again.done} ${again.previewHint}`).not.toMatch(/duyệt/);
    const off = storefrontPublishCopy(FLAG_OFF);
    expect(off.button).toBe('Đăng gian hàng');
    expect(`${off.done} ${off.previewHint}`).not.toMatch(/duyệt/);
  });

  it('shouldStartSignupWizard: 4 bước cho người mới và gian hàng cần duyệt; đã duyệt hoặc cờ tắt có sản phẩm thì vào thẳng trình dựng', () => {
    expect(shouldStartSignupWizard(null)).toBe(true);
    expect(shouldStartSignupWizard({ status: 'DRAFT', ...NEEDS, collections: COL_FULL })).toBe(true);
    expect(shouldStartSignupWizard({ status: 'DRAFT', ...APPROVED, collections: COL_FULL })).toBe(false);
    expect(shouldStartSignupWizard({ status: 'DRAFT', ...FLAG_OFF, collections: COL_FULL })).toBe(false);
    expect(shouldStartSignupWizard({ status: 'DRAFT', ...APPROVED, collections: COL_EMPTY })).toBe(true);
    expect(shouldStartSignupWizard({ status: 'LIVE', ...NEEDS, collections: COL_EMPTY })).toBe(false);
    expect(shouldStartSignupWizard({ ...NEEDS, collections: COL_EMPTY })).toBe(false);
  });

  it('storefrontStatusView: nháp không cần duyệt thì không hứa "gửi duyệt"', () => {
    expect(storefrontStatusView({ status: 'DRAFT', isPublished: false, ...NEEDS }).label).toBe('Bản nháp, chưa gửi duyệt');
    const v = storefrontStatusView({ status: 'DRAFT', isPublished: false, ...APPROVED });
    expect(v.label).toBe('Chưa đăng, khách chưa thấy');
    expect(`${v.label} ${v.hint}`).not.toMatch(/duyệt/);
  });
});

describe('ctvMenuEntry', () => {
  it('CTV vào bảng điều khiển; khách thường thấy lời mời mở gian hàng, không nhắc hoa hồng', () => {
    expect(ctvMenuEntry('AFFILIATE')?.label).toBe('Cộng tác viên');
    for (const r of ['CUSTOMER', undefined, null]) {
      const e = ctvMenuEntry(r)!;
      expect(e.label).toBe('Mở gian hàng Cộng tác viên');
      expect(`${e.label} ${e.hint}`).not.toMatch(/hoa hồng/i);
    }
  });

  it('đại lý chỉ thấy mục Cộng tác viên khi còn quyền CTV (isAffiliate); đại lý thuần hoặc chưa biết quyền thì ẩn', () => {
    expect(ctvMenuEntry('DEALER', { isAffiliate: true, canRegister: false })?.label).toBe('Cộng tác viên');
    expect(ctvMenuEntry('DEALER', { isAffiliate: false, canRegister: false })).toBeNull();
    expect(ctvMenuEntry('DEALER')).toBeNull();
    expect(ctvMenuEntry('DEALER', null)).toBeNull();
  });

  it.each(['DEALER', 'STAFF', 'ADMIN'])('%s: chưa có access (đang tải, lỗi, 401) thì ẩn; có access thì theo isAffiliate', (role) => {
    expect(ctvMenuEntry(role)).toBeNull();
    expect(ctvMenuEntry(role, null)).toBeNull();
    expect(ctvMenuEntry(role, { isAffiliate: false, canRegister: false })).toBeNull();
    expect(ctvMenuEntry(role, { isAffiliate: false, canRegister: true })).toBeNull();
    expect(ctvMenuEntry(role, { isAffiliate: true })?.label).toBe('Cộng tác viên');
  });

  it.each([
    ['CUSTOMER', undefined, 'Mở gian hàng Cộng tác viên'],
    ['CUSTOMER', { isAffiliate: false, canRegister: true }, 'Mở gian hàng Cộng tác viên'],
    ['CUSTOMER', { isAffiliate: true }, 'Cộng tác viên'],
    ['AFFILIATE', undefined, 'Cộng tác viên'],
    ['AFFILIATE', { isAffiliate: false }, 'Cộng tác viên'],
    [undefined, undefined, 'Mở gian hàng Cộng tác viên'],
  ])('%s với access %j → %s', (role, access, label) => {
    expect(ctvMenuEntry(role, access)?.label).toBe(label);
  });
});

describe('storefrontPublishedMessage: lời báo theo kết quả máy chủ trả về', () => {
  it('PENDING_APPROVAL → đã gửi duyệt, kể cả khi bản đã tải trước nói không cần duyệt', () => {
    expect(storefrontPublishedMessage({ status: 'PENDING_APPROVAL' }, { needsApproval: false, approved: false })).toBe(SIGNUP_COPY.submitted);
  });

  it('LIVE → khách xem được ngay, kể cả khi bản đã tải trước nói cần duyệt', () => {
    expect(storefrontPublishedMessage({ status: 'LIVE' }, { needsApproval: true, approved: false })).toBe(SIGNUP_COPY.published);
    expect(storefrontPublishedMessage({ status: 'LIVE' }, { needsApproval: false, approved: true })).toContain('đăng lại');
  });

  it('máy chủ cũ chưa trả status: theo trạng thái trước đó', () => {
    expect(storefrontPublishedMessage({}, { needsApproval: true })).toBe(SIGNUP_COPY.submitted);
    expect(storefrontPublishedMessage(null, { needsApproval: false, approved: true })).toBe(storefrontPublishCopy({ needsApproval: false, approved: true }).done);
  });
});

describe('sampleShareText', () => {
  it('gian hàng mẫu có tiền tố "Gian hàng mẫu · ", gian hàng thật giữ nguyên', () => {
    expect(sampleShareText('Góc Mẹ Bỉm Lá', true)).toBe('Gian hàng mẫu · Góc Mẹ Bỉm Lá');
    expect(sampleShareText('Shop An', false)).toBe('Shop An');
    expect(sampleShareText('Shop An', undefined)).toBe('Shop An');
  });
});
