// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
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

  it('"Thử lại" chạm đúp cùng một act (W78B): /me chỉ tải lại một lần, về rồi hiện hồ sơ', async () => {
    mocks.get.mockRejectedValueOnce(new Error('Mất kết nối'));
    const { container } = await mount();
    const meCalls = () => mocks.get.mock.calls.filter(([p]) => !String(p).includes('/config/')).length;
    expect(meCalls()).toBe(1);
    let release!: () => void;
    mocks.get.mockImplementationOnce(() => new Promise((r) => (release = () => r(ME))));
    const retry = byText(container, 'button', 'Thử lại') as HTMLButtonElement;
    act(() => {
      retry.click();
      retry.click();
    });
    await flush(2);
    expect(meCalls()).toBe(2);
    await act(async () => release());
    await flush(6);
    expect(meCalls()).toBe(2);
    expect(field(container, 'Họ và tên').value).toBe('Lan');
  });
});

describe('/tai-khoan/ho-so — "Thử lại" khi chưa có hồ sơ (W78B)', () => {
  // `refetch()` thứ hai huỷ lượt đầu và gọi API lần nữa, nên chỉ khoá nút mới giữ một lượt. Khi đã có hồ sơ mà lần tải lại nền lỗi thì
  // trang giữ nguyên form (không có khối lỗi, xem ca "lưu lỗi rồi tải lại /me cũng lỗi"), nên nút Thử lại chỉ còn ở lần tải đầu.
  it('chạm đúp cùng một act: /me chỉ tải lại một lần', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.get.mockRejectedValueOnce(new Error('Mất kết nối'));
    const r = render(<EditProfilePage />, client);
    mounted.push(r);
    await flush(6);
    const meCalls = () => mocks.get.mock.calls.filter(([p]) => !String(p).includes('/config/')).length;
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Mất kết nối');
    const before = meCalls();
    let release!: () => void;
    mocks.get.mockImplementationOnce(() => new Promise((res) => (release = () => res(ME))));
    const retry = byText(r.container, 'button', 'Thử lại') as HTMLButtonElement;
    act(() => {
      retry.click();
      retry.click();
    });
    await flush(2);
    expect(meCalls()).toBe(before + 1);
    await act(async () => release());
    await flush(6);
    expect(meCalls()).toBe(before + 1);
    expect(field(r.container, 'Họ và tên').value).toBe('Lan');
  });
});

describe('/tai-khoan/ho-so — các ô nhập', () => {
  it('mỗi ô có nhãn gắn với ô và điền sẵn từ hồ sơ; SĐT chỉ đọc, định dạng dễ đọc', async () => {
    const { container } = await mount();
    expect(mocks.get).toHaveBeenCalledWith('/me');
    expect(field(container, 'Họ và tên').value).toBe('Lan');
    expect(field(container, 'Email').value).toBe('lan@tubu.vn');
    expect(field(container, 'Ngày sinh').value).toBe('01/05/1990');
    expect(field(container, 'Ngày sinh').type).toBe('text');
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
  it.each(['', '   ', '\u200b '])('xoá trắng họ tên (%j) rồi bấm Lưu: báo lỗi ở ô, aria-invalid, khoá nút, không gọi API, không báo thành công', async (blank) => {
    const { container } = await mount();
    const name = field(container, 'Họ và tên');
    typeInto(name, blank);
    click(saveBtn(container));
    await flush(4);
    expect(container.textContent).toContain('Nhập họ tên để lưu hồ sơ.');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(saveBtn(container).disabled).toBe(true);
    click(saveBtn(container));
    await flush(4);
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(statusText(container)).not.toContain('Đã cập nhật hồ sơ');
    typeInto(name, ' Lan C ');
    expect(container.textContent).not.toContain('Nhập họ tên để lưu hồ sơ.');
    click(saveBtn(container));
    await flush(6);
    expect(mocks.patch.mock.calls[0]![1].fullName).toBe('Lan C');
  });

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
    typeInto(field(container, 'Ngày sinh'), '03/02/1991');
    expect(container.textContent).toContain('Ngày đã chọn: 03/02/1991');
    click(saveBtn(container));
    await flush(2);
    expect(container.textContent).toContain('Ngày sinh 3 tháng 2 năm 1991 chỉ đặt được một lần. Xác nhận?');
    expect(mocks.patch).not.toHaveBeenCalled();
    click(byText(container, 'button', 'Xác nhận'));
    await flush(6);
    expect(mocks.patch.mock.calls[0]![1]).toMatchObject({ dob: '1991-02-03' });
  });

  it('ô ngày sinh là ô chữ dd/mm/yyyy, gõ liền số tự thêm dấu / (R-110)', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    const input = field(container, 'Ngày sinh');
    expect(input.type).toBe('text');
    expect(input.placeholder).toBe('dd/mm/yyyy');
    typeInto(input, '29022000');
    expect(input.value).toBe('29/02/2000');
  });

  it('gõ 5/3/1990 tự thành 05/03/1990 (thêm số 0)', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    const input = field(container, 'Ngày sinh');
    typeInto(input, '5/3/1990');
    expect(input.value).toBe('05/03/1990');
  });

  it('ngày không có thật hoặc tương lai: báo lỗi rõ và không gửi', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    typeInto(field(container, 'Ngày sinh'), '29/02/2023');
    expect(container.textContent).toContain('Ngày này không có thật. Kiểm tra lại ngày và tháng nhé.');
    click(saveBtn(container));
    await flush(2);
    expect(mocks.patch).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('chỉ đặt được một lần. Xác nhận?');
    typeInto(field(container, 'Ngày sinh'), '01/01/2999');
    expect(container.textContent).toContain('Ngày sinh không thể ở tương lai. Kiểm tra lại năm nhé.');
    click(saveBtn(container));
    await flush(2);
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('gõ dở rồi bấm Lưu: báo nhập đủ ngày/tháng/năm, không gửi', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    typeInto(field(container, 'Ngày sinh'), '0503');
    click(saveBtn(container));
    await flush(2);
    expect(container.textContent).toContain('Nhập đủ ngày/tháng/năm, ngày và tháng gõ 2 số, ví dụ 05/03/1990.');
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('29/02/2000 hợp lệ: gửi dob ISO 2000-02-29', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    typeInto(field(container, 'Ngày sinh'), '29/02/2000');
    click(saveBtn(container));
    await flush(2);
    click(byText(container, 'button', 'Xác nhận'));
    await flush(6);
    expect(mocks.patch.mock.calls[0]![1]).toMatchObject({ dob: '2000-02-29' });
  });

  it('chọn ngày sinh mới rồi bấm Sửa lại: chưa gửi gì, nút Lưu thay đổi trở lại', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    typeInto(field(container, 'Ngày sinh'), '03/02/1991');
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
    typeInto(field(container, 'Ngày sinh'), '03/02/1991');
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
    typeInto(field(container, 'Ngày sinh'), '03/02/1991');
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

  it('lưu lỗi rồi tải lại /me cũng lỗi: form vẫn ở đó cùng lời báo lỗi lưu, không thay cả trang bằng màn lỗi', async () => {
    mocks.patch.mockRejectedValue(new ApiError('Máy chủ lỗi', 500));
    const { container } = await mount();
    mocks.get.mockRejectedValue(new NetworkError(false));
    click(saveBtn(container));
    await flush(8);
    expect(saveBtn(container)).not.toBeNull();
    expect(field(container, 'Họ và tên')).toBeDefined();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ đang bận');
    expect(byText(container, 'button', 'Thử lại')).toBeNull();
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

  it('chưa cấu hình dịch vụ ảnh: không có nút đổi ảnh, ô chọn tệp, câu báo thiếu chức năng; avatar là chữ cái đầu', async () => {
    mocks.cloudinary = false;
    const { container } = await mount();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(byText(container, 'button', 'ảnh đại diện')).toBeNull();
    expect(container.textContent).not.toContain(NO_CLOUD_NOTE);
    expect(container.textContent).not.toContain('Chạm để chọn & cắt ảnh đại diện');
    expect(container.querySelector('[data-testid="profile-avatar-initial"]')!.textContent).toBe('L');
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

  it('không đọc được ảnh: báo "Không tải được ảnh. Thử lại sau ít phút.", không mở khung cắt', async () => {
    mocks.compress.mockRejectedValue(new Error('x'));
    const { container } = await mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(4);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Không tải được ảnh. Thử lại sau ít phút.');
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
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Không tải được ảnh. Thử lại sau ít phút.');
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

describe('/tai-khoan/ho-so — truy cập (A11Y-02, A11Y-16)', () => {
  it('A11Y-16: ô ngày sinh được mô tả bằng dòng gợi ý có định dạng ngày/tháng/năm (không chỉ placeholder)', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    const input = field(container, 'Ngày sinh');
    const hint = document.getElementById(input.getAttribute('aria-describedby')!.split(' ')[0]!)!;
    expect(hint.textContent).toContain('Nhận mã giảm giá quà tặng vào tháng sinh nhật');
    expect(hint.textContent).toContain('ngày/tháng/năm');
    expect(hint.querySelector('.sr-only')).not.toBeNull();
  });

  it('A11Y-16: đã có ngày sinh (ô chỉ đọc) vẫn có mô tả nhưng không thêm câu định dạng', async () => {
    const { container } = await mount();
    const hint = document.getElementById(field(container, 'Ngày sinh').getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toContain('CSKH');
    expect(hint.textContent).not.toContain('ngày/tháng/năm');
  });

  it('A11Y-16: hộp xác nhận ngày sinh (alertdialog) mở ra thì nhận focus, chỉ một lần (vẽ lại không giật focus)', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    typeInto(field(container, 'Ngày sinh'), '03/02/1991');
    click(saveBtn(container));
    await flush(2);
    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(document.activeElement).toBe(dialog);
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    const no = byText(dialog, 'button', 'Sửa lại') ?? dialog.querySelectorAll('button')[1]!;
    (no as HTMLElement).focus();
    await flush(2);
    expect(document.activeElement).toBe(no);
  });

  it('A11Y-02: vùng báo ảnh đại diện role=status có sẵn trong cây; lời báo đến thì chính nút đó chứa chữ', async () => {
    const { container } = await mount();
    const region = container.querySelector('form [role="status"]:not(p)')!;
    expect(region).not.toBeNull();
    expect(region.textContent).toBe('');
    mocks.compress.mockRejectedValue(new Error('không đọc được'));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })], configurable: true });
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(8);
    expect(region.isConnected).toBe(true);
    expect(container.querySelector('form [role="status"]:not(p)')).toBe(region);
    expect(region.textContent).not.toBe('');
  });
});

// Khoá chống lưu hai lần và tải ảnh hai lần: hai cú chạm trong CÙNG một act (chưa có lần vẽ lại xen giữa) chỉ ra một lần gọi API;
// khoá giữ tới khi /me mới về; nút đang lưu không `disabled` thật nên focus ở lại nút.
const twice = (el: Element | null) =>
  act(() => {
    (el as HTMLElement).click();
    (el as HTMLElement).click();
  });
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const alertRegion = (c: HTMLElement) => c.querySelector<HTMLElement>('form > [role="alert"]');

describe('/tai-khoan/ho-so — khoá lưu hồ sơ (cùng một act)', () => {
  it('chạm đúp Lưu trong cùng một act chỉ một PATCH; nút đang lưu không disabled, aria-busy + aria-disabled, focus không rời nút', async () => {
    const gate = deferred<unknown>();
    mocks.patch.mockReturnValue(gate.promise);
    const { container } = await mount();
    const btn = saveBtn(container);
    btn.focus();
    await twice(btn);
    await flush(2);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(saveBtn(container)).toBe(btn);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(btn);
    gate.resolve({ ...ME });
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
  });

  it('thành công: khoá giữ tới khi /me mới về, bấm thêm lúc đó không gửi lần hai; về rồi thì lưu lại được', async () => {
    const meGate = deferred();
    let meCalls = 0;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/me' && ++meCalls > 1) await meGate.promise;
      return ME;
    });
    const { container } = await mount();
    const btn = saveBtn(container);
    click(btn);
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(statusText(container)).toContain('Đã cập nhật hồ sơ');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    click(btn);
    await flush(4);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    meGate.resolve();
    await flush(6);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    click(btn);
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(2);
  });

  it('lỗi: báo trong vùng role=alert có sẵn, giữ chữ đã nhập, khoá giữ tới khi /me tải lại rồi nhả để thử lại', async () => {
    const meGate = deferred();
    let meCalls = 0;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/me' && ++meCalls > 1) await meGate.promise;
      return ME;
    });
    mocks.patch.mockRejectedValueOnce(new NetworkError(false)).mockResolvedValueOnce({ ...ME });
    const { container } = await mount();
    expect(alertRegion(container)).not.toBeNull();
    expect(alertRegion(container)?.textContent).toBe('');
    typeInto(field(container, 'Họ và tên'), 'Lan C');
    const btn = saveBtn(container);
    click(btn);
    await flush(6);
    expect(alertRegion(container)?.textContent).toBeTruthy();
    expect(field(container, 'Họ và tên').value).toBe('Lan C');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    click(btn);
    await flush(4);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    meGate.resolve();
    await flush(6);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    click(btn);
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(2);
    expect(alertRegion(container)?.textContent).toBe('');
  });

  it('hộp xác nhận ngày sinh: chạm đúp "Xác nhận" trong cùng một act cũng chỉ một PATCH, nút giữ focus', async () => {
    const gate = deferred<unknown>();
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    mocks.patch.mockReturnValue(gate.promise);
    const { container } = await mount();
    typeInto(field(container, 'Ngày sinh'), '03/02/1991');
    click(saveBtn(container));
    await flush(2);
    const yes = byText(container, 'button', 'Xác nhận') as HTMLButtonElement;
    yes.focus();
    await twice(yes);
    await flush(2);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(yes.disabled).toBe(false);
    expect(yes.getAttribute('aria-busy')).toBe('true');
    expect(yes.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(yes);
    expect(container.querySelector('[role="alertdialog"] p')?.className).toContain('tabular-nums');
    gate.resolve({ ...ME });
    await flush(4);
  });
});

describe('/tai-khoan/ho-so — khoá đổi ảnh đại diện', () => {
  const openCrop = async (c: HTMLElement) => {
    const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })], configurable: true });
    return input;
  };

  it('hai sự kiện chọn tệp trong cùng một act chỉ đọc ảnh một lần', async () => {
    const gate = deferred<string>();
    mocks.compress.mockReturnValue(gate.promise);
    const { container } = await mount();
    const input = await openCrop(container);
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(2);
    expect(mocks.compress).toHaveBeenCalledTimes(1);
    gate.resolve('data:image/jpeg;base64,UkFX');
    await flush(4);
    expect(byText(document.body, 'button', 'Xác nhận cắt')).not.toBeNull();
  });

  it('chạm đúp "Xác nhận cắt" trong cùng một act chỉ tải lên một lần', async () => {
    const gate = deferred<string | null>();
    mocks.upload.mockReturnValue(gate.promise);
    const { container } = await mount();
    const input = await openCrop(container);
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(4);
    await twice(byText(document.body, 'button', 'Xác nhận cắt'));
    await flush(2);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    gate.resolve(CLOUD_URL);
    await flush(4);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Đã chọn ảnh đại diện mới.');
  });

  it('đang tải ảnh lên: gửi form bằng Enter không lưu hồ sơ; xong thì lưu được', async () => {
    const gate = deferred<string | null>();
    mocks.upload.mockReturnValue(gate.promise);
    const { container } = await mount();
    const input = await openCrop(container);
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(4);
    click(byText(document.body, 'button', 'Xác nhận cắt'));
    await flush(2);
    act(() => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush(4);
    expect(mocks.patch).not.toHaveBeenCalled();
    gate.resolve(CLOUD_URL);
    await flush(4);
    click(saveBtn(container));
    await flush(6);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it('đang tải ảnh lên: nút đổi ảnh báo aria-busy và không mở lại hộp chọn tệp; xong thì mở lại được', async () => {
    const gate = deferred<string | null>();
    mocks.upload.mockReturnValue(gate.promise);
    const { container } = await mount();
    const input = await openCrop(container);
    const pickSpy = vi.spyOn(input, 'click');
    const pick = byText(container, 'button', 'Chạm để chọn & cắt ảnh đại diện') as HTMLButtonElement;
    act(() => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(4);
    click(byText(document.body, 'button', 'Xác nhận cắt'));
    await flush(2);
    expect(byText(container, 'button', 'Đang xử lý ảnh…')).toBe(pick);
    expect(pick.getAttribute('aria-busy')).toBe('true');
    click(pick);
    expect(pickSpy).not.toHaveBeenCalled();
    gate.resolve(CLOUD_URL);
    await flush(4);
    expect(pick.hasAttribute('aria-busy')).toBe(false);
    click(pick);
    expect(pickSpy).toHaveBeenCalledTimes(1);
  });
});

describe('/tai-khoan/ho-so — khoá hai chiều lưu hồ sơ và đổi ảnh', () => {
  it('đang lưu hồ sơ: nút đổi ảnh báo aria-disabled và không mở hộp chọn tệp; lưu xong thì chọn ảnh được', async () => {
    const gate = deferred<unknown>();
    mocks.patch.mockReturnValue(gate.promise);
    const { container } = await mount();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const pickSpy = vi.spyOn(input, 'click');
    const pick = byText(container, 'button', 'Chạm để chọn & cắt ảnh đại diện') as HTMLButtonElement;
    click(saveBtn(container));
    await flush(2);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(pick.disabled).toBe(false);
    expect(pick.getAttribute('aria-disabled')).toBe('true');
    click(pick);
    expect(pickSpy).not.toHaveBeenCalled();
    gate.resolve({ ...ME });
    await flush(6);
    expect(pick.hasAttribute('aria-disabled')).toBe(false);
    click(pick);
    expect(pickSpy).toHaveBeenCalledTimes(1);
  });
});

describe('/tai-khoan/ho-so — số đều', () => {
  it('số điện thoại, ngày sinh (ô nhập và dòng "Ngày đã chọn") dùng chữ số đều', async () => {
    mocks.get.mockResolvedValue({ ...ME, dob: null });
    const { container } = await mount();
    expect(container.querySelector('dd')?.className).toContain('tabular-nums');
    const dob = field(container, 'Ngày sinh');
    expect(dob.className).toContain('tabular-nums');
    typeInto(dob, '03/02/1991');
    const picked = Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.includes('03/02/1991'));
    expect(picked?.className).toContain('tabular-nums');
  });
});
