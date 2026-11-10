import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supportCopy } from '@tubutree/app-core/support-copy';
import { ChatClosedPanel } from './closed-panel';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  copyText: vi.fn(),
  haptic: vi.fn(),
  callPhone: vi.fn(),
  openOAChat: vi.fn(),
  hasOA: false,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/zmp-bridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callPhone: mocks.callPhone,
  openOAChat: mocks.openOAChat,
  get hasOA() {
    return mocks.hasOA;
  },
}));
vi.mock('../../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));

const copy = supportCopy.closed;
const FULL = { hotline: '0984606774', email: 'tubutree@gmail.com', zaloOaName: 'Tubu Tree', hours: '8:00–21:00' };
const EMPTY = { hotline: null, email: null, zaloOaName: null, hours: null };
const HOTLINE_NAME = `0984 606 774. ${copy.tapToCopy}`;
const hotlineBtn = () => screen.getByRole('button', { name: HOTLINE_NAME });
const emailBtn = () => screen.getByRole('button', { name: FULL.email });
const callBtn = () => screen.getByRole('button', { name: copy.call('0984 606 774') });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.copyText.mockReset().mockResolvedValue(true);
  mocks.hasOA = false;
});

describe('ChatClosedPanel (Mini): bản đầy đủ', () => {
  it('có hotline: tiêu đề, lời dẫn, số, gợi ý chạm để chép và giờ trực', () => {
    render(<ChatClosedPanel support={FULL} />);
    const root = screen.getByTestId('chat-closed');
    expect(within(root).getByText(copy.title)).toBeInTheDocument();
    expect(within(root).getByText(copy.lead(true))).toBeInTheDocument();
    expect(hotlineBtn()).toBeInTheDocument();
    expect(within(root).getByText(copy.tapToCopy)).toBeInTheDocument();
    expect(within(root).getByText(copy.hours(FULL.hours))).toBeInTheDocument();
  });

  it('không có hotline (hoặc chưa có cấu hình): lời dẫn khác, không có nút số và nút gọi', () => {
    const { rerender } = render(<ChatClosedPanel support={EMPTY} />);
    expect(screen.getByText(copy.lead(false))).toBeInTheDocument();
    expect(screen.queryByText(copy.tapToCopy)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<ChatClosedPanel support={undefined} />);
    expect(screen.getByText(copy.title)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('số hotline dùng số đều (tabular-nums)', () => {
    render(<ChatClosedPanel support={FULL} />);
    expect(within(hotlineBtn()).getByText('0984 606 774').style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('nút gọi: rung nhẹ rồi gọi đúng số', () => {
    render(<ChatClosedPanel support={FULL} />);
    fireEvent.click(callBtn());
    expect(mocks.haptic).toHaveBeenCalledWith('light');
    expect(mocks.callPhone).toHaveBeenCalledWith('0984606774');
  });

  it('có OA: nút "Nhắn OA" mở chat OA; không có OA thì chỉ hiện tên OA và không có nút', () => {
    mocks.hasOA = true;
    const { unmount } = render(<ChatClosedPanel support={FULL} />);
    fireEvent.click(screen.getByRole('button', { name: copy.oa }));
    expect(mocks.openOAChat).toHaveBeenCalledTimes(1);
    unmount();
    mocks.hasOA = false;
    render(<ChatClosedPanel support={FULL} />);
    expect(screen.queryByRole('button', { name: copy.oa })).toBeNull();
    expect(screen.getByText(copy.oaName('Tubu Tree'))).toBeInTheDocument();
  });

  it('không có tên OA: không có nút lẫn chữ OA', () => {
    mocks.hasOA = true;
    render(<ChatClosedPanel support={{ ...FULL, zaloOaName: null }} />);
    expect(screen.queryByRole('button', { name: copy.oa })).toBeNull();
    expect(screen.queryByText(/Zalo OA:/)).toBeNull();
  });
});

describe('ChatClosedPanel (Mini): sao chép số và email', () => {
  it('chạm số: rung nhẹ, chép đúng số, báo thành công bằng snackbar', async () => {
    render(<ChatClosedPanel support={FULL} />);
    await act(async () => {
      fireEvent.click(hotlineBtn());
    });
    expect(mocks.haptic).toHaveBeenCalledWith('light');
    expect(mocks.copyText).toHaveBeenCalledWith('0984 606 774');
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: copy.copied, type: 'success' });
  });

  it('chép số thất bại: snackbar lỗi với chữ hướng dẫn chép tay', async () => {
    mocks.copyText.mockResolvedValue(false);
    render(<ChatClosedPanel support={FULL} />);
    await act(async () => {
      fireEvent.click(hotlineBtn());
    });
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: copy.copyFailed, type: 'error' });
  });

  it('chạm email: rung nhẹ, chép đúng email, báo thành công; thất bại thì báo lỗi', async () => {
    render(<ChatClosedPanel support={FULL} />);
    await act(async () => {
      fireEvent.click(emailBtn());
    });
    expect(mocks.haptic).toHaveBeenCalledWith('light');
    expect(mocks.copyText).toHaveBeenCalledWith(FULL.email);
    expect(mocks.openSnackbar).toHaveBeenLastCalledWith({ text: 'Đã sao chép email hỗ trợ', type: 'success' });
    mocks.copyText.mockResolvedValue(false);
    await act(async () => {
      fireEvent.click(emailBtn());
    });
    expect(mocks.openSnackbar).toHaveBeenLastCalledWith({ text: copy.copyFailed, type: 'error' });
  });

  it('hai cú chạm số khi lần chép còn treo: chỉ chép và báo một lần; chép xong thì chạm lại được', async () => {
    const gate = deferred<boolean>();
    mocks.copyText.mockReturnValueOnce(gate.promise);
    render(<ChatClosedPanel support={FULL} />);
    const btn = hotlineBtn();
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
    await act(async () => {
      gate.resolve(true);
    });
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(mocks.copyText).toHaveBeenCalledTimes(2);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(2);
  });

  it('một lần chép đang treo khoá cả email: chạm email lúc đó không chép thêm', async () => {
    const gate = deferred<boolean>();
    mocks.copyText.mockReturnValueOnce(gate.promise);
    render(<ChatClosedPanel support={FULL} />);
    await act(async () => {
      fireEvent.click(hotlineBtn());
      fireEvent.click(emailBtn());
    });
    expect(mocks.copyText).toHaveBeenCalledTimes(1);
    expect(mocks.copyText).toHaveBeenCalledWith('0984 606 774');
    await act(async () => {
      gate.resolve(true);
    });
    await act(async () => {
      fireEvent.click(emailBtn());
    });
    expect(mocks.copyText).toHaveBeenLastCalledWith(FULL.email);
  });
});

describe('ChatClosedPanel (Mini): bản gọn (chat tắt mà còn lịch sử)', () => {
  it('chỉ có tiêu đề, giờ trực và nút gọi; không có lời dẫn hay nút chép số', () => {
    render(<ChatClosedPanel support={FULL} compact />);
    const root = screen.getByTestId('chat-closed');
    expect(within(root).getByText(copy.title)).toBeInTheDocument();
    expect(within(root).getByText(copy.hours(FULL.hours))).toBeInTheDocument();
    expect(callBtn()).toBeInTheDocument();
    expect(screen.queryByText(copy.lead(true))).toBeNull();
    expect(screen.queryByRole('button', { name: HOTLINE_NAME })).toBeNull();
  });

  it('nút mở rộng: thu gọn thì ẩn OA và email (aria-expanded=false), mở ra thì hiện (aria-expanded=true, nhãn "Thu gọn"), bấm lại thì ẩn', () => {
    mocks.hasOA = true;
    render(<ChatClosedPanel support={FULL} compact />);
    const toggle = screen.getByRole('button', { name: copy.more });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: copy.oa })).toBeNull();
    expect(screen.queryByRole('button', { name: FULL.email })).toBeNull();
    fireEvent.click(toggle);
    const open = screen.getByRole('button', { name: copy.less });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: copy.oa })).toBeInTheDocument();
    expect(emailBtn()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.more })).toBeNull();
    fireEvent.click(open);
    expect(screen.getByRole('button', { name: copy.more })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: FULL.email })).toBeNull();
  });

  it('không có OA lẫn email: không có nút mở rộng', () => {
    render(<ChatClosedPanel support={{ ...FULL, email: null, zaloOaName: null }} compact />);
    expect(screen.queryByRole('button', { name: copy.more })).toBeNull();
    expect(callBtn()).toBeInTheDocument();
  });

  it('chỉ có email (không có tên OA): vẫn có nút mở rộng, mở ra thấy email', () => {
    render(<ChatClosedPanel support={{ ...FULL, zaloOaName: null }} compact />);
    fireEvent.click(screen.getByRole('button', { name: copy.more }));
    expect(emailBtn()).toBeInTheDocument();
  });

  it('chỉ có tên OA (chưa mở được OA): vẫn có nút mở rộng, mở ra thấy tên OA', () => {
    render(<ChatClosedPanel support={{ ...FULL, email: null }} compact />);
    fireEvent.click(screen.getByRole('button', { name: copy.more }));
    expect(screen.getByText(copy.oaName('Tubu Tree'))).toBeInTheDocument();
  });

  it('mở rộng rồi chép email: báo thành công', async () => {
    render(<ChatClosedPanel support={FULL} compact />);
    fireEvent.click(screen.getByRole('button', { name: copy.more }));
    await act(async () => {
      fireEvent.click(emailBtn());
    });
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép email hỗ trợ', type: 'success' });
  });
});

describe('ChatClosedPanel (Mini): nút gọi và nhắn OA khoá khi cầu nối còn chạy (W85A)', () => {
  it('chạm đúp "Gọi" trong cùng một nhịp chỉ gọi cầu nối một lần; cầu nối xong thì chạm lại gọi được', async () => {
    const gate = deferred<void>();
    mocks.callPhone.mockReturnValueOnce(gate.promise);
    render(<ChatClosedPanel support={FULL} />);
    await act(async () => {
      fireEvent.click(callBtn());
      fireEvent.click(callBtn());
    });
    expect(mocks.callPhone).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      fireEvent.click(callBtn());
    });
    expect(mocks.callPhone).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve());
    await act(async () => {
      fireEvent.click(callBtn());
    });
    expect(mocks.callPhone).toHaveBeenCalledTimes(2);
  });

  it('chạm đúp "Nhắn OA" trong cùng một nhịp chỉ mở chat OA một lần; cầu nối xong thì chạm lại mở được', async () => {
    mocks.hasOA = true;
    const gate = deferred<void>();
    mocks.openOAChat.mockReturnValueOnce(gate.promise);
    render(<ChatClosedPanel support={FULL} />);
    const oa = () => screen.getByRole('button', { name: copy.oa });
    await act(async () => {
      fireEvent.click(oa());
      fireEvent.click(oa());
    });
    expect(mocks.openOAChat).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve());
    await act(async () => {
      fireEvent.click(oa());
    });
    expect(mocks.openOAChat).toHaveBeenCalledTimes(2);
  });
});
