// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// R-111: Xoá tài khoản nằm ở Cài đặt (chuyển từ Giới thiệu), cùng luồng xác nhận và cùng API.

const mocks = vi.hoisted(() => ({
  auth: { status: 'authenticated' as string, initialized: true, sessionUnavailable: false, user: { id: 'u1' } as unknown, logout: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
  oaAvailable: false,
  openChat: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post, patch: vi.fn() } }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    oa: {
      get available() {
        return mocks.oaAvailable;
      },
      openChat: mocks.openChat,
      follow: vi.fn(),
    },
    storage: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
  },
}));

import SettingsPage from './page';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<SettingsPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const button = (c: HTMLElement, name: string | RegExp) => byText(c, 'button', name) as HTMLButtonElement;

function setup({ wallet = { walletBalance: 0 } as unknown } = {}) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/me/wallet') {
      if (wallet instanceof Error) throw wallet;
      return wallet;
    }
    if (path === '/me/notifications/prefs') return { notifyPromo: true, notifyGarden: true };
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.auth.sessionUnavailable = false;
  mocks.get.mockReset();
  mocks.post.mockReset().mockResolvedValue({ message: 'Đã ghi nhận yêu cầu' });
  mocks.oaAvailable = false;
  mocks.openChat.mockReset().mockResolvedValue(undefined);
  setup();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/cai-dat: xoá tài khoản', () => {
  it('khách chưa đăng nhập không thấy Xoá tài khoản', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.user = null;
    const { container } = await mount();
    expect(byText(container, 'button', 'Xoá tài khoản')).toBeNull();
  });

  it('Xoá tài khoản: bấm, hỏi lại, "Gửi yêu cầu xoá" gọi API đúng một lần; "Huỷ" quay về', async () => {
    const { container } = await mount();
    click(button(container, 'Xoá tài khoản'));
    expect(container.textContent).toContain('Xoá tài khoản vĩnh viễn?');
    click(button(container, 'Huỷ'));
    expect(container.textContent).not.toContain('Xoá tài khoản vĩnh viễn?');
    expect(mocks.post).not.toHaveBeenCalled();

    click(button(container, 'Xoá tài khoản'));
    await flush();
    click(button(container, 'Gửi yêu cầu xoá'));
    await flush();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![0]).toBe('/me/deletion-request');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Đã ghi nhận yêu cầu');
    expect(byText(container, 'button', 'Gửi yêu cầu xoá')).toBeNull();
  });

  it('Ví còn tiền: hiện số dư mất, nút gửi bị khoá tới khi tick đồng ý, rồi gửi kèm đúng số dư đã thấy', async () => {
    setup({ wallet: { walletBalance: 20000 } });
    const { container } = await mount();
    click(button(container, 'Xoá tài khoản'));
    await flush();
    expect(container.textContent).toContain('Ví Tubu còn 20.000đ. Xoá tài khoản thì số dư này mất và không hoàn lại.');
    expect(button(container, 'Gửi yêu cầu xoá').disabled).toBe(true);
    click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await flush();
    expect(button(container, 'Gửi yêu cầu xoá').disabled).toBe(false);
    click(button(container, 'Gửi yêu cầu xoá'));
    await flush();
    expect(mocks.post).toHaveBeenCalledWith('/me/deletion-request', { reason: undefined, acknowledgedWalletBalance: 20000, acceptWalletForfeit: true });
  });

  it('máy chủ từ chối vì số dư đã đổi: bỏ tick, tải lại số dư, khách phải đồng ý lại với số mới', async () => {
    let calls = 0;
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/faqs') return FAQS;
      if (path === '/config/public') return { support: SUPPORT };
      if (path === '/me/wallet') return { walletBalance: ++calls === 1 ? 20000 : 30000 };
      throw new Error(`unexpected ${path}`);
    });
    mocks.post.mockRejectedValueOnce(new Error('Số dư Ví Tubu vừa đổi'));
    const { container } = await mount();
    click(button(container, 'Xoá tài khoản'));
    await flush();
    click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await flush();
    click(button(container, 'Gửi yêu cầu xoá'));
    await flush(8);
    expect(container.textContent).toContain('Ví Tubu còn 30.000đ');
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect(button(container, 'Gửi yêu cầu xoá').disabled).toBe(true);
  });

  it('chưa biết số dư (tải lỗi): không cho gửi', async () => {
    setup({ wallet: new Error('mạng') });
    const { container } = await mount();
    click(button(container, 'Xoá tài khoản'));
    await flush(8);
    expect(container.textContent).toContain('Chưa tải được số dư Ví Tubu');
    expect(button(container, 'Gửi yêu cầu xoá').disabled).toBe(true);
  });

  it('gửi yêu cầu lỗi: báo lỗi và cho gửi lại', async () => {
    mocks.post.mockRejectedValueOnce(new Error('Máy chủ bận'));
    const { container } = await mount();
    click(button(container, 'Xoá tài khoản'));
    await flush();
    click(button(container, 'Gửi yêu cầu xoá'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ bận');
    click(button(container, 'Gửi yêu cầu xoá'));
    await flush();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('có OA cấu hình: sau khi gửi yêu cầu có nút nhắn Zalo OA để trao đổi trực tiếp', async () => {
    mocks.oaAvailable = true;
    const { container } = await mount();
    click(button(container, 'Xoá tài khoản'));
    await flush();
    click(button(container, 'Gửi yêu cầu xoá'));
    await flush();
    click(button(container, 'Nhắn Zalo OA về việc xoá tài khoản'));
    expect(mocks.openChat).toHaveBeenCalledWith('Tôi muốn xoá tài khoản Tubu Tree');
  });
});
