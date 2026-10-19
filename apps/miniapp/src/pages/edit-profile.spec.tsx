import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getMe: vi.fn(),
  updateMe: vi.fn(),
  setAuthState: vi.fn(),
  cloudinary: true,
  readAndCompressImage: vi.fn(),
  uploadToCloudinary: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Avatar: () => <span data-testid="avatar" />,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/edit-profile', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/account-api', () => ({ getMe: mocks.getMe, updateMe: mocks.updateMe }));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
vi.mock('../store/auth', () => ({
  useAuthStore: Object.assign(() => ({}), {
    getState: () => ({ user: { fullName: 'Lan', avatarUrl: null } }),
    setState: mocks.setAuthState,
  }),
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/image-upload', () => ({
  readAndCompressImage: mocks.readAndCompressImage,
  uploadToCloudinary: mocks.uploadToCloudinary,
  isCloudinaryConfigured: () => mocks.cloudinary,
}));
vi.mock('../components/avatar-crop-modal', () => ({
  AvatarCropModal: ({ visible, onConfirm }: { visible: boolean; onConfirm: (url: string) => void }) =>
    visible ? (
      <button type="button" onClick={() => onConfirm('data:image/jpeg;base64,QUJD')}>
        Xác nhận cắt
      </button>
    ) : null,
}));

import EditProfilePage from './edit-profile';

const ME = { fullName: 'Lan', email: 'lan@tubu.vn', avatarUrl: null, dob: '1990-05-01' };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EditProfilePage />
    </QueryClientProvider>,
  );
}

describe('Sửa hồ sơ theo DS v2 (C-076, C-114)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMe.mockResolvedValue(ME);
    mocks.updateMe.mockResolvedValue({ avatarUrl: null });
    mocks.cloudinary = true;
    mocks.readAndCompressImage.mockResolvedValue('data:image/jpeg;base64,UkFX');
    mocks.uploadToCloudinary.mockResolvedValue('https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['x']) }));
  });

  it('có đúng một h1 "Sửa hồ sơ", cả lúc đang tải', () => {
    mocks.getMe.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Sửa hồ sơ']);
  });

  it('mỗi ô nhập có nhãn gắn với ô (đọc màn hình) và điền sẵn từ hồ sơ', async () => {
    renderPage();
    expect(await screen.findByLabelText('Họ và tên')).toHaveValue('Lan');
    expect(screen.getByLabelText('Email')).toHaveValue('lan@tubu.vn');
    expect(screen.getByLabelText('Ngày sinh')).toHaveValue('1990-05-01');
  });

  it('không dùng emoji làm icon; lời nhắn sinh nhật vẫn còn', async () => {
    const { container } = renderPage();
    await screen.findByLabelText('Họ và tên');
    expect(screen.getByText('Nhận mã giảm giá quà tặng vào tháng sinh nhật.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
  });

  it('tải lỗi → thông báo + nút Thử lại gọi lại getMe', async () => {
    mocks.getMe.mockRejectedValueOnce(new Error('Mất kết nối'));
    renderPage();
    expect(await screen.findByText('Mất kết nối')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.getMe).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('Họ và tên')).toHaveValue('Lan');
  });

  it('email sai sau khi rời ô → báo lỗi, khoá nút Lưu, không gọi API', async () => {
    renderPage();
    const email = await screen.findByLabelText('Email');
    fireEvent.change(email, { target: { value: 'khong-hop-le' } });
    fireEvent.blur(email);
    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    const save = screen.getByRole('button', { name: 'Lưu thay đổi' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(mocks.updateMe).not.toHaveBeenCalled();
  });

  it('lưu thành công: gửi tên/email/ngày sinh đã cắt khoảng trắng, báo thành công, đồng bộ auth store, quay lại', async () => {
    mocks.getMe.mockResolvedValue({ ...ME, dob: null });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Họ và tên'), { target: { value: '  Lan B  ' } });
    fireEvent.change(screen.getByLabelText('Ngày sinh'), { target: { value: '1991-02-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() =>
      expect(mocks.updateMe).toHaveBeenCalledWith({
        fullName: 'Lan B',
        email: 'lan@tubu.vn',
        avatarUrl: undefined,
        dob: '1991-02-03',
      }),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(-1));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cập nhật hồ sơ', type: 'success', position: 'top' });
    expect(mocks.setAuthState).toHaveBeenCalledWith({ user: { fullName: 'Lan B', avatarUrl: null } });
  });

  it('server chê avatarUrl → thử lại một lần không kèm avatarUrl', async () => {
    mocks.updateMe.mockRejectedValueOnce(new Error('avatarUrl must be a URL')).mockResolvedValueOnce({ avatarUrl: null });
    renderPage();
    await screen.findByLabelText('Họ và tên');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(2));
    expect(mocks.updateMe).toHaveBeenLastCalledWith({ fullName: 'Lan', email: 'lan@tubu.vn', dob: undefined });
    expect(mocks.updateMe.mock.calls[1]![0]).not.toHaveProperty('avatarUrl');
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(-1));
  });

  describe('ngày sinh chỉ đặt được một lần (API từ chối gửi lại)', () => {
    const NOTE = 'Ngày sinh chỉ đặt được một lần, cần chỉnh lại thì liên hệ CSKH.';

    it('đã có ngày sinh: lưu đổi tên không gửi dob', async () => {
      renderPage();
      fireEvent.change(await screen.findByLabelText('Họ và tên'), { target: { value: 'Lan C' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(1));
      expect(mocks.updateMe.mock.calls[0]![0].fullName).toBe('Lan C');
      expect(mocks.updateMe.mock.calls[0]![0].dob).toBeUndefined();
    });

    it('đã có ngày sinh, server chê avatarUrl: lần gửi lại cũng không có dob', async () => {
      mocks.updateMe.mockRejectedValueOnce(new Error('avatarUrl must be a URL')).mockResolvedValueOnce({ avatarUrl: null });
      renderPage();
      await screen.findByLabelText('Họ và tên');
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(2));
      expect(mocks.updateMe.mock.calls[0]![0].dob).toBeUndefined();
      expect(mocks.updateMe.mock.calls[1]![0].dob).toBeUndefined();
    });

    it('chưa có ngày sinh, có nhập: gửi dob, cả khi gửi lại không kèm avatarUrl', async () => {
      mocks.getMe.mockResolvedValue({ ...ME, dob: null });
      mocks.updateMe.mockRejectedValueOnce(new Error('avatarUrl must be a URL')).mockResolvedValueOnce({ avatarUrl: null });
      renderPage();
      fireEvent.change(await screen.findByLabelText('Ngày sinh'), { target: { value: '1991-02-03' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(2));
      expect(mocks.updateMe.mock.calls[0]![0].dob).toBe('1991-02-03');
      expect(mocks.updateMe.mock.calls[1]![0].dob).toBe('1991-02-03');
    });

    it('chưa có ngày sinh, không nhập: không gửi dob; ô nhập sửa được và không có câu nhắc', async () => {
      mocks.getMe.mockResolvedValue({ ...ME, dob: null });
      renderPage();
      const input = (await screen.findByLabelText('Ngày sinh')) as HTMLInputElement;
      expect(input.readOnly).toBe(false);
      expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(1));
      expect(mocks.updateMe.mock.calls[0]![0].dob).toBeUndefined();
    });

    it('đã có ngày sinh: ô chỉ đọc và có câu nhắc liên hệ CSKH', async () => {
      renderPage();
      const input = (await screen.findByLabelText('Ngày sinh')) as HTMLInputElement;
      expect(input.readOnly).toBe(true);
      expect(screen.getByText(NOTE)).toBeInTheDocument();
    });
  });

  it('lưu lỗi khác → báo lỗi, ở lại trang', async () => {
    mocks.updateMe.mockRejectedValue(new Error('Máy chủ bận'));
    renderPage();
    await screen.findByLabelText('Họ và tên');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Máy chủ bận', type: 'error', position: 'top' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('đang lưu → nút báo bận (spinner) thay vì khoá cứng, bấm thêm không gửi thêm yêu cầu', async () => {
    mocks.updateMe.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await screen.findByLabelText('Họ và tên');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    const save = screen.getByRole('button', { name: 'Lưu thay đổi' });
    await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    expect(mocks.updateMe).toHaveBeenCalledTimes(1);
  });

  it('vùng chọn ảnh đại diện là nút thật cao >= 44px', async () => {
    renderPage();
    const pick = await screen.findByRole('button', { name: /Chạm để chọn & cắt ảnh đại diện/ });
    expect(parseInt(pick.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });
});

describe('Ảnh đại diện: không báo thành công khi ảnh không được lưu (D6-05 d)', () => {
  const NO_CLOUD_NOTE = 'Chưa đổi được ảnh đại diện lúc này vì dịch vụ lưu ảnh chưa được bật. Bạn vẫn sửa được tên, email và ngày sinh.';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMe.mockResolvedValue(ME);
    mocks.updateMe.mockResolvedValue({ avatarUrl: null });
    mocks.cloudinary = true;
    mocks.readAndCompressImage.mockResolvedValue('data:image/jpeg;base64,UkFX');
    mocks.uploadToCloudinary.mockResolvedValue('https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['x']) }));
  });

  const pickPhoto = async (container: HTMLElement) => {
    await screen.findByLabelText('Họ và tên');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận cắt' }));
  };

  it('chưa cấu hình dịch vụ ảnh: không có nút đổi ảnh, thay bằng dòng giải thích, không có lời mời chạm để chọn', async () => {
    mocks.cloudinary = false;
    const { container } = renderPage();
    await screen.findByLabelText('Họ và tên');
    expect(screen.queryByRole('button', { name: /ảnh đại diện/i })).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText(NO_CLOUD_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/Chạm để chọn & cắt ảnh đại diện/)).toBeNull();
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
  });

  it('đã cấu hình: nút đổi ảnh dùng được, không có dòng giải thích', async () => {
    renderPage();
    await screen.findByLabelText('Họ và tên');
    expect(screen.getByRole('button', { name: /Chạm để chọn & cắt ảnh đại diện/ })).toBeEnabled();
    expect(screen.queryByText(NO_CLOUD_NOTE)).toBeNull();
  });

  it('tải lên thành công: lưu đúng URL đã tải (không bao giờ gửi base64)', async () => {
    const { container } = renderPage();
    await pickPhoto(container);
    await waitFor(() => expect(mocks.uploadToCloudinary).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(1));
    expect(mocks.updateMe.mock.calls[0]![0].avatarUrl).toBe('https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg');
  });

  it('tải lên lỗi: báo lỗi rõ, KHÔNG báo đã chọn ảnh, và ảnh cũ giữ nguyên khi lưu', async () => {
    mocks.uploadToCloudinary.mockResolvedValue(null);
    const { container } = renderPage();
    await pickPhoto(container);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Chưa tải được ảnh lên nên ảnh đại diện chưa đổi. Bạn thử lại nhé.', type: 'error', position: 'top' }),
    );
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(1));
    expect(mocks.updateMe.mock.calls[0]![0].avatarUrl).toBeUndefined();
  });

  it('máy chủ từ chối ảnh sau khi người dùng vừa đổi: vẫn lưu phần còn lại nhưng nói rõ ảnh chưa lưu', async () => {
    mocks.updateMe.mockRejectedValueOnce(new Error('avatarUrl must be a URL address')).mockResolvedValueOnce({ avatarUrl: null });
    const { container } = renderPage();
    await pickPhoto(container);
    await waitFor(() => expect(mocks.uploadToCloudinary).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({
        text: 'Đã lưu hồ sơ, riêng ảnh đại diện chưa lưu được. Bạn thử chọn lại ảnh sau nhé.',
        type: 'warning',
        position: 'top',
      }),
    );
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith({ text: 'Đã cập nhật hồ sơ', type: 'success', position: 'top' });
    expect(mocks.setAuthState).toHaveBeenCalledWith({ user: { fullName: 'Lan', avatarUrl: null } });
  });
});
