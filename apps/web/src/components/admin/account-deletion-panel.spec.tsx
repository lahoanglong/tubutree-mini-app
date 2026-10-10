// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AccountDeletionPanel, type AdminDeletionRequest } from './account-deletion-panel';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const req = (over: Partial<AdminDeletionRequest> = {}): AdminDeletionRequest => ({
  id: 'r1',
  userId: 'u1',
  reason: 'Không dùng nữa',
  status: 'PENDING',
  adminNote: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-10-01T03:00:00.000Z',
  user: {
    id: 'u1',
    fullName: 'Nguyễn Văn A',
    phone: '0912345678',
    role: 'CUSTOMER',
    walletBalance: 0,
    coinsBalance: 0,
    cashbackPending: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  blockers: [],
  ...over,
});

describe('AccountDeletionPanel (C-016)', () => {
  it('liệt kê yêu cầu chờ xử lý kèm tên, SĐT, lý do', async () => {
    const api = mockFetch({ '/admin/account-deletion-requests': { body: [req()] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/account-deletion-requests?status=PENDING');
    expect(container.textContent).toContain('Yêu cầu xoá tài khoản');
    expect(container.textContent).toContain('Nguyễn Văn A');
    expect(container.textContent).toContain('0912345678');
    expect(container.textContent).toContain('Không dùng nữa');
  });

  it('còn lý do chặn → hiện lý do, nút Xử lý bị khoá', async () => {
    const api = mockFetch({
      '/admin/account-deletion-requests': {
        body: [req({ blockers: [{ code: 'WALLET_BALANCE', message: 'Ví Tubu còn 50.000đ, khách cần rút hết trước' }] })],
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    expect(container.textContent).toContain('Ví Tubu còn 50.000đ');
    const btn = byText(container, 'button', 'Xử lý') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('bấm Xử lý + xác nhận → POST process với ghi chú; huỷ xác nhận thì không gọi', async () => {
    const api = mockFetch({
      '/process': { body: { alreadyProcessed: false } },
      '/admin/account-deletion-requests': { body: [req()] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    typeInto(container.querySelector('input[aria-label="Ghi chú xử lý"]'), 'đã gọi xác nhận');
    click(byText(container, 'button', 'Xử lý'));
    await flush();
    expect(api.calls.some((c) => c.url.includes('/process'))).toBe(false);
    click(byText(container, 'button', 'Xử lý'));
    await flush();
    expect(confirm).toHaveBeenCalledTimes(2);
    const call = api.calls.find((c) => c.url.includes('/process'));
    expect(call?.url).toContain('/admin/account-deletion-requests/r1/process');
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.body).toBe(JSON.stringify({ note: 'đã gọi xác nhận' }));
  });

  it('server từ chối (vừa phát sinh số dư) → hiện thông báo lỗi tiếng Việt', async () => {
    const api = mockFetch({
      '/process': { status: 400, body: { code: 'ACCOUNT_DELETION_BLOCKED', message: 'Chưa thể xoá tài khoản: còn 1 đơn hàng chưa hoàn tất.' } },
      '/admin/account-deletion-requests': { body: [req()] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    click(byText(container, 'button', 'Xử lý'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('còn 1 đơn hàng chưa hoàn tất');
  });

  it('yêu cầu đã xử lý: không có nút Xử lý, hiện thời điểm xử lý', async () => {
    const api = mockFetch({
      '/admin/account-deletion-requests': {
        body: [req({ status: 'RESOLVED', reviewedAt: '2026-10-02T03:00:00.000Z', adminNote: 'xong', user: null })],
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<AccountDeletionPanel />);
    await flush();
    click(byText(container, 'button', 'Đã xử lý'));
    await flush();
    expect(api.calls.some((c) => c.url.includes('status=RESOLVED'))).toBe(true);
    expect(byText(container, 'button', /^Xử lý/)).toBeNull();
    expect(container.textContent).toContain('xong');
  });
});
