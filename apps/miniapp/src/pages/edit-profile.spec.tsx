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
vi.mock('../components/image-upload', () => ({ readAndCompressImage: vi.fn(), uploadToCloudinary: vi.fn() }));
vi.mock('../components/avatar-crop-modal', () => ({ AvatarCropModal: () => null }));

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
    expect(mocks.updateMe).toHaveBeenLastCalledWith({ fullName: 'Lan', email: 'lan@tubu.vn', dob: '1990-05-01' });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(-1));
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
