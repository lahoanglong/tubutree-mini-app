import { render as rtlRender, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  fetchNotifyPrefs: vi.fn(),
  saveNotifyPrefs: vi.fn(),
  stored: undefined as string | undefined,
  user: { phone: '0900000000', zaloId: 'z123' } as { phone: string | null; zaloId: string | null },
  storageReads: 0,
  setStorage: vi.fn(),
  applyFontScale: vi.fn(),
  logout: vi.fn(),
  hasOA: false,
  getOaPromptState: vi.fn(),
  followOA: vi.fn(),
  requestNotifyPermission: vi.fn(),
  setOaPromptState: vi.fn(),
  requestAccountDeletion: vi.fn(),
  getWallet: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/settings', search: '', state: null }),
  // Giống zmp-ui thật: mỗi lần render trả về hàm openSnackbar MỚI (hook không memo).
  useSnackbar: () => ({ openSnackbar: (opt: unknown) => mocks.openSnackbar(opt), closeSnackbar: vi.fn() }),
}));
vi.mock('zmp-sdk/apis', () => ({
  getStorage: () => {
    mocks.storageReads += 1;
    if (mocks.storageReads > 40) return new Promise(() => undefined);
    return Promise.resolve(mocks.stored === undefined ? {} : { tubu_prefs: mocks.stored });
  },
  setStorage: mocks.setStorage,
}));
vi.mock('./settings-notify-prefs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchNotifyPrefs: mocks.fetchNotifyPrefs,
  saveNotifyPrefs: mocks.saveNotifyPrefs,
}));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ logout: mocks.logout, user: mocks.user }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/font-scale', () => ({ applyFontScale: mocks.applyFontScale }));
vi.mock('../services/zmp-bridge', () => ({
  get hasOA() {
    return mocks.hasOA;
  },
  followOA: mocks.followOA,
  requestNotifyPermission: mocks.requestNotifyPermission,
  getOaPromptState: mocks.getOaPromptState,
  setOaPromptState: mocks.setOaPromptState,
}));

vi.mock('../services/account-api', () => ({ requestAccountDeletion: mocks.requestAccountDeletion, getWallet: mocks.getWallet }));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getErrorMessage: () => 'lỗi',
}));

import SettingsPage from './settings';

const render = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const promoSwitch = () => screen.getByRole('switch', { name: 'Khuyến mãi & mã giảm giá' });

describe('Cài đặt thông báo lưu trên server (C-022)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stored = undefined;
    mocks.user = { phone: '0900000000', zaloId: 'z123' };
    mocks.storageReads = 0;
    mocks.requestAccountDeletion.mockResolvedValue({ message: 'Đã ghi nhận yêu cầu' });
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.fetchNotifyPrefs.mockResolvedValue({ notifyPromo: true, notifyGarden: true });
    mocks.saveNotifyPrefs.mockImplementation(async (patch: object) => ({ notifyPromo: true, notifyGarden: true, ...patch }));
  });

  it('hiển thị trạng thái từ server, tắt khuyến mãi thì gọi API lưu', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(promoSwitch()).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(promoSwitch());
    await waitFor(() => expect(mocks.saveNotifyPrefs).toHaveBeenCalledWith({ notifyPromo: false }));
    expect(promoSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('mở Cài đặt chỉ tải tuỳ chọn thông báo một lần, không lặp khi render lại (BUYERMINI-4)', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(promoSwitch()).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByRole('radio', { name: /Lớn/ }));
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.fetchNotifyPrefs).toHaveBeenCalledTimes(1);
    expect(mocks.storageReads).toBe(1);
  });

  it('lưu lỗi → trả công tắc về như cũ và báo lỗi', async () => {
    mocks.saveNotifyPrefs.mockRejectedValue(new Error('net'));
    render(<SettingsPage />);
    await waitFor(() => expect(promoSwitch()).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(promoSwitch());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(promoSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  it('khách từng tắt trên máy (bản cũ) → đẩy lựa chọn tắt lên server một lần, xoá khỏi máy', async () => {
    mocks.stored = JSON.stringify({ notifyOrders: true, notifyPromo: false, notifyGarden: true, fontScale: 'large' });
    render(<SettingsPage />);
    await waitFor(() => expect(mocks.saveNotifyPrefs).toHaveBeenCalledWith({ notifyPromo: false }));
    await waitFor(() => expect(promoSwitch()).toHaveAttribute('aria-checked', 'false'));
    expect(mocks.setStorage).toHaveBeenCalledWith({ data: { tubu_prefs: JSON.stringify({ fontScale: 'large' }) } });
  });

  it('bấm hai lần liên tiếp khi đang lưu → chỉ gửi một yêu cầu', async () => {
    let resolveSave: (v: object) => void = () => undefined;
    mocks.saveNotifyPrefs.mockReturnValue(new Promise((r) => (resolveSave = r)));
    render(<SettingsPage />);
    await waitFor(() => expect(promoSwitch()).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(promoSwitch());
    fireEvent.click(promoSwitch());
    expect(mocks.saveNotifyPrefs).toHaveBeenCalledTimes(1);
    expect(promoSwitch()).toHaveAttribute('aria-disabled', 'true');
    resolveSave({ notifyPromo: false, notifyGarden: true });
    await waitFor(() => expect(promoSwitch()).not.toHaveAttribute('aria-disabled'));
    expect(promoSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('tin đơn hàng không còn công tắc giả; công tắc khoá cho tới khi tải xong', async () => {
    mocks.fetchNotifyPrefs.mockReturnValue(new Promise(() => undefined));
    render(<SettingsPage />);
    expect(screen.queryByRole('switch', { name: /đơn hàng/i })).toBeNull();
    expect(screen.getByText('Cập nhật đơn hàng')).toBeInTheDocument();
    expect(promoSwitch()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(promoSwitch());
    expect(mocks.saveNotifyPrefs).not.toHaveBeenCalled();
  });
});

describe('Hàng điều hướng ở Cài đặt (C-078)', () => {
  it('dùng ListRow role=button cao >= 44px, mũi tên là icon chứ không phải ký tự ›', async () => {
    mocks.fetchNotifyPrefs.mockResolvedValue({ notifyPromo: true, notifyGarden: true });
    const { container } = render(<SettingsPage />);
    const row = screen.getByRole('button', { name: /Sổ địa chỉ/ });
    expect(row.style.minHeight).toBe('44px');
    expect(row.querySelector('svg')).not.toBeNull();
    expect(container.textContent).not.toContain('›');
    fireEvent.click(row);
    expect(mocks.navigate).toHaveBeenCalledWith('/addresses');
  });

  // Q-19 (C-118): chương trình Beta Tester không có tác dụng nên bỏ lối vào; nhóm Tài khoản kết thúc ở Sổ địa chỉ.
  it('không còn hàng Beta Tester; Sổ địa chỉ là hàng cuối và không có viền dưới', async () => {
    mocks.fetchNotifyPrefs.mockResolvedValue({ notifyPromo: true, notifyGarden: true });
    const { container } = render(<SettingsPage />);
    expect(container.textContent).not.toMatch(/Beta/i);
    expect(screen.queryByRole('button', { name: /Beta/i })).toBeNull();
    const rows = within(screen.getByRole('heading', { level: 2, name: 'Tài khoản' }).parentElement!).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['Chỉnh sửa hồ sơ', 'Sổ địa chỉ']);
    expect(rows[0]!.getAttribute('style')).toMatch(/border-bottom: 1px solid/);
    expect(rows[1]!.getAttribute('style')).not.toMatch(/border-bottom: 1px solid/);
  });
});

describe('Cài đặt theo DS v2 (C-076, C-114)', () => {
  beforeEach(() => {
    mocks.user = { phone: '0900000000', zaloId: 'z123' };
    vi.clearAllMocks();
    mocks.stored = undefined;
    mocks.hasOA = false;
    mocks.fetchNotifyPrefs.mockResolvedValue({ notifyPromo: true, notifyGarden: true });
    mocks.getOaPromptState.mockResolvedValue({ followed: false, promptSeen: false });
    mocks.followOA.mockResolvedValue(true);
    mocks.requestNotifyPermission.mockResolvedValue(true);
    mocks.setOaPromptState.mockResolvedValue(undefined);
  });

  it('có đúng một h1 "Cài đặt" và mỗi nhóm là h2', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(promoSwitch()).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Cài đặt']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Thông báo',
      'Hiển thị · Cỡ chữ',
      'Tài khoản',
    ]);
  });

  it('cỡ chữ là nhóm radio cao >= 44px; chọn Lớn thì áp dụng và lưu trên máy', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(promoSwitch()).toHaveAttribute('aria-checked', 'true'));
    const group = screen.getByRole('radiogroup', { name: 'Cỡ chữ' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['ANhỏ', 'AVừa', 'ALớn']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    radios.forEach((r) => expect(parseInt(r.style.minHeight, 10)).toBeGreaterThanOrEqual(44));
    fireEvent.click(radios[2]!);
    expect(mocks.applyFontScale).toHaveBeenCalledWith('large');
    expect(mocks.setStorage).toHaveBeenCalledWith({ data: { tubu_prefs: JSON.stringify({ fontScale: 'large' }) } });
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
  });

  it('cỡ chữ chọn được bằng bàn phím (Enter)', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(promoSwitch()).toHaveAttribute('aria-checked', 'true'));
    const small = within(screen.getByRole('radiogroup', { name: 'Cỡ chữ' })).getAllByRole('radio')[0]!;
    expect(small).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(small, { key: 'Enter' });
    expect(mocks.applyFontScale).toHaveBeenCalledWith('small');
  });

  it('công tắc bật/tắt được bằng bàn phím (Space)', async () => {
    render(<SettingsPage />);
    await waitFor(() => expect(promoSwitch()).toHaveAttribute('aria-checked', 'true'));
    fireEvent.keyDown(promoSwitch(), { key: ' ' });
    await waitFor(() => expect(mocks.saveNotifyPrefs).toHaveBeenCalledWith({ notifyPromo: false }));
  });

  it('Xoá tài khoản (R-111): bấm → hỏi lại → "Gửi yêu cầu xoá" gọi API đúng một lần, "Huỷ" quay về', async () => {
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá tài khoản' }));
    expect(screen.getByText('Xoá tài khoản vĩnh viễn?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByText('Xoá tài khoản vĩnh viễn?')).toBeNull();
    expect(mocks.requestAccountDeletion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Xoá tài khoản' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' }));
    await waitFor(() => expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã ghi nhận yêu cầu', type: 'info' }));
    await waitFor(() => expect(screen.queryByText('Xoá tài khoản vĩnh viễn?')).toBeNull());
    expect(mocks.requestAccountDeletion).toHaveBeenCalledWith(undefined, undefined);
  });

  it('Ví còn tiền: hiện số dư mất, nút gửi bị khoá tới khi tick đồng ý, rồi gửi kèm đúng số dư đã thấy', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: 20000 });
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá tài khoản' }));
    expect(await screen.findByText('Ví Tubu còn 20.000đ. Xoá tài khoản thì số dư này mất và không hoàn lại.')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Gửi yêu cầu xoá' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Tôi đồng ý bỏ số dư Ví Tubu/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' }));
    await waitFor(() => expect(mocks.requestAccountDeletion).toHaveBeenCalledTimes(1));
    expect(mocks.requestAccountDeletion).toHaveBeenCalledWith(undefined, { acknowledgedWalletBalance: 20000, acceptWalletForfeit: true });
  });

  it('máy chủ từ chối vì số dư đã đổi: bỏ tick, tải lại số dư, khách phải đồng ý lại với số mới', async () => {
    mocks.getWallet.mockResolvedValueOnce({ walletBalance: 20000 }).mockResolvedValue({ walletBalance: 30000 });
    mocks.requestAccountDeletion.mockRejectedValueOnce(new Error('đổi'));
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá tài khoản' }));
    await screen.findByText(/Ví Tubu còn 20\.000đ/);
    fireEvent.click(screen.getByRole('checkbox', { name: /Tôi đồng ý bỏ số dư Ví Tubu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gửi yêu cầu xoá' }));
    expect(await screen.findByText(/Ví Tubu còn 30\.000đ/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' })).toBeDisabled());
    expect(screen.getByRole('checkbox', { name: /Tôi đồng ý bỏ số dư Ví Tubu/ })).not.toBeChecked();
  });

  it('chưa biết số dư (tải lỗi): không cho gửi', async () => {
    mocks.getWallet.mockRejectedValue(new Error('mạng'));
    render(<SettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá tài khoản' }));
    expect(await screen.findByText('Chưa tải được số dư Ví Tubu. Bạn thử lại sau khi tải xong.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi yêu cầu xoá' })).toBeDisabled();
  });

  it('tài khoản khách tạm: không có nút Xoá tài khoản', () => {
    mocks.user = { phone: null, zaloId: 'guest_abc' };
    render(<SettingsPage />);
    expect(screen.queryByRole('button', { name: 'Xoá tài khoản' })).toBeNull();
  });

  it('tài khoản khách tạm (chưa có SĐT, chưa liên kết Zalo): không có nút Đăng xuất', () => {
    mocks.user = { phone: null, zaloId: 'guest_abc' };
    render(<SettingsPage />);
    expect(screen.queryByRole('button', { name: 'Đăng xuất' })).toBeNull();
  });

  it('hàng Chỉnh sửa hồ sơ, Sổ địa chỉ điều hướng; Đăng xuất gọi logout', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Chỉnh sửa hồ sơ/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/edit-profile');
    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(mocks.logout).toHaveBeenCalled();
  });

  it('có OA: hàng Theo dõi Zalo OA hiện nút Theo dõi, bấm xong báo "Đã theo dõi" bằng icon, không ký tự ✓', async () => {
    mocks.hasOA = true;
    const { container } = render(<SettingsPage />);
    const follow = await screen.findByRole('button', { name: 'Theo dõi' });
    fireEvent.click(follow);
    expect(await screen.findByText('Đã theo dõi')).toBeInTheDocument();
    expect(mocks.setOaPromptState).toHaveBeenCalledWith({ followed: true, promptSeen: true });
    expect(container.textContent).not.toContain('✓');
  });
});
