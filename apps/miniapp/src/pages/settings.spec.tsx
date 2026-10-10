import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  fetchNotifyPrefs: vi.fn(),
  saveNotifyPrefs: vi.fn(),
  stored: undefined as string | undefined,
  setStorage: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('zmp-sdk/apis', () => ({
  getStorage: async () => (mocks.stored === undefined ? {} : { tubu_prefs: mocks.stored }),
  setStorage: mocks.setStorage,
}));
vi.mock('./settings-notify-prefs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./settings-notify-prefs')>()),
  fetchNotifyPrefs: mocks.fetchNotifyPrefs,
  saveNotifyPrefs: mocks.saveNotifyPrefs,
}));
vi.mock('../store/auth', () => ({ useAuthStore: () => ({ logout: vi.fn() }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/font-scale', () => ({ applyFontScale: vi.fn() }));
vi.mock('../services/zmp-bridge', () => ({
  hasOA: false,
  followOA: vi.fn(),
  requestNotifyPermission: vi.fn(),
  getOaPromptState: vi.fn(),
  setOaPromptState: vi.fn(),
}));

import SettingsPage from './settings';

const promoSwitch = () => screen.getByRole('switch', { name: 'Khuyến mãi & mã giảm giá' });

describe('Cài đặt thông báo lưu trên server (C-022)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stored = undefined;
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
});
