import { act, render, renderHook, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonProps } from './ui/button';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  shareLink: vi.fn(),
  copyText: vi.fn(),
  haptic: vi.fn(),
}));
// Bọc Button để đọc props mới nhất: aria-disabled và khoá của Button đã chặn lượt bấm thật,
// nên chỉ gọi thẳng onPress mới chứng minh được khoá trong ShareSheet.
const ctl = vi.hoisted(() => ({ buttons: new Map<string, ButtonProps>() }));
vi.mock('./ui/button', async (importOriginal) => {
  const orig = await importOriginal<{ Button: ComponentType<ButtonProps> }>();
  return {
    ...orig,
    Button: (p: ButtonProps) => {
      ctl.buttons.set(String(p.children), p);
      return <orig.Button {...p} />;
    },
  };
});
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) =>
    visible ? <div data-testid="sheet">{children}</div> : null,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/zmp-bridge', () => ({ shareLink: mocks.shareLink }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('./qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));

import { ShareSheet, useActionLock } from './share-sheet';

const STORE_LINK = 'https://zalo.me/s/2070857098114207963/s/an-lanh?ref=CTV123';

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
    expect(mocks.copyText).toHaveBeenCalledWith(STORE_LINK);
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
    expect(mocks.copyText).toHaveBeenCalledWith('Ghé gian hàng của mình nhé https://zalo.me/s/2070857098114207963/s/an-lanh?ref=CTV123');
  });

  it('không truyền caption: có đủ 3 caption mặc định, đều kèm liên kết có mã', () => {
    renderSheet();
    const captionButtons = screen.getAllByRole('button', { name: /zalo\.me\/s\/\d+\/s\/an-lanh\?ref=CTV123/ });
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const shareBtn = () => screen.getByRole('button', { name: /Chia sẻ qua Zalo/ });
const linkBtn = () => screen.getByRole('button', { name: /Sao chép link/ });
const captionBtns = () => screen.getAllByRole('button', { name: /zalo\.me\/s\/\d+\/s\/an-lanh\?ref=CTV123/ });

describe('ShareSheet — vùng lời đăng gợi ý có tên', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctl.buttons.clear();
    mocks.copyText.mockResolvedValue(true);
  });

  it('ba caption gợi ý nằm trong vùng role="region" tên "Lời đăng gợi ý (chạm để sao chép)", hai nút chính nằm ngoài', () => {
    renderSheet();
    const region = screen.getByRole('region', { name: 'Lời đăng gợi ý (chạm để sao chép)' });
    expect(within(region).getAllByRole('button')).toHaveLength(3);
    expect(region).toHaveTextContent('Lời đăng gợi ý (chạm để sao chép)');
    expect(within(region).queryByRole('button', { name: /Sao chép link/ })).toBeNull();
    expect(within(region).queryByRole('button', { name: /Chia sẻ qua Zalo/ })).toBeNull();
  });
});

describe('ShareSheet — khoá khi đang chia sẻ hoặc sao chép', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctl.buttons.clear();
    mocks.copyText.mockResolvedValue(true);
  });

  it('đang chia sẻ: nút Chia sẻ báo bận, mọi nút khác báo khoá; bấm thêm không chia sẻ hay chép; xong thì mở lại', async () => {
    const send = deferred<void>();
    mocks.shareLink.mockReturnValue(send.promise);
    renderSheet();
    expect(shareBtn()).not.toHaveAttribute('aria-busy');
    expect(shareBtn()).not.toHaveAttribute('aria-disabled');
    expect(linkBtn()).not.toHaveAttribute('aria-disabled');
    captionBtns().forEach((b) => expect(b).not.toHaveAttribute('aria-disabled'));

    fireEvent.click(shareBtn());
    await waitFor(() => expect(shareBtn()).toHaveAttribute('aria-busy', 'true'));
    expect(shareBtn()).toHaveAttribute('aria-disabled', 'true');
    expect(linkBtn()).toHaveAttribute('aria-disabled', 'true');
    expect(linkBtn()).not.toHaveAttribute('aria-busy');
    captionBtns().forEach((b) => expect(b).toHaveAttribute('aria-disabled', 'true'));

    fireEvent.click(shareBtn());
    fireEvent.click(linkBtn());
    fireEvent.click(captionBtns()[0]!);
    await act(async () => {
      ctl.buttons.get('Chia sẻ qua Zalo')!.onPress?.();
      ctl.buttons.get('Sao chép link')!.onPress?.();
    });
    expect(mocks.shareLink).toHaveBeenCalledTimes(1);
    expect(mocks.copyText).not.toHaveBeenCalled();

    await act(async () => send.resolve());
    await waitFor(() => expect(shareBtn()).not.toHaveAttribute('aria-busy'));
    expect(shareBtn()).not.toHaveAttribute('aria-disabled');
    expect(linkBtn()).not.toHaveAttribute('aria-disabled');
    captionBtns().forEach((b) => expect(b).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(linkBtn());
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
  });

  it('hai lần bấm Chia sẻ sát nhau trước khi vẽ lại: chỉ một lần chia sẻ (khoá bằng ref)', async () => {
    const send = deferred<void>();
    mocks.shareLink.mockReturnValue(send.promise);
    renderSheet();
    await act(async () => {
      const press = ctl.buttons.get('Chia sẻ qua Zalo')!.onPress!;
      press();
      press();
    });
    expect(mocks.shareLink).toHaveBeenCalledTimes(1);
    await act(async () => send.resolve());
  });

  it('hai caption khác nhau chạm sát nhau trước khi vẽ lại: chỉ chép caption đầu', async () => {
    const pending = deferred<boolean>();
    mocks.copyText.mockReturnValue(pending.promise);
    renderSheet();
    const [first, second] = captionBtns();
    act(() => {
      fireEvent.click(first!);
      fireEvent.click(second!);
    });
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    expect(mocks.copyText).toHaveBeenCalledWith(first!.textContent);
    await act(async () => pending.resolve(true));
  });

  it('đang sao chép: Chia sẻ chỉ báo khoá chứ không báo bận, bấm chia sẻ bị bỏ qua; xong thì báo đã sao chép và mở lại', async () => {
    const pending = deferred<boolean>();
    mocks.copyText.mockReturnValue(pending.promise);
    renderSheet();
    fireEvent.click(linkBtn());
    await waitFor(() => expect(shareBtn()).toHaveAttribute('aria-disabled', 'true'));
    expect(shareBtn()).not.toHaveAttribute('aria-busy');

    fireEvent.click(shareBtn());
    await act(async () => {
      ctl.buttons.get('Chia sẻ qua Zalo')!.onPress?.();
    });
    expect(mocks.shareLink).not.toHaveBeenCalled();

    await act(async () => pending.resolve(true));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép', type: 'success' }));
    await waitFor(() => expect(shareBtn()).not.toHaveAttribute('aria-disabled'));
  });

  it('chia sẻ lỗi: khoá được nhả, bấm Sao chép link ngay sau đó vẫn chạy', async () => {
    mocks.shareLink.mockRejectedValue(new Error('zalo từ chối'));
    renderSheet();
    fireEvent.click(shareBtn());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(linkBtn()).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(linkBtn());
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(2));
  });
});

describe('ShareSheet — nội dung gửi đi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctl.buttons.clear();
    mocks.copyText.mockResolvedValue(true);
    mocks.shareLink.mockResolvedValue(undefined);
  });

  it('Chia sẻ Zalo gửi đủ tiêu đề, lời đăng đầu, ảnh và đường dẫn kèm mã; rung nhẹ một lần', async () => {
    render(<ShareSheet visible onClose={() => {}} slug="an-lanh" title="Gian hàng An Lành" referralCode="CTV123" thumbnail="https://cdn/t.jpg" />);
    fireEvent.click(shareBtn());
    await waitFor(() => expect(mocks.shareLink).toHaveBeenCalledTimes(1));
    expect(mocks.shareLink.mock.calls[0]![0]).toEqual({
      title: 'Gian hàng An Lành',
      description: `Mình tuyển vài món sống xanh đang dùng, ghé xem nha 🌿 ${STORE_LINK}`,
      thumbnail: 'https://cdn/t.jpg',
      path: '/s/an-lanh?ref=CTV123',
    });
    expect(mocks.haptic).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenCalledWith('light');
  });

  it('Sao chép link không rung', async () => {
    renderSheet();
    fireEvent.click(linkBtn());
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    expect(mocks.haptic).not.toHaveBeenCalled();
  });

  it('lời đăng đã có sẵn liên kết thì chép nguyên văn, không nối liên kết lần hai', async () => {
    render(<ShareSheet visible onClose={() => {}} slug="an-lanh" title="An Lành" referralCode="CTV123" captions={[`Xem ngay ${STORE_LINK}`]} />);
    fireEvent.click(screen.getByRole('button', { name: /Xem ngay/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    expect(mocks.copyText).toHaveBeenCalledWith(`Xem ngay ${STORE_LINK}`);
  });

  it('tiêu đề tuỳ biến thay cho tiêu đề mặc định', () => {
    render(<ShareSheet visible onClose={() => {}} slug="an-lanh" title="An Lành" heading="Chia sẻ mã của tôi" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Chia sẻ mã của tôi' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Chia sẻ gian hàng' })).toBeNull();
  });
});

describe('useActionLock', () => {
  it('tác vụ ném lỗi: lỗi được trả lên, khoá và trạng thái bận vẫn được nhả để việc sau chạy được', async () => {
    const { result } = renderHook(() => useActionLock());
    await act(async () => {
      await expect(
        result.current.run('share', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.active).toBeNull();
    const next = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      await result.current.run('copy', next);
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('ShareSheet — dấu hiệu nhìn thấy khi khoá', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctl.buttons.clear();
    mocks.copyText.mockResolvedValue(true);
  });

  it('đang khoá: các lời đăng mờ đi (opacity 0,6); mở khoá thì trả về như cũ', async () => {
    const send = deferred<void>();
    mocks.shareLink.mockReturnValue(send.promise);
    renderSheet();
    captionBtns().forEach((b) => expect(b.style.opacity).toBe(''));
    fireEvent.click(shareBtn());
    await waitFor(() => expect(shareBtn()).toHaveAttribute('aria-busy', 'true'));
    captionBtns().forEach((b) => expect(b.style.opacity).toBe('0.6'));
    await act(async () => send.resolve());
    await waitFor(() => expect(shareBtn()).not.toHaveAttribute('aria-busy'));
    captionBtns().forEach((b) => expect(b.style.opacity).toBe(''));
  });
});
