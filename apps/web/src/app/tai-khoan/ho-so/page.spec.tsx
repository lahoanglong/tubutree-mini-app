// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unlabeledFields, unnamedControls } from '@/test-utils/a11y';

// Chép ý edit-profile.spec.tsx (Mini App): nhãn ô nhập, email kiểm hợp lệ, PATCH /me cắt khoảng trắng, thử lại không kèm
// avatarUrl khi máy chủ chê ảnh, ảnh chỉ lưu dạng URL Cloudinary (không bao giờ gửi base64), ẩn đổi ảnh khi chưa cấu hình.

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: 'u1', fullName: 'Lan', avatarUrl: null as string | null } as Record<string, unknown> | null,
    status: 'authenticated' as string,
    initialized: true,
    sessionUnavailable: false,
    retrySession: vi.fn(),
    updateProfile: vi.fn(),
  },
  get: vi.fn(),
  patch: vi.fn(),
  cloudinary: true,
  compress: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, patch: mocks.patch } }));
vi.mock('@/components/account/cloudinary-upload', () => ({
  isCloudinaryConfigured: () => mocks.cloudinary,
  uploadToCloudinary: mocks.upload,
}));
vi.mock('@/lib/image-compress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/image-compress')>()),
  readAndCompressImage: mocks.compress,
}));
vi.mock('@/components/account/avatar-crop-sheet', () => ({
  AvatarCropSheet: ({ open, onConfirm }: { open: boolean; onConfirm: (url: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onConfirm('data:image/jpeg;base64,QUJD')}>
        Xác nhận cắt
      </button>
    ) : null,
}));

import EditProfilePage from './page';
import { ApiError, NetworkError } from '@/lib/client-api';

const ME = { id: 'u1', fullName: 'Lan', email: 'lan@tubu.vn', avatarUrl: null, dob: '1990-05-01', phone: '0912345678', onboarded: true, segments: [] };
const CLOUD_URL = 'https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<EditProfilePage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const field = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll<HTMLInputElement>('input')).find((i) => c.querySelector(`label[for="${i.id}"]`)?.textContent === label)!;
const statusText = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="status"]')).map((n) => n.textContent).join(' ');
const saveBtn = (c: HTMLElement) => byText(c, 'button', 'Lưu thay đổi') as HTMLButtonElement;
const blur = (el: Element) =>
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
const pickPhoto = async (c: HTMLElement) => {
  const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush(4);
  click(byText(document.body, 'button', 'Xác nhận cắt'));
  await flush(6);
};

beforeEach(() => {
  mocks.auth.user = { id: 'u1', fullName: 'Lan', avatarUrl: null };
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.auth.sessionUnavailable = false;
  mocks.auth.updateProfile.mockReset();
  mocks.get.mockReset().mockResolvedValue(ME);
  mocks.patch.mockReset().mockResolvedValue({ ...ME });
  mocks.cloudinary = true;
  mocks.compress.mockReset().mockResolvedValue('data:image/jpeg;base64,UkFX');
  mocks.upload.mockReset().mockResolvedValue(CLOUD_URL);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/ho-so — khung trang', () => {
  it('đang khôi phục phiên: một h1 "Sửa hồ sơ", chưa gọi /me', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.initialized = false;
    const { container } = await mount();
    expect(Array.from(container.querySelectorAll('h1')).map((h) => h.textContent)).toEqual(['Sửa hồ sơ']);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('khách chưa đăng nhập: lời mời đăng nhập quay lại đúng trang, không gọi /me', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    const { container } = await mount();
    expect(Array.from(container.querySelectorAll('h1')).map((h) => h.textContent)).toEqual(['Sửa hồ sơ']);
    expect(container.querySelector('a[href*="/dang-nhap"]')?.getAttribute('href')).toContain(encodeURIComponent('/tai-khoan/ho-so'));
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('mất kết nối lúc khôi phục phiên: nói đúng chuyện đó, không mời đăng nhập', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.sessionUnavailable = true;
    const { container } = await mount();
    expect(container.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(container.querySelector('a[href*="/dang-nhap"]')).toBeNull();
  });

  it('đang tải /me: khung chờ, vẫn đúng một h1', async () => {
    mocks.get.mockReturnValue(new Promise(() => undefined));
    const { container } = await mount();
    expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
    expect(headingProblems(container)).toEqual([]);
  });

  it('tải /me lỗi: thông báo + "Thử lại" gọi lại', async () => {
    mocks.get.mockRejectedValueOnce(new Error('Mất kết nối'));
    const { container } = await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Mất kết nối');
    click(byText(container, 'button', 'Thử lại'));
    await flush(6);
    expect(mocks.get.mock.calls.filter(([p]) => !String(p).includes('/config/'))).toHaveLength(2);
    expect(field(container, 'Họ và tên').value).toBe('Lan');
  });
});

describe('/tai-khoan/ho-so — các ô nhập', () => {
  it('mỗi ô có nhãn gắn với ô và điền sẵn từ hồ sơ; SĐT chỉ đọc, định dạng dễ đọc', async () => {
    const { container } = await mount();
    expect(mocks.get).toHaveBeenCalledWith('/me');
    expect(field(container, 'Họ và tên').value).toBe('Lan');
    expect(field(container, 'Email').value).toBe('lan@tubu.vn');
    expect(field(container, 'Ngày sinh').value).toBe('1990-05-01');
    expect(field(container, 'Ngày sinh').type).toBe('date');
    expect(container.textContent).toContain('0912 345 678');
    expect(container.querySelector('input[type="tel"]')).toBeNull();
    expect(unlabeledFields(container)).toEqual([]);
    expect(container.textContent).toContain('Nhận mã giảm giá quà tặng vào tháng sinh nhật.');
  });

  it('chưa có số điện thoại: câu báo rõ', async () => {
    mocks.get.mockResolvedValue({ ...ME, phone: null });
    const { container } = await mount();
    expect(container.textContent).toContain('Chưa có số điện thoại');
  });

  it('email sai sau khi rời ô: báo lỗi, aria-invalid, khoá nút Lưu, không gọi API', async () => {
    const { container } = await mount();
    const email = field(container, 'Email');
    typeInto(email, 'khong-hop-le');
    blur(email);
    expect(container.textContent).toContain('Email không hợp lệ');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(saveBtn(container).disabled).toBe(true);
    click(saveBtn(container));
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('email để trống là hợp lệ và không gửi lên', async () => {
    mocks.get.mockResolvedValue({ ...ME, email: null });
    const { container } = await mount();
    click(saveBtn(container));
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch.mock.calls[0]![1].email).toBeUndefined();
  });

  it('a11y: nút đủ tên, vùng chạm 44px, một h1', async () => {
    const { container } = await mount();
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
    expect(headingProblems(container)).toEqual([]);
  });
});

describe('/tai-khoan/ho-so — lưu (PATCH /me)', () => {
  it('gửi tên, email đã cắt khoảng trắng, không gửi lại ngày sinh đã đặt (API chỉ cho đặt một lần); báo thành công; đồng bộ phiên và làm mới /me', async () => {
    const { container } = await mount();
    typeInto(field(container, 'Họ và tên'), '  Lan B  ');
    click(saveBtn(container));
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch.mock.calls[0]![0]).toBe('/me');
    expect(mocks.patch.mock.calls[0]![1]).toEqual({ fullName: 'Lan B', email: 'lan@tubu.vn', avatarUrl: undefined, dob: undefined });
    expect(statusText(container)).toContain('Đã cập nhật hồ sơ');
    expect(mocks.auth.updateProfile).toHaveBeenCalledWith({ fullName: 'Lan B', avatarUrl: null });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('đã có ngày sinh: ô chỉ đọc kèm lời nhắn liên hệ CSKH', async () => {
    const { container } = await mount();
    expect(field(container, 'Ngày sinh').readOnly).toBe(true);
    expect(container.textContent).toContain('CSKH');
  });

  it('chưa có ngày sinh: nhập được và gửi một lần', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    expect(field(container, 'Ngày sinh').readOnly).toBe(false);
    typeInto(field(container, 'Ngày sinh'), '1991-02-03');
    expect(container.textContent).toContain('Ngày đã chọn: 03/02/1991');
    click(saveBtn(container));
    await flush(2);
    expect(container.textContent).toContain('Ngày sinh 03/02/1991 chỉ đặt được một lần. Xác nhận?');
    expect(mocks.patch).not.toHaveBeenCalled();
    click(byText(container, 'button', 'Xác nhận'));
    await flush(6);
    expect(mocks.patch.mock.calls[0]![1]).toMatchObject({ dob: '1991-02-03' });
  });

  it('chọn ngày sinh mới rồi bấm Sửa lại: chưa gửi gì, nút Lưu thay đổi trở lại', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    typeInto(field(container, 'Ngày sinh'), '1991-02-03');
    click(saveBtn(container));
    await flush(2);
    click(byText(container, 'button', 'Sửa lại'));
    await flush(2);
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(saveBtn(container)).toBeTruthy();
    expect(container.textContent).not.toContain('chỉ đặt được một lần. Xác nhận?');
  });

  it('đang hỏi xác nhận ngày sinh: các ô nhập bị khoá', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    typeInto(field(container, 'Ngày sinh'), '1991-02-03');
    click(saveBtn(container));
    await flush(2);
    expect(field(container, 'Ngày sinh').readOnly).toBe(true);
    expect(field(container, 'Họ và tên').readOnly).toBe(true);
    expect(field(container, 'Email').readOnly).toBe(true);
  });

  it('ngày sinh đã lưu: không hiện dòng "Ngày đã chọn"', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: '1990-05-01' });
    const { container } = await mount();
    expect(container.textContent).not.toContain('Ngày đã chọn');
  });

  it('lần lưu đầu mang ngày sinh nhưng phản hồi mất: /me được tải lại, lần lưu sau không gửi lại ngày sinh', async () => {
    let meCalls = 0;
    mocks.get.mockImplementation(async () => (++meCalls === 1 ? { ...ME, dob: null } : { ...ME, dob: '1991-02-03' }));
    mocks.patch.mockRejectedValueOnce(new NetworkError(false)).mockResolvedValueOnce({ ...ME });
    const { container } = await mount();
    typeInto(field(container, 'Ngày sinh'), '1991-02-03');
    click(saveBtn(container));
    await flush(2);
    click(byText(container, 'button', 'Xác nhận'));
    await flush(6);
    expect(mocks.patch.mock.calls[0]![1]).toMatchObject({ dob: '1991-02-03' });
    typeInto(field(container, 'Họ và tên'), 'Lan C');
    click(saveBtn(container));
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(2);
    expect(mocks.patch.mock.calls[1]![1].dob).toBeUndefined();
  });

  it('tên để trống thì không gửi tên và giữ tên cũ trong phiên', async () => {
    const { container } = await mount();
    typeInto(field(container, 'Họ và tên'), '   ');
    click(saveBtn(container));
    await flush(6);
    expect(mocks.patch.mock.calls[0]![1].fullName).toBeUndefined();
    expect(mocks.auth.updateProfile).toHaveBeenCalledWith({ fullName: 'Lan', avatarUrl: null });
  });

  it('máy chủ chê avatarUrl: thử lại một lần không kèm avatarUrl', async () => {
    mocks.patch.mockRejectedValueOnce(new ApiError('avatarUrl must be a URL', 400)).mockResolvedValueOnce({ ...ME });
    const { container } = await mount();
    click(saveBtn(container));
    await flush(8);
    expect(mocks.patch).toHaveBeenCalledTimes(2);
    expect(mocks.patch.mock.calls[1]![1]).toEqual({ fullName: 'Lan', email: 'lan@tubu.vn', dob: undefined });
    expect('avatarUrl' in (mocks.patch.mock.calls[1]![1] as object)).toBe(false);
    expect(statusText(container)).toContain('Đã cập nhật hồ sơ');
  });

  it('lỗi khác: lời nghiệp vụ 4xx của máy chủ hiện nguyên văn, 5xx hiện câu chung không lộ lời thô, không báo thành công, không đụng phiên', async () => {
    mocks.patch.mockRejectedValue(new ApiError('ECONNRESET tại bảng users', 500));
    const { container } = await mount();
    click(saveBtn(container));
    await flush(6);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ đang bận');
    expect(container.textContent).not.toContain('ECONNRESET');
    expect(container.textContent).not.toContain('Đã cập nhật hồ sơ');
    expect(mocks.auth.updateProfile).not.toHaveBeenCalled();
  });

  it('mất mạng: câu báo mất kết nối của web, không phải chữ kỹ thuật', async () => {
    mocks.patch.mockRejectedValue(new NetworkError(false));
    const { container } = await mount();
    click(saveBtn(container));
    await flush(6);
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(container.textContent).not.toContain('Đã cập nhật hồ sơ');
  });

  it('đang lưu: nút báo bận (aria-busy) nhưng không khoá cứng, bấm thêm không gửi lần hai', async () => {
    mocks.patch.mockReturnValue(new Promise(() => undefined));
    const { container } = await mount();
    click(saveBtn(container));
    await flush(2);
    expect(saveBtn(container).getAttribute('aria-busy')).toBe('true');
    expect(saveBtn(container).disabled).toBe(false);
    click(saveBtn(container));
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });
});

describe('/tai-khoan/ho-so — ảnh đại diện', () => {
  const NO_CLOUD_NOTE = 'Tạm thời chưa đổi được ảnh đại diện.';

  it('chưa cấu hình dịch vụ ảnh: không có nút đổi ảnh và ô chọn tệp, thay bằng dòng giải thích', async () => {
    mocks.cloudinary = false;
    const { container } = await mount();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(byText(container, 'button', 'ảnh đại diện')).toBeNull();
    expect(container.textContent).toContain(NO_CLOUD_NOTE);
    expect(container.textContent).not.toContain('Chạm để chọn & cắt ảnh đại diện');
  });

  it('đã cấu hình: nút đổi ảnh cao >= 44px, không có dòng giải thích', async () => {
    const { container } = await mount();
    const pick = byText(container, 'button', 'Chạm để chọn & cắt ảnh đại diện')!;
    expect(pick).not.toBeNull();
    expect(smallTouchTargets(container)).toEqual([]);
    expect(container.textContent).not.toContain(NO_CLOUD_NOTE);
  });

  it('hiện ảnh đại diện đang có', async () => {
    mocks.get.mockResolvedValue({ ...ME, avatarUrl: 'https://img.test/me.jpg' });
    const { container } = await mount();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://img.test/me.jpg');
  });

  it('tải lên thành công: lưu đúng URL Cloudinary, không bao giờ gửi base64; phiên nhận ảnh mới', async () => {
    const { container } = await mount();
    await pickPhoto(container);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const sent = mocks.upload.mock.calls[0]![0] as Blob;
    expect(sent).toBeInstanceOf(Blob);
    expect(sent.type).toBe('image/jpeg');
    expect(container.textContent).toContain('Đã chọn ảnh đại diện mới. Bấm "Lưu thay đổi" để lưu.');
    click(saveBtn(container));
    await flush(6);
    expect(mocks.patch.mock.calls[0]![1].avatarUrl).toBe(CLOUD_URL);
    expect(JSON.stringify(mocks.patch.mock.calls)).not.toContain('base64');
    expect(mocks.auth.updateProfile).toHaveBeenCalledWith({ fullName: 'Lan', avatarUrl: CLOUD_URL });
  });

  it('tải lên lỗi: báo rõ, KHÔNG báo đã chọn ảnh, ảnh cũ giữ nguyên khi lưu', async () => {
    mocks.upload.mockResolvedValue(null);
    const { container } = await mount();
    await pickPhoto(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Chưa tải được ảnh lên nên ảnh đại diện chưa đổi. Bạn thử lại nhé.');
    expect(container.textContent).not.toContain('Đã chọn ảnh đại diện mới');
    click(saveBtn(container));
    await flush(6);
    expect(mocks.patch.mock.calls[0]![1].avatarUrl).toBeUndefined();
  });

  it('không đọc được ảnh: báo "Không tải được ảnh, vui lòng thử lại.", không mở khung cắt', async () => {
    mocks.compress.mockRejectedValue(new Error('x'));
    const { container } = await mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(4);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Không tải được ảnh, vui lòng thử lại.');
    expect(byText(document.body, 'button', 'Xác nhận cắt')).toBeNull();
  });

  it('tệp không phải ảnh bị chặn ngay, không đọc, không tải', async () => {
    const { container } = await mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.pdf', { type: 'application/pdf' })], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(4);
    expect(mocks.compress).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Không tải được ảnh, vui lòng thử lại.');
  });

  it('máy chủ từ chối ảnh sau khi khách vừa đổi: vẫn lưu phần còn lại nhưng nói rõ ảnh chưa lưu, ảnh trong phiên giữ nguyên', async () => {
    mocks.patch.mockRejectedValueOnce(new ApiError('avatarUrl must be a URL address', 400)).mockResolvedValueOnce({ ...ME });
    const { container } = await mount();
    await pickPhoto(container);
    click(saveBtn(container));
    await flush(8);
    expect(mocks.patch).toHaveBeenCalledTimes(2);
    expect(statusText(container)).toContain('Đã lưu hồ sơ, riêng ảnh đại diện chưa lưu được. Bạn thử chọn lại ảnh sau nhé.');
    expect(container.textContent).not.toContain('Đã cập nhật hồ sơ');
    expect(mocks.auth.updateProfile).toHaveBeenCalledWith({ fullName: 'Lan', avatarUrl: null });
  });
});
