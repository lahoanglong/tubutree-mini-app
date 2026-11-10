import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  getLoadErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
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
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';

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
    // Ô có trước khi hồ sơ về: đợi giá trị, không chỉ đợi ô (máy tải nặng thì findByLabelText trả ô còn rỗng).
    await waitFor(() => expect(screen.getByLabelText('Họ và tên')).toHaveValue('Lan'));
    expect(screen.getByLabelText('Email')).toHaveValue('lan@tubu.vn');
    expect(screen.getByLabelText('Ngày sinh')).toHaveValue('01/05/1990');
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

  it.each(['', '   ', '\u200b '])('xoá trắng họ tên (%j) rồi bấm Lưu: báo lỗi ở ô, khoá nút, không gọi API, không báo thành công', async (blank) => {
    renderPage();
    const name = await screen.findByLabelText('Họ và tên');
    await waitFor(() => expect(name).toHaveValue('Lan'));
    fireEvent.change(name, { target: { value: blank } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(await screen.findByText('Nhập họ tên để lưu hồ sơ.')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    const save = screen.getByRole('button', { name: 'Lưu thay đổi' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(mocks.updateMe).not.toHaveBeenCalled();
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: ' Lan C ' } });
    expect(screen.queryByText('Nhập họ tên để lưu hồ sơ.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'Lan C' })));
  });

  it('lưu thành công: gửi tên/email/ngày sinh đã cắt khoảng trắng, báo thành công, đồng bộ auth store, quay lại', async () => {
    mocks.getMe.mockResolvedValue({ ...ME, dob: null });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Họ và tên'), { target: { value: '  Lan B  ' } });
    fireEvent.change(screen.getByLabelText('Ngày sinh'), { target: { value: '03/02/1991' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
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
      fireEvent.change(await screen.findByLabelText('Ngày sinh'), { target: { value: '03/02/1991' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
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

    it('chọn ngày sinh mới: hiện ngày dd/MM/yyyy, hỏi xác nhận TRƯỚC khi lưu; Sửa lại thì chưa gửi gì', async () => {
      mocks.getMe.mockResolvedValue({ ...ME, dob: null });
      renderPage();
      fireEvent.change(await screen.findByLabelText('Ngày sinh'), { target: { value: '03/02/1991' } });
      expect(screen.getByText('Ngày đã chọn: 03/02/1991')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      expect(screen.getByText('Ngày sinh 3 tháng 2 năm 1991 chỉ đặt được một lần. Xác nhận?')).toBeInTheDocument();
      expect(mocks.updateMe).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Sửa lại' }));
      expect(screen.queryByText(/chỉ đặt được một lần\. Xác nhận/)).toBeNull();
      expect(mocks.updateMe).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument();
    });

    it('đang hỏi xác nhận ngày sinh: các ô nhập bị khoá, bấm Sửa lại thì mở lại', async () => {
      mocks.getMe.mockResolvedValue({ ...ME, dob: null });
      renderPage();
      fireEvent.change(await screen.findByLabelText('Ngày sinh'), { target: { value: '03/02/1991' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      expect(screen.getByLabelText('Ngày sinh')).toHaveAttribute('readonly');
      expect(screen.getByLabelText('Họ và tên')).toHaveAttribute('readonly');
      expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
      fireEvent.click(screen.getByRole('button', { name: 'Sửa lại' }));
      expect(screen.getByLabelText('Ngày sinh')).not.toHaveAttribute('readonly');
    });

    it('ngày sinh đã lưu: không hiện dòng "Ngày đã chọn" (chỉ hiện với ngày vừa chọn chưa lưu)', async () => {
      renderPage();
      expect(await screen.findByLabelText('Ngày sinh')).toHaveValue('01/05/1990');
      expect(screen.queryByText(/Ngày đã chọn/)).toBeNull();
    });

    it('đã có ngày sinh: lưu đổi tên không hỏi xác nhận ngày sinh', async () => {
      renderPage();
      fireEvent.change(await screen.findByLabelText('Họ và tên'), { target: { value: 'Lan D' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
      await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(1));
    });

    it('ô ngày sinh là ô chữ dd/mm/yyyy (không phải type=date), tự thêm dấu / khi gõ liền số (R-110)', async () => {
      mocks.getMe.mockResolvedValue({ ...ME, dob: null });
      renderPage();
      const input = (await screen.findByLabelText('Ngày sinh')) as HTMLInputElement;
      expect(input.type).toBe('text');
      expect(input.placeholder).toBe('dd/mm/yyyy');
      fireEvent.change(input, { target: { value: '29022000' } });
      expect(input.value).toBe('29/02/2000');
    });

    it('ngày không có thật (29/02/2023): báo lỗi rõ ràng và không gửi', async () => {
      mocks.getMe.mockResolvedValue({ ...ME, dob: null });
      renderPage();
      fireEvent.change(await screen.findByLabelText('Ngày sinh'), { target: { value: '29/02/2023' } });
      expect(screen.getByText('Ngày này không có thật. Kiểm tra lại ngày và tháng nhé.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      expect(mocks.updateMe).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('ngày tương lai: báo lỗi và không gửi', async () => {
      mocks.getMe.mockResolvedValue({ ...ME, dob: null });
      renderPage();
      fireEvent.change(await screen.findByLabelText('Ngày sinh'), { target: { value: '01/01/2999' } });
      expect(screen.getByText('Ngày sinh không thể ở tương lai. Kiểm tra lại năm nhé.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      expect(mocks.updateMe).not.toHaveBeenCalled();
    });

    it('gõ dở rồi bấm Lưu: báo nhập đủ ngày/tháng/năm, không gửi', async () => {
      mocks.getMe.mockResolvedValue({ ...ME, dob: null });
      renderPage();
      fireEvent.change(await screen.findByLabelText('Ngày sinh'), { target: { value: '0503' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      expect(await screen.findByText('Nhập đủ ngày/tháng/năm, ngày và tháng gõ 2 số, ví dụ 05/03/1990.')).toBeInTheDocument();
      expect(mocks.updateMe).not.toHaveBeenCalled();
    });

    it('29/02/2000 hợp lệ: xác nhận rồi gửi dob dạng ISO 2000-02-29', async () => {
      mocks.getMe.mockResolvedValue({ ...ME, dob: null });
      renderPage();
      fireEvent.change(await screen.findByLabelText('Ngày sinh'), { target: { value: '29/02/2000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
      expect(screen.getByText('Ngày sinh 29 tháng 2 năm 2000 chỉ đặt được một lần. Xác nhận?')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
      await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(1));
      expect(mocks.updateMe.mock.calls[0]![0].dob).toBe('2000-02-29');
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
  const NO_CLOUD_NOTE = 'Tạm thời chưa đổi được ảnh đại diện.';

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

  it('chưa cấu hình dịch vụ ảnh: không có nút đổi ảnh, không câu báo thiếu chức năng, không có lời mời chạm để chọn', async () => {
    mocks.cloudinary = false;
    const { container } = renderPage();
    await screen.findByLabelText('Họ và tên');
    expect(screen.queryByRole('button', { name: /ảnh đại diện/i })).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText(NO_CLOUD_NOTE)).toBeNull();
    expect(screen.queryByText(/Chạm để chọn & cắt ảnh đại diện/)).toBeNull();
    expect(screen.getByTestId('profile-avatar-initial')).toHaveTextContent('L');
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

describe('Sửa hồ sơ: Lưu khoá chạm đúp trong cùng một khung hình (W73A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMe.mockResolvedValue(ME);
    mocks.cloudinary = true;
  });

  it('chạm đúp "Lưu thay đổi" chỉ gọi updateMe một lần, lưu xong quay lại một lần', async () => {
    let resolve!: (v: unknown) => void;
    mocks.updateMe.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    renderPage();
    await screen.findByLabelText('Họ và tên');
    const save = screen.getByRole('button', { name: 'Lưu thay đổi' });
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(mocks.updateMe).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ avatarUrl: null }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(-1));
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.updateMe).toHaveBeenCalledTimes(1);
  });

  it('chạm đúp "Xác nhận" ngày sinh chỉ gọi updateMe một lần', async () => {
    let resolve!: (v: unknown) => void;
    mocks.getMe.mockResolvedValue({ ...ME, dob: null });
    mocks.updateMe.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Ngày sinh'), { target: { value: '03/02/1991' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    const confirm = screen.getByRole('button', { name: 'Xác nhận' });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(mocks.updateMe).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ avatarUrl: null }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(-1));
    expect(mocks.updateMe).toHaveBeenCalledTimes(1);
  });

  it('lưu lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
    mocks.updateMe.mockRejectedValueOnce(new Error('Máy chủ bận')).mockResolvedValue({ avatarUrl: null });
    renderPage();
    await screen.findByLabelText('Họ và tên');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(2));
  });
});

describe('Sửa hồ sơ: máy chủ từ chối vì hồ sơ không còn khớp thì tải lại rồi mới nhả khoá (W108A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const errorToasts = () => mocks.openSnackbar.mock.calls.filter(([a]) => (a as { type: string }).type === 'error');
  const saveButton = () => screen.getByRole('button', { name: 'Lưu thay đổi' });
  const DOB_ONCE = 'Ngày sinh chỉ có thể đặt một lần và không tự sửa lại được. Bạn liên hệ CSKH nếu cần đính chính nhé.';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMe.mockReset().mockResolvedValue(ME);
    mocks.updateMe.mockReset().mockResolvedValue({ avatarUrl: null });
    mocks.cloudinary = true;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ngày sinh đã được đặt ở máy khác (400): tải lại hồ sơ, ô ngày sinh khoá, ô khách vừa sửa không bị ghi đè, lần lưu kế không gửi ngày sinh', async () => {
    const refetch = deferred<unknown>();
    mocks.getMe
      .mockResolvedValueOnce({ ...ME, dob: null })
      .mockReturnValueOnce(refetch.promise)
      .mockResolvedValue({ ...ME, dob: '1991-02-03' });
    mocks.updateMe.mockRejectedValueOnce(serverError(DOB_ONCE, 400)).mockResolvedValue({ avatarUrl: null });
    renderPage();
    const name = await screen.findByLabelText('Họ và tên');
    await waitFor(() => expect(name).toHaveValue('Lan'));
    fireEvent.change(name, { target: { value: 'Lan Mới' } });
    fireEvent.change(screen.getByLabelText('Ngày sinh'), { target: { value: '03/02/1991' } });
    fireEvent.click(saveButton());
    const confirm = await screen.findByRole('button', { name: 'Xác nhận' });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(mocks.getMe).toHaveBeenCalledTimes(2));
    expect(mocks.updateMe).toHaveBeenCalledTimes(1);
    expect(mocks.updateMe.mock.calls[0]![0].dob).toBe('1991-02-03');
    expect(errorToasts()).toEqual([[{ text: DOB_ONCE, type: 'error', position: 'top' }]]);
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(mocks.updateMe).toHaveBeenCalledTimes(1);

    await act(async () => refetch.resolve({ ...ME, fullName: 'Tên trên máy chủ', dob: '1991-02-03' }));
    await waitFor(() => expect(screen.getByLabelText('Ngày sinh')).toHaveValue('03/02/1991'));
    expect((screen.getByLabelText('Ngày sinh') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByLabelText('Họ và tên')).toHaveValue('Lan Mới');
    await waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-busy'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(2));
    expect(mocks.updateMe.mock.calls[1]![0].dob).toBeUndefined();
    expect(mocks.updateMe.mock.calls[1]![0].fullName).toBe('Lan Mới');
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(-1));
  });

  it.each([400, 404, 409])('bị từ chối %i: báo lỗi một lần, tải lại hồ sơ, nút bận tới khi hồ sơ về rồi mới nhận cú chạm mới', async (status) => {
    const refetch = deferred<unknown>();
    mocks.getMe.mockResolvedValueOnce(ME).mockReturnValueOnce(refetch.promise).mockResolvedValue(ME);
    mocks.updateMe.mockRejectedValueOnce(serverError('Hồ sơ vừa đổi, bạn thử lại nhé.', status)).mockResolvedValue({ avatarUrl: null });
    renderPage();
    await screen.findByLabelText('Họ và tên');
    await act(async () => {
      fireEvent.click(saveButton());
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(mocks.getMe).toHaveBeenCalledTimes(2));
    expect(mocks.updateMe).toHaveBeenCalledTimes(1);
    expect(errorToasts()).toHaveLength(1);
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.updateMe).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => refetch.resolve(ME));
    await waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-busy'));
    expect(errorToasts()).toHaveLength(1);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(-1));
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['quá thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
    ['lỗi không phải HTTP', new Error('boom')],
  ])('%s: không nói gì về hồ sơ thật nên không tải lại, khoá nhả ngay', async (_label, error) => {
    mocks.updateMe.mockRejectedValueOnce(error).mockResolvedValue({ avatarUrl: null });
    renderPage();
    await screen.findByLabelText('Họ và tên');
    fireEvent.click(saveButton());
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    await waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-busy'));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.getMe).toHaveBeenCalledTimes(1);
    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledTimes(2));
  });

  it('tải lại hồ sơ treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS, không sớm hơn', async () => {
    mocks.getMe.mockResolvedValueOnce(ME).mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValue(ME);
    mocks.updateMe.mockRejectedValueOnce(serverError('Hồ sơ vừa đổi, bạn thử lại nhé.', 409)).mockResolvedValue({ avatarUrl: null });
    renderPage();
    await screen.findByLabelText('Họ và tên');
    await waitFor(() => expect(screen.getByLabelText('Họ và tên')).toHaveValue('Lan'));
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(saveButton());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.getMe).toHaveBeenCalledTimes(2);
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
      fireEvent.click(saveButton());
    });
    expect(mocks.updateMe).toHaveBeenCalledTimes(1);
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    });
    expect(saveButton()).not.toHaveAttribute('aria-busy');
    await act(async () => {
      fireEvent.click(saveButton());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.updateMe).toHaveBeenCalledTimes(2);
  });
});
