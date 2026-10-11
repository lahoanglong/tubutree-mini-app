import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  shareLink: vi.fn(),
  copyText: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/zmp-bridge', () => ({ shareLink: mocks.shareLink }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('./qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));

import { ShareSheet } from './share-sheet';

function renderSheet() {
  return render(<ShareSheet visible onClose={() => {}} slug="an-lanh" title="Gian hàng An Lành" referralCode="CTV123" />);
}

describe('ShareSheet — lỗi chia sẻ không bị nuốt (C-067)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copyText.mockResolvedValue(true);
  });

  it('chia sẻ Zalo thành công: không báo lỗi, không tự sao chép', async () => {
    mocks.shareLink.mockResolvedValue(undefined);
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Chia sẻ qua Zalo/ }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    expect(mocks.shareLink.mock.calls[0]![0].path).toBe('/s/an-lanh?ref=CTV123');
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    expect(mocks.copyText).not.toHaveBeenCalled();
  });

  it('shareLink reject: sao chép liên kết kèm mã giới thiệu và báo bằng snackbar', async () => {
    mocks.shareLink.mockRejectedValue(new Error('zalo từ chối'));
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Chia sẻ qua Zalo/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining('/s/an-lanh?ref=CTV123'));
    const arg = mocks.openSnackbar.mock.calls[0]![0] as { text: string; type: string };
    expect(arg.text).toMatch(/Chưa chia sẻ được qua Zalo/);
    expect(arg.text).toMatch(/đã sao chép/i);
  });

  it('shareLink reject và clipboard cũng không dùng được: báo lỗi, hướng dẫn chép tay', async () => {
    mocks.shareLink.mockRejectedValue(new Error('zalo từ chối'));
    mocks.copyText.mockResolvedValue(false);
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Chia sẻ qua Zalo/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    const arg = mocks.openSnackbar.mock.calls[0]![0] as { text: string; type: string };
    expect(arg.type).toBe('error');
    expect(arg.text).toMatch(/Chưa chia sẻ được qua Zalo/);
    expect(arg.text).toMatch(/chép/i);
  });

  it('người dùng huỷ hộp thoại (mã USER_CANCEL -2003): không ghi đè clipboard, không báo lỗi', async () => {
    mocks.shareLink.mockRejectedValue({ code: -2003, message: 'User cancel' });
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Chia sẻ qua Zalo/ }));
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(mocks.copyText).not.toHaveBeenCalled();
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });

  it('nút chia sẻ có vùng chạm >= 44px (DS v2 Button)', () => {
    mocks.shareLink.mockResolvedValue(undefined);
    renderSheet();
    const btn = screen.getByRole('button', { name: /Chia sẻ qua Zalo/ });
    expect(btn.style.minHeight).toBe('44px');
  });
});

describe('ShareSheet — khung sheet và caption gợi ý (DS v2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copyText.mockResolvedValue(true);
  });

  it('tiêu đề sheet là h2 thật và có nút Đóng gọi onClose', () => {
    const onClose = vi.fn();
    render(<ShareSheet visible onClose={onClose} slug="an-lanh" title="Gian hàng An Lành" referralCode="CTV123" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Chia sẻ gian hàng' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('nút Sao chép link chép liên kết có mã giới thiệu và báo đã sao chép', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Sao chép link/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith(expect.stringContaining('/s/an-lanh?ref=CTV123'));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép', type: 'success' });
  });

  it('mỗi caption gợi ý là nút thật cao >= 44px, chạm vào là chép đúng caption kèm liên kết', async () => {
    render(
      <ShareSheet
        visible
        onClose={() => {}}
        slug="an-lanh"
        title="Gian hàng An Lành"
        referralCode="CTV123"
        captions={['Ghé gian hàng của mình nhé']}
      />,
    );
    const btn = screen.getByRole('button', { name: /Ghé gian hàng của mình nhé/ });
    expect(parseFloat(btn.style.minHeight)).toBeGreaterThanOrEqual(44);
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith('Ghé gian hàng của mình nhé https://app.tubutree.com/s/an-lanh?ref=CTV123');
  });

  it('không truyền caption: có đủ 3 caption mặc định, đều kèm liên kết có mã', () => {
    renderSheet();
    const captionButtons = screen.getAllByRole('button', { name: /app\.tubutree\.com\/s\/an-lanh\?ref=CTV123/ });
    expect(captionButtons).toHaveLength(3);
  });

  it('khi sao chép thất bại: báo lỗi hướng dẫn chép tay', async () => {
    mocks.copyText.mockResolvedValue(false);
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Sao chép link/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar.mock.calls[0]![0]).toMatchObject({ type: 'error' });
  });
});
