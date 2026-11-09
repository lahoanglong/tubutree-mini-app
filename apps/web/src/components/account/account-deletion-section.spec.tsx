// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';
import { WALLET_FORFEIT_LOADING, WALLET_FORFEIT_UNKNOWN } from '@tubutree/app-core/account-deletion-copy';

// Cùng ý nghĩa account-deletion-section.spec.tsx của Mini App: Thử lại khi tải số dư Ví lỗi, khoá khi đang gửi yêu cầu xoá, số đều.

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  oaAvailable: false,
  openChat: vi.fn(),
}));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post, patch: vi.fn() } }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    oa: {
      get available() {
        return mocks.oaAvailable;
      },
      openChat: mocks.openChat,
    },
  },
}));

import { AccountDeletionSection } from './account-deletion-section';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let mounted: Rendered[] = [];
const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const r = render(<AccountDeletionSection />, qc);
  mounted.push(r);
  return { ...r, qc };
};
const body = () => document.body;
const btn = (name: string | RegExp) => byText(body(), 'button', name) as HTMLButtonElement;
const submit = () => byText(body(), 'button', /Gửi yêu cầu xoá|Đang gửi/) as HTMLButtonElement;
const checkbox = () => body().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const walletAlert = () => Array.from(body().querySelectorAll<HTMLElement>('[role="alert"]')).find((a) => a.textContent?.includes(WALLET_FORFEIT_UNKNOWN)) ?? null;
const retry = () => byText(walletAlert()!, 'button', 'Thử lại') as HTMLButtonElement;
const cardOpen = () => body().textContent?.includes('Xoá tài khoản vĩnh viễn?') ?? false;
const openCard = async () => {
  click(btn('Xoá tài khoản'));
  await flush(6);
};

beforeEach(() => {
  mocks.oaAvailable = false;
  mocks.get.mockReset().mockResolvedValue({ walletBalance: 0 });
  mocks.post.mockReset().mockResolvedValue({ message: 'Đã ghi nhận yêu cầu' });
  mocks.openChat.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('AccountDeletionSection (web): tải số dư Ví lỗi + Thử lại', () => {
  it('tải số dư lỗi: role="alert" có lời báo + "Thử lại" đủ 44px; nút gửi bị khoá; Huỷ vẫn đóng được', async () => {
    mocks.get.mockRejectedValue(new Error('mạng'));
    mount();
    await openCard();
    expect(walletAlert()).not.toBeNull();
    expect(retry().disabled).toBe(false);
    expect(retry().className).toContain('min-h-11');
    expect(submit().disabled).toBe(true);
    expect(body().textContent).not.toContain(WALLET_FORFEIT_LOADING);

    click(btn('Huỷ'));
    expect(cardOpen()).toBe(false);
  });

  it('"Thử lại": gọi lại số dư; đang tải nút báo bận, vùng lỗi + focus đứng yên, không hiện chữ đang kiểm tra; xong thì mở khoá nút gửi', async () => {
    const again = deferred<{ walletBalance: number }>();
    mocks.get.mockReset().mockRejectedValueOnce(new Error('mạng')).mockReturnValueOnce(again.promise);
    mount();
    await openCard();
    const alert = walletAlert()!;
    const b = retry();
    expect(b.hasAttribute('aria-busy')).toBe(false);
    b.focus();
    click(b);
    await flush();
    expect(mocks.get).toHaveBeenCalledTimes(2);

    expect(walletAlert()).toBe(alert);
    expect(retry()).toBe(b);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(b);
    expect(body().textContent).not.toContain(WALLET_FORFEIT_LOADING);
    expect(submit().disabled).toBe(true);

    click(b);
    await flush();
    expect(mocks.get).toHaveBeenCalledTimes(2);

    again.resolve({ walletBalance: 0 });
    await flush();
    expect(walletAlert()).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('"Thử lại" lỗi tiếp: vùng lỗi vẫn đó, nút hết bận, thử lại được lần nữa', async () => {
    mocks.get.mockReset().mockRejectedValueOnce(new Error('mạng')).mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce({ walletBalance: 0 });
    mount();
    await openCard();
    click(retry());
    await flush(8);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(walletAlert()).not.toBeNull();
    expect(retry().hasAttribute('aria-busy')).toBe(false);
    expect(retry().hasAttribute('aria-disabled')).toBe(false);
    expect(submit().disabled).toBe(true);

    click(retry());
    await flush(8);
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(walletAlert()).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('đã Thử lại xong, đóng thẻ, cache Ví bị xoá (đăng xuất) rồi mở lại: hiện chữ đang kiểm tra, không hiện vùng lỗi cũ', async () => {
    mocks.get.mockReset().mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce({ walletBalance: 0 });
    const { qc } = mount();
    await openCard();
    click(retry());
    await flush(8);
    expect(walletAlert()).toBeNull();
    click(btn('Huỷ'));
    act(() => qc.removeQueries({ queryKey: ['wallet'] }));

    const slow = deferred<{ walletBalance: number }>();
    mocks.get.mockReset().mockReturnValue(slow.promise);
    click(btn('Xoá tài khoản'));
    await flush();
    expect(body().textContent).toContain(WALLET_FORFEIT_LOADING);
    expect(walletAlert()).toBeNull();
    slow.resolve({ walletBalance: 0 });
    await flush();
  });

  it('còn số dư cũ mà lần tải lại lỗi (sau khi máy chủ từ chối): vẫn hiện số dư + vùng lỗi + Thử lại; đang gửi thì Thử lại bị khoá', async () => {
    mocks.get.mockReset().mockResolvedValueOnce({ walletBalance: 20000 }).mockRejectedValueOnce(new Error('mạng'));
    mocks.post.mockRejectedValueOnce(new Error('Số dư vừa đổi'));
    mount();
    await openCard();
    expect(body().textContent).toContain('Ví Tubu còn 20.000đ');
    click(checkbox());
    click(submit());
    await flush(8);
    expect(walletAlert()).not.toBeNull();
    expect(body().textContent).toContain('Ví Tubu còn 20.000đ');
    expect(checkbox().checked).toBe(false);

    const pending = deferred<{ message: string }>();
    mocks.post.mockReturnValueOnce(pending.promise);
    click(checkbox());
    click(submit());
    await flush();
    expect(submit().getAttribute('aria-busy')).toBe('true');
    expect(retry().disabled).toBe(true);
    pending.resolve({ message: 'Đã ghi nhận yêu cầu' });
    await flush();
  });

  it('đã tick đồng ý với số dư cũ, Thử lại ra số dư mới: tick bị bỏ, nút gửi khoá, phải tick lại thì mới gửi đúng số mới', async () => {
    mocks.get.mockReset().mockResolvedValueOnce({ walletBalance: 20000 }).mockRejectedValueOnce(new Error('mạng')).mockResolvedValueOnce({ walletBalance: 30000 });
    mocks.post.mockRejectedValueOnce(new Error('Số dư vừa đổi'));
    mount();
    await openCard();
    click(checkbox());
    click(submit());
    await flush(8);
    expect(walletAlert()).not.toBeNull();
    expect(body().textContent).toContain('Ví Tubu còn 20.000đ');
    expect(checkbox().checked).toBe(false);

    click(checkbox());
    expect(checkbox().checked).toBe(true);
    expect(submit().disabled).toBe(false);
    click(retry());
    await flush(8);
    expect(body().textContent).toContain('Ví Tubu còn 30.000đ');
    expect(checkbox().checked).toBe(false);
    expect(submit().disabled).toBe(true);
    click(submit());
    await flush();
    expect(mocks.post).toHaveBeenCalledTimes(1);

    click(checkbox());
    click(submit());
    await flush(8);
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post).toHaveBeenLastCalledWith('/me/deletion-request', { reason: undefined, acknowledgedWalletBalance: 30000, acceptWalletForfeit: true });
  });

  it('tick đồng ý rồi Huỷ, mở lại thẻ (số dư cache giữ nguyên): ô đồng ý trống, nút gửi khoá', async () => {
    mocks.get.mockReset().mockResolvedValue({ walletBalance: 20000 });
    mount();
    await openCard();
    click(checkbox());
    expect(checkbox().checked).toBe(true);
    click(btn('Huỷ'));
    click(btn('Xoá tài khoản'));
    await flush();
    expect(body().textContent).toContain('Ví Tubu còn 20.000đ');
    expect(checkbox().checked).toBe(false);
    expect(submit().disabled).toBe(true);
  });

  it('còn số dư cũ + lỗi, đang tải lại: bấm Thử lại lần nữa không gọi thêm (react-query sẽ huỷ và gọi lại nếu không chặn)', async () => {
    const again = deferred<{ walletBalance: number }>();
    mocks.get.mockReset().mockResolvedValueOnce({ walletBalance: 20000 }).mockRejectedValueOnce(new Error('mạng')).mockReturnValueOnce(again.promise);
    mocks.post.mockRejectedValueOnce(new Error('Số dư vừa đổi'));
    mount();
    await openCard();
    click(checkbox());
    click(submit());
    await flush(8);
    expect(walletAlert()).not.toBeNull();
    expect(mocks.get).toHaveBeenCalledTimes(2);

    const b = retry();
    click(b);
    await flush();
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(b.getAttribute('aria-busy')).toBe('true');
    click(b);
    await flush();
    expect(mocks.get).toHaveBeenCalledTimes(3);

    again.resolve({ walletBalance: 20000 });
    await flush();
    expect(walletAlert()).toBeNull();
  });
});

describe('AccountDeletionSection (web): khoá khi đang gửi yêu cầu', () => {
  async function startPending() {
    mocks.get.mockReset().mockResolvedValue({ walletBalance: 20000 });
    const pending = deferred<{ message: string }>();
    mocks.post.mockReset().mockReturnValue(pending.promise);
    mount();
    await openCard();
    click(checkbox());
    await flush();
    submit().focus();
    click(submit());
    await flush();
    return pending;
  }

  it('đang gửi: Huỷ bị khoá và bấm không thu thẻ lại; ô đồng ý bị khoá; nút gửi báo bận ("Đang gửi…") nhưng giữ focus, bấm lại không gửi lần hai', async () => {
    const pending = await startPending();
    expect(btn('Huỷ').disabled).toBe(true);
    click(btn('Huỷ'));
    expect(cardOpen()).toBe(true);
    expect(checkbox().disabled).toBe(true);
    expect(checkbox().checked).toBe(true);

    const send = submit();
    expect(send.textContent).toBe('Đang gửi…');
    expect(send.getAttribute('aria-busy')).toBe('true');
    expect(send.getAttribute('aria-disabled')).toBe('true');
    expect(send.className).toContain('aria-disabled:opacity-60');
    expect(send.disabled).toBe(false);
    expect(document.activeElement).toBe(send);
    click(send);
    await flush();
    expect(mocks.post).toHaveBeenCalledTimes(1);

    pending.resolve({ message: 'Đã ghi nhận yêu cầu' });
    await flush();
    expect(body().querySelector('[role="status"]')?.textContent).toContain('Đã ghi nhận yêu cầu');
    expect(cardOpen()).toBe(false);
  });

  it('gửi lỗi: thẻ ở lại, báo lỗi, Huỷ + ô đồng ý mở khoá lại và bỏ tick, nút gửi hết bận', async () => {
    const pending = await startPending();
    pending.reject(new Error('Máy chủ bận'));
    await flush(8);
    expect(cardOpen()).toBe(true);
    expect(body().querySelector('[role="alert"]')?.textContent).toContain('Máy chủ bận');
    expect(btn('Huỷ').disabled).toBe(false);
    expect(checkbox().disabled).toBe(false);
    expect(checkbox().checked).toBe(false);
    expect(submit().textContent).toBe('Gửi yêu cầu xoá');
    expect(submit().hasAttribute('aria-busy')).toBe(false);
    expect(submit().hasAttribute('aria-disabled')).toBe(false);
    expect(submit().disabled).toBe(true);
  });

  it('lỗi gửi cũ không ở lại khi Huỷ rồi mở lại thẻ', async () => {
    mocks.post.mockRejectedValueOnce(new Error('Máy chủ bận'));
    mount();
    await openCard();
    click(submit());
    await flush(8);
    expect(body().querySelector('[role="alert"]')?.textContent).toContain('Máy chủ bận');
    click(btn('Huỷ'));
    expect(cardOpen()).toBe(false);
    click(btn('Xoá tài khoản'));
    await flush();
    expect(cardOpen()).toBe(true);
    expect(body().textContent).not.toContain('Máy chủ bận');
  });

  it('thành công có OA: hiện nút nhắn Zalo OA', async () => {
    mocks.oaAvailable = true;
    mount();
    await openCard();
    click(submit());
    await flush(8);
    click(btn('Nhắn Zalo OA về việc xoá tài khoản'));
    expect(mocks.openChat).toHaveBeenCalledWith('Tôi muốn xoá tài khoản Tubu Tree');
  });
});

describe('AccountDeletionSection (web): số đều (tabular-nums)', () => {
  it('dòng báo số dư Ví mất có tabular-nums', async () => {
    mocks.get.mockReset().mockResolvedValue({ walletBalance: 20000 });
    mount();
    await openCard();
    const notice = Array.from(body().querySelectorAll('p')).find((p) => p.textContent?.includes('Ví Tubu còn 20.000đ'))!;
    expect(notice.classList.contains('tabular-nums')).toBe(true);
  });
});

describe('AccountDeletionSection (web): khoá chạm đúp (yêu cầu xoá không hoàn tác)', () => {
  const twice = (el: HTMLElement) =>
    act(() => {
      el.click();
      el.click();
    });

  it('hai cú bấm "Gửi yêu cầu xoá" cùng khung hình chỉ gọi API một lần, kèm đúng số dư khách đã thấy và đã đồng ý', async () => {
    mocks.get.mockReset().mockResolvedValue({ walletBalance: 20000 });
    const pending = deferred<{ message: string }>();
    mocks.post.mockReset().mockReturnValue(pending.promise);
    mount();
    await openCard();
    click(checkbox());
    await flush();
    twice(submit());
    await flush(4);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![0]).toBe('/me/deletion-request');
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ acknowledgedWalletBalance: 20000, acceptWalletForfeit: true });
    pending.resolve({ message: 'Đã ghi nhận yêu cầu' });
    await flush(4);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(body().querySelector('[role="status"]')?.textContent).toContain('Đã ghi nhận yêu cầu');
  });

  it('Ví 0đ: hai cú bấm cùng khung hình cũng chỉ gửi một lần và không kèm phần đồng ý', async () => {
    const pending = deferred<{ message: string }>();
    mocks.post.mockReset().mockReturnValue(pending.promise);
    mount();
    await openCard();
    twice(submit());
    await flush(4);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![1]).not.toHaveProperty('acceptWalletForfeit');
    pending.resolve({ message: 'ok' });
    await flush(4);
  });

  it('gửi lỗi: khoá nhả, báo role=alert, nút gửi bấm lại được và lần hai gọi API (không có unhandled rejection)', async () => {
    mocks.post.mockReset().mockRejectedValueOnce(new Error('Máy chủ bận')).mockResolvedValueOnce({ message: 'Đã ghi nhận yêu cầu' });
    mount();
    await openCard();
    const seen = await captureUnhandledRejections(async () => {
      twice(submit());
      await flush(8);
    });
    expect(seen).toEqual([]);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(body().querySelector('[role="alert"]')?.textContent).toContain('Máy chủ bận');
    expect(submit().hasAttribute('aria-busy')).toBe(false);
    click(submit());
    await flush(8);
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(body().querySelector('[role="status"]')?.textContent).toContain('Đã ghi nhận yêu cầu');
  });

  it('còn số dư cũ mà lần tải lại lỗi: hai cú bấm "Thử lại" cùng khung hình chỉ tải lại một lần (có dữ liệu thì react-query huỷ rồi gọi lại nếu không chặn)', async () => {
    const again = deferred<{ walletBalance: number }>();
    mocks.get.mockReset().mockResolvedValueOnce({ walletBalance: 20000 }).mockRejectedValueOnce(new Error('mạng')).mockReturnValueOnce(again.promise);
    mocks.post.mockRejectedValueOnce(new Error('Số dư vừa đổi'));
    mount();
    await openCard();
    click(checkbox());
    click(submit());
    await flush(8);
    expect(walletAlert()).not.toBeNull();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    twice(retry());
    await flush(4);
    expect(mocks.get).toHaveBeenCalledTimes(3);
    again.resolve({ walletBalance: 20000 });
    await flush(4);
    expect(walletAlert()).toBeNull();
  });

  it('"Thử lại" số dư: hai cú bấm cùng khung hình chỉ tải lại một lần', async () => {
    const again = deferred<{ walletBalance: number }>();
    mocks.get.mockReset().mockRejectedValueOnce(new Error('mạng')).mockReturnValueOnce(again.promise);
    mount();
    await openCard();
    twice(retry());
    await flush(4);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    again.resolve({ walletBalance: 0 });
    await flush(4);
    expect(walletAlert()).toBeNull();
  });
});
