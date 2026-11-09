import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasOA: false,
  openOAChat: vi.fn(),
  callPhone: vi.fn(),
  fetchSupportContact: vi.fn(),
  copyText: vi.fn(),
  openSnackbar: vi.fn(),
  navigate: vi.fn(),
  login: vi.fn(),
  haptic: vi.fn(),
  authStatus: 'authenticated' as string,
  authError: undefined as string | undefined,
  chatEnabled: false,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../hooks/use-public-config', () => ({
  usePublicConfig: () => ({ chat: { enabled: mocks.chatEnabled, hours: { start: '08:00', end: '21:00' } }, isLoaded: true }),
}));
vi.mock('../store/auth', () => {
  const state = () => ({ status: mocks.authStatus, error: mocks.authError, login: mocks.login, restore: vi.fn() });
  return { useAuthStore: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: state }) };
});
vi.mock('../services/zmp-bridge', () => ({
  get hasOA() {
    return mocks.hasOA;
  },
  openOAChat: mocks.openOAChat,
  callPhone: mocks.callPhone,
}));
vi.mock('../pages/about-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSupportContact: mocks.fetchSupportContact,
}));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));

import { SupportContact, once } from './support-contact';

// `openOAChat` gọi thẳng SDK Zalo nên có thể reject; khoá phải nhả để nút không chết hẳn.
describe('once — khoá đồng bộ', () => {
  it('đang chạy thì bỏ lần gọi kế; xong thì chạy lại được', async () => {
    const lock = { current: false };
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const first = once(lock, run);
    await once(lock, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(lock.current).toBe(true);
    finish();
    await first;
    expect(lock.current).toBe(false);
    const again = once(lock, run);
    expect(run).toHaveBeenCalledTimes(2);
    finish();
    await again;
  });

  it('việc chạy bị lỗi: ném lỗi ra ngoài và vẫn nhả khoá', async () => {
    const lock = { current: false };
    const boom = new Error('SDK lỗi');
    await expect(once(lock, () => Promise.reject(boom))).rejects.toBe(boom);
    expect(lock.current).toBe(false);
    const run = vi.fn();
    await once(lock, run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

function renderBlock() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupportContact orderCode="TT001" />
    </QueryClientProvider>,
  );
}

// BUYERMINI-19: khi chưa gắn OA, màn đơn hàng chỉ có một dòng chữ xám "Nhắn Tubu qua Zalo OA" không bấm được.
describe('SupportContact — kênh hỗ trợ trên chi tiết đơn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasOA = false;
    mocks.chatEnabled = false;
    mocks.authStatus = 'authenticated';
    mocks.authError = undefined;
    mocks.fetchSupportContact.mockResolvedValue({ hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null });
    mocks.copyText.mockResolvedValue(true);
  });

  it('chưa có OA: vẫn có nút gọi hotline (gọi đúng số) và email để sao chép', async () => {
    renderBlock();
    fireEvent.click(await screen.findByRole('button', { name: /Gọi hotline 0984 606 774/ }));
    expect(mocks.callPhone).toHaveBeenCalledWith('0984 606 774');
    expect(screen.queryByRole('button', { name: /Zalo OA/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /tubutree@gmail.com/ }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('tubutree@gmail.com'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
  });

  it('tổng đài số liền 18001234: nút hiện "1800 1234" cho dễ đọc nhưng vẫn gọi đúng số gốc (R5-BUYER-5)', async () => {
    mocks.fetchSupportContact.mockResolvedValue({ hotline: '18001234', email: null, zaloOaName: null });
    renderBlock();
    fireEvent.click(await screen.findByRole('button', { name: 'Gọi hotline 1800 1234' }));
    expect(mocks.callPhone).toHaveBeenCalledWith('18001234');
  });

  it('có OA: nút nhắn Zalo OA kèm mã đơn, hotline vẫn hiện', async () => {
    mocks.hasOA = true;
    renderBlock();
    fireEvent.click(await screen.findByRole('button', { name: /Nhắn Zalo OA/ }));
    expect(mocks.openOAChat).toHaveBeenCalledWith('Hỗ trợ đơn TT001');
    expect(await screen.findByRole('button', { name: /Gọi hotline/ })).toBeInTheDocument();
  });

  it('sao chép không được → báo lỗi thay vì báo thành công', async () => {
    mocks.copyText.mockResolvedValue(false);
    renderBlock();
    fireEvent.click(await screen.findByRole('button', { name: /tubutree@gmail.com/ }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
  });

  it('admin để trống hết và không có OA → ẩn cả khối, không hiện dòng chữ cụt', async () => {
    mocks.fetchSupportContact.mockResolvedValue({ hotline: null, email: null, zaloOaName: null });
    const { container } = renderBlock();
    await waitFor(() => expect(mocks.fetchSupportContact).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.textContent).toBe('');
  });

  it('không đọc được cấu hình → rơi về hotline/email mặc định của Tubu', async () => {
    mocks.fetchSupportContact.mockRejectedValue(new Error('mạng'));
    renderBlock();
    expect(await screen.findByRole('button', { name: /Gọi hotline 0984 606 774/ })).toBeInTheDocument();
  });

  describe('chat với Tubu Tree', () => {
    it('chat bật và đã đăng nhập: nút "Chat với Tubu Tree" mở /chat?order=<mã đơn>, không còn nút OA', async () => {
      mocks.chatEnabled = true;
      mocks.hasOA = true;
      renderBlock();
      fireEvent.click(await screen.findByRole('button', { name: /Chat với Tubu Tree/ }));
      expect(mocks.navigate).toHaveBeenCalledWith('/chat?order=TT001');
      expect(screen.queryByRole('button', { name: /Zalo OA/ })).toBeNull();
      expect(await screen.findByRole('button', { name: /Gọi hotline/ })).toBeInTheDocument();
    });

    it('chat tắt: giữ nút OA và hotline như cũ, không có nút chat', async () => {
      mocks.hasOA = true;
      renderBlock();
      expect(await screen.findByRole('button', { name: /Nhắn Zalo OA/ })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Gọi hotline/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Chat với Tubu Tree/ })).toBeNull();
    });

    it('chat bật nhưng chưa đăng nhập: giữ OA và hotline, thêm lời mời đăng nhập', async () => {
      mocks.chatEnabled = true;
      mocks.hasOA = true;
      mocks.authStatus = 'idle';
      renderBlock();
      expect(await screen.findByRole('button', { name: /Nhắn Zalo OA/ })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Gọi hotline/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập để chat với Tubu Tree' }));
      expect(mocks.login).toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /^Chat với Tubu Tree/ })).toBeNull();
    });

    it('chat bật, tài khoản bị khoá: bấm đăng nhập thì báo lời khoá của máy chủ', async () => {
      mocks.chatEnabled = true;
      mocks.authStatus = 'idle';
      mocks.authError = 'Tài khoản đã bị khoá. Liên hệ Tubu Tree để được hỗ trợ.';
      renderBlock();
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập để chat với Tubu Tree' }));
      await waitFor(() =>
        expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Tài khoản đã bị khoá. Liên hệ Tubu Tree để được hỗ trợ.', type: 'error' }),
      );
    });

    it('chat bật, khách thường bấm đăng nhập: không có thanh báo lỗi', async () => {
      mocks.chatEnabled = true;
      mocks.authStatus = 'idle';
      renderBlock();
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập để chat với Tubu Tree' }));
      await waitFor(() => expect(mocks.login).toHaveBeenCalled());
      expect(mocks.openSnackbar).not.toHaveBeenCalled();
    });

    it('đang khôi phục phiên: không hiện lời mời đăng nhập hay nút chat, chỉ OA và hotline', async () => {
      mocks.chatEnabled = true;
      mocks.hasOA = true;
      mocks.authStatus = 'loading';
      renderBlock();
      expect(await screen.findByRole('button', { name: /Nhắn Zalo OA/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /chat với Tubu Tree/i })).toBeNull();
    });
  });

  describe('vùng có tên và số đều', () => {
    it('khối là một vùng (region) lấy tên từ dòng tiêu đề "Cần hỗ trợ?" qua aria-labelledby', async () => {
      renderBlock();
      const region = await screen.findByRole('region', { name: 'Cần hỗ trợ?' });
      const titleId = region.getAttribute('aria-labelledby')!;
      expect(titleId).toBeTruthy();
      const title = document.getElementById(titleId)!;
      expect(title.textContent).toBe('Cần hỗ trợ?');
      // Không bọc thêm phần tử: dòng tiêu đề vẫn là con trực tiếp của khối, cùng cấp với các nút.
      expect(title.parentElement).toBe(region);
    });

    it('hai khối cùng trang có hai id tiêu đề khác nhau, mỗi vùng trỏ đúng tiêu đề của mình', async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <SupportContact orderCode="TT001" />
          <SupportContact orderCode="TT002" />
        </QueryClientProvider>,
      );
      const regions = await screen.findAllByRole('region', { name: 'Cần hỗ trợ?' });
      expect(regions).toHaveLength(2);
      const ids = regions.map((r) => r.getAttribute('aria-labelledby'));
      expect(new Set(ids).size).toBe(2);
      regions.forEach((region, i) => expect(region.contains(document.getElementById(ids[i]!))).toBe(true));
    });

    it('khối ẩn thì không còn vùng nào', async () => {
      mocks.fetchSupportContact.mockResolvedValue({ hotline: null, email: null, zaloOaName: null });
      renderBlock();
      await waitFor(() => expect(mocks.fetchSupportContact).toHaveBeenCalled());
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(screen.queryByRole('region')).toBeNull();
    });

    it('nút hotline dùng số đều (tabular-nums); nút email thì không', async () => {
      renderBlock();
      const call = await screen.findByRole('button', { name: /Gọi hotline/ });
      expect(call.style.fontVariantNumeric).toBe('tabular-nums');
      expect(screen.getByRole('button', { name: /tubutree@gmail.com/ }).style.fontVariantNumeric).toBe('');
    });
  });

  describe('khoá đồng bộ cho cầu nối đang chạy', () => {
    const deferred = () => {
      let resolve!: (value?: unknown) => void;
      const promise = new Promise((r) => (resolve = r));
      return { promise, resolve };
    };
    const twice = (el: HTMLElement) =>
      act(async () => {
        fireEvent.click(el);
        fireEvent.click(el);
      });

    it('gọi hotline: hai cú chạm cùng nhịp khi cuộc gọi còn treo chỉ gọi một lần; xong thì chạm lại được', async () => {
      const gate = deferred();
      mocks.callPhone.mockReturnValueOnce(gate.promise);
      renderBlock();
      const btn = await screen.findByRole('button', { name: /Gọi hotline/ });
      await twice(btn);
      expect(mocks.callPhone).toHaveBeenCalledTimes(1);
      await act(async () => {
        gate.resolve();
      });
      fireEvent.click(btn);
      expect(mocks.callPhone).toHaveBeenCalledTimes(2);
    });

    it('sao chép email: hai cú chạm cùng nhịp khi lần chép còn treo chỉ chép, rung và báo một lần; xong thì chạm lại được', async () => {
      const gate = deferred();
      mocks.copyText.mockReturnValueOnce(gate.promise);
      renderBlock();
      const btn = await screen.findByRole('button', { name: /tubutree@gmail.com/ });
      await twice(btn);
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
    });

    it('nhắn Zalo OA: hai cú chạm cùng nhịp khi OA còn đang mở chỉ mở một lần; xong thì chạm lại được', async () => {
      const gate = deferred();
      mocks.hasOA = true;
      mocks.openOAChat.mockReturnValueOnce(gate.promise);
      renderBlock();
      const btn = await screen.findByRole('button', { name: /Nhắn Zalo OA/ });
      await twice(btn);
      expect(mocks.openOAChat).toHaveBeenCalledTimes(1);
      await act(async () => {
        gate.resolve();
      });
      fireEvent.click(btn);
      expect(mocks.openOAChat).toHaveBeenCalledTimes(2);
    });

    it('đăng nhập để chat: hai cú chạm cùng nhịp khi đăng nhập còn treo chỉ đăng nhập một lần; xong thì chạm lại được', async () => {
      const gate = deferred();
      mocks.chatEnabled = true;
      mocks.authStatus = 'idle';
      mocks.login.mockReturnValueOnce(gate.promise);
      renderBlock();
      const btn = await screen.findByRole('button', { name: 'Đăng nhập để chat với Tubu Tree' });
      await twice(btn);
      expect(mocks.login).toHaveBeenCalledTimes(1);
      await act(async () => {
        gate.resolve();
      });
      fireEvent.click(btn);
      expect(mocks.login).toHaveBeenCalledTimes(2);
    });

    it('mỗi hành động một khoá riêng: OA, đăng nhập, gọi và sao chép cùng treo vẫn không chặn nhau', async () => {
      mocks.hasOA = true;
      mocks.chatEnabled = true;
      mocks.authStatus = 'idle';
      mocks.openOAChat.mockReturnValueOnce(deferred().promise);
      mocks.login.mockReturnValueOnce(deferred().promise);
      mocks.callPhone.mockReturnValueOnce(deferred().promise);
      mocks.copyText.mockReturnValueOnce(deferred().promise);
      renderBlock();
      const call = await screen.findByRole('button', { name: /Gọi hotline/ });
      const oa = screen.getByRole('button', { name: /Nhắn Zalo OA/ });
      const login = screen.getByRole('button', { name: 'Đăng nhập để chat với Tubu Tree' });
      const copy = screen.getByRole('button', { name: /tubutree@gmail.com/ });
      for (const btn of [oa, login, call, copy]) {
        await act(async () => {
          fireEvent.click(btn);
        });
      }
      expect(mocks.openOAChat).toHaveBeenCalledTimes(1);
      expect(mocks.login).toHaveBeenCalledTimes(1);
      expect(mocks.callPhone).toHaveBeenCalledTimes(1);
      expect(mocks.copyText).toHaveBeenCalledWith('tubutree@gmail.com');
    });
  });
});
