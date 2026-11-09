// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';
import { WALLET_FORFEIT_LOADING, WALLET_FORFEIT_UNKNOWN, walletForfeitNotice } from '@tubutree/app-core/account-deletion-copy';
import { formatVnd } from '@/lib/format-vnd';

// Cùng ý nghĩa account-deletion-section.spec.tsx của Mini App: vùng xác nhận có tên, báo bận, khoá khi đang gửi, lỗi nội tuyến, đóng/mở lại sạch trạng thái.

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
const cancel = () => btn('Huỷ');
const checkbox = () => body().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const region = () => body().querySelector<HTMLElement>('[role="region"]');
const alerts = () => Array.from(body().querySelectorAll<HTMLElement>('[role="alert"]'));
const statuses = () => Array.from(body().querySelectorAll<HTMLElement>('[role="status"]'));
const cardOpen = () => body().textContent?.includes('Xoá tài khoản vĩnh viễn?') ?? false;
// Nút/ô `disabled` đã chặn mọi lượt bấm thật; chỉ gọi thẳng handler trong props React mới chứng minh được guard của component.
const reactProps = (el: Element) => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))!;
  return (el as unknown as Record<string, { onClick?: () => void; onChange?: (e: { target: { checked: boolean } }) => void }>)[key]!;
};
const openCard = async () => {
  click(btn('Xoá tài khoản'));
  await flush(6);
};
const FORFEIT = 50000;
const consent = { acknowledgedWalletBalance: FORFEIT, acceptWalletForfeit: true };

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

describe('AccountDeletionSection (web): khung xác nhận', () => {
  it('chưa mở: chỉ có nút "Xoá tài khoản", không có vùng xác nhận và chưa hỏi số dư', async () => {
    mount();
    await flush(3);
    expect(btn('Xoá tài khoản')).not.toBeNull();
    expect(region()).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('mở thẻ: vùng role="region" tên "Xác nhận xoá tài khoản"; tải số dư thì aria-busy + chữ đang kiểm tra là role="status"; xong thì hết cả hai', async () => {
    const wallet = deferred<{ walletBalance: number }>();
    mocks.get.mockReturnValue(wallet.promise);
    mount();
    await openCard();
    expect(region()?.getAttribute('aria-label')).toBe('Xác nhận xoá tài khoản');
    expect(region()?.getAttribute('aria-busy')).toBe('true');
    expect(statuses()).toHaveLength(1);
    expect(statuses()[0]!.textContent).toBe(WALLET_FORFEIT_LOADING);
    expect(submit().disabled).toBe(true);
    await act(async () => wallet.resolve({ walletBalance: 0 }));
    await flush(4);
    expect(statuses()).toHaveLength(0);
    expect(body().textContent).not.toContain(WALLET_FORFEIT_LOADING);
    expect(region()?.hasAttribute('aria-busy')).toBe(false);
    expect(submit().disabled).toBe(false);
  });

  it('tải số dư lỗi: role="alert" báo không biết số dư, hết chữ đang kiểm tra, vùng không còn bận, nút gửi khoá', async () => {
    mocks.get.mockRejectedValue(new Error('mạng'));
    mount();
    await openCard();
    expect(alerts().map((a) => a.textContent)).toEqual([WALLET_FORFEIT_UNKNOWN]);
    expect(statuses()).toHaveLength(0);
    expect(region()?.hasAttribute('aria-busy')).toBe(false);
    expect(submit().disabled).toBe(true);
  });

  it('Ví còn tiền: thông báo mất số dư dùng số đều, ô đồng ý mở khoá nút gửi', async () => {
    mocks.get.mockResolvedValue({ walletBalance: FORFEIT });
    mount();
    await openCard();
    const notice = byText(body(), 'p', walletForfeitNotice(formatVnd(FORFEIT)))!;
    expect(notice.className).toContain('tabular-nums');
    expect(notice.className).toContain('font-bold');
    expect(submit().disabled).toBe(true);
    click(checkbox());
    expect(checkbox().checked).toBe(true);
    expect(submit().disabled).toBe(false);
    click(checkbox());
    expect(checkbox().checked).toBe(false);
    expect(submit().disabled).toBe(true);
  });

  it('Ví trống: không có ô đồng ý, gửi được ngay và không kèm đồng ý', async () => {
    mount();
    await openCard();
    expect(checkbox()).toBeNull();
    click(submit());
    await flush(6);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![1]).toEqual({});
  });
});

describe('AccountDeletionSection (web): đang gửi yêu cầu', () => {
  it('khoá Huỷ + ô đồng ý, vùng và nút gửi báo bận; bấm Huỷ không đóng thẻ; xong thì hiện thông báo kết quả', async () => {
    mocks.get.mockResolvedValue({ walletBalance: FORFEIT });
    const send = deferred<{ message: string }>();
    mocks.post.mockReturnValue(send.promise);
    mount();
    await openCard();
    click(checkbox());
    click(submit());
    await flush(3);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ acknowledgedWalletBalance: consent.acknowledgedWalletBalance, acceptWalletForfeit: true });
    expect(region()?.getAttribute('aria-busy')).toBe('true');
    expect(cancel().disabled).toBe(true);
    expect(checkbox().disabled).toBe(true);
    expect(checkbox().checked).toBe(true);
    expect(submit().disabled).toBe(true);
    expect(submit().getAttribute('aria-busy')).toBe('true');

    click(cancel());
    click(submit());
    expect(cardOpen()).toBe(true);
    expect(mocks.post).toHaveBeenCalledTimes(1);

    await act(async () => send.resolve({ message: 'Đã ghi nhận yêu cầu' }));
    await flush(4);
    expect(region()).toBeNull();
    expect(statuses().map((s) => s.textContent)).toContain('Đã ghi nhận yêu cầu');
  });

  it('đang gửi: handler gọi thẳng (qua mặt nút khoá) bị bỏ qua, không đóng thẻ, không đổi tick, không gửi lần hai', async () => {
    mocks.get.mockResolvedValue({ walletBalance: FORFEIT });
    const send = deferred<{ message: string }>();
    mocks.post.mockReturnValue(send.promise);
    mount();
    await openCard();
    click(checkbox());
    click(submit());
    await flush(3);
    expect(region()?.getAttribute('aria-busy')).toBe('true');

    // mutate() chạy mutationFn sau vài microtask: phải đợi act bất đồng bộ thì lượt gửi thừa mới lộ ra.
    await act(async () => {
      reactProps(cancel()).onClick?.();
      reactProps(submit()).onClick?.();
      reactProps(submit()).onClick?.();
      reactProps(checkbox()).onChange?.({ target: { checked: false } });
    });
    await flush(3);
    expect(cardOpen()).toBe(true);
    expect(checkbox().checked).toBe(true);
    expect(region()?.getAttribute('aria-busy')).toBe('true');
    expect(mocks.post).toHaveBeenCalledTimes(1);

    await act(async () => send.resolve({ message: 'Đã ghi nhận yêu cầu' }));
    await flush(4);
    expect(region()).toBeNull();
  });

  it('rảnh thì Huỷ và ô đồng ý dùng được, vùng và nút gửi không báo bận', async () => {
    mocks.get.mockResolvedValue({ walletBalance: FORFEIT });
    mount();
    await openCard();
    click(checkbox());
    expect(cancel().disabled).toBe(false);
    expect(checkbox().disabled).toBe(false);
    expect(region()?.hasAttribute('aria-busy')).toBe(false);
    expect(submit().hasAttribute('aria-busy')).toBe(false);
    expect(submit().disabled).toBe(false);
  });

  it('gửi xong với Zalo OA: có nút nhắn Zalo OA và bấm thì mở cuộc trò chuyện', async () => {
    mocks.oaAvailable = true;
    mount();
    await openCard();
    click(submit());
    await flush(6);
    click(btn('Nhắn Zalo OA về việc xoá tài khoản'));
    expect(mocks.openChat).toHaveBeenCalledWith('Tôi muốn xoá tài khoản Tubu Tree');
  });

  it('gửi xong khi không có Zalo OA: chỉ có thông báo kết quả, không có nút nhắn', async () => {
    mount();
    await openCard();
    click(submit());
    await flush(6);
    expect(statuses().map((s) => s.textContent)).toContain('Đã ghi nhận yêu cầu');
    expect(byText(body(), 'button', 'Nhắn Zalo OA về việc xoá tài khoản')).toBeNull();
    expect(mocks.openChat).not.toHaveBeenCalled();
  });
});

describe('AccountDeletionSection (web): gửi lỗi, Huỷ và mở lại', () => {
  it('gửi lỗi: role="alert" nội tuyến có lời lỗi, bỏ tick, tải lại số dư; thẻ vẫn mở và hết bận', async () => {
    mocks.get.mockResolvedValue({ walletBalance: FORFEIT });
    mocks.post.mockRejectedValueOnce(new ApiError('Số dư ví vừa thay đổi, kiểm tra lại nhé.', 400));
    mount();
    await openCard();
    expect(alerts()).toHaveLength(0);
    click(checkbox());
    click(submit());
    await flush(6);
    expect(alerts().map((a) => a.textContent)).toEqual(['Số dư ví vừa thay đổi, kiểm tra lại nhé.']);
    expect(alerts()[0]!.tagName).toBe('P');
    expect(cardOpen()).toBe(true);
    expect(region()?.hasAttribute('aria-busy')).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(checkbox().checked).toBe(false);
    expect(submit().disabled).toBe(true);
  });

  it('gửi lỗi rồi tick lại lúc ví chưa tải xong: ví ra số dư khác thì tick cũ hết hiệu lực, nút gửi khoá, không gửi kèm số mới', async () => {
    const refetch = deferred<{ walletBalance: number }>();
    mocks.get.mockReset().mockResolvedValueOnce({ walletBalance: FORFEIT }).mockReturnValueOnce(refetch.promise);
    mocks.post.mockRejectedValueOnce(new ApiError('Số dư ví vừa thay đổi, kiểm tra lại nhé.', 400));
    mount();
    await openCard();
    click(checkbox());
    click(submit());
    await flush(6);
    expect(alerts()).toHaveLength(1);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    click(checkbox());
    expect(checkbox().checked).toBe(true);
    await act(async () => refetch.resolve({ walletBalance: 80000 }));
    await flush(4);
    expect(byText(body(), 'p', walletForfeitNotice(formatVnd(80000)))).not.toBeNull();
    expect(checkbox().checked).toBe(false);
    expect(submit().disabled).toBe(true);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('đã tick rồi ví tự tải lại ra số khác: tick hết hiệu lực; tick lại theo số mới thì gửi kèm đúng số mới', async () => {
    mocks.get.mockReset().mockResolvedValueOnce({ walletBalance: FORFEIT }).mockResolvedValue({ walletBalance: 80000 });
    const { qc } = mount();
    await openCard();
    click(checkbox());
    expect(submit().disabled).toBe(false);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['wallet'] });
    });
    await flush(4);
    expect(byText(body(), 'p', walletForfeitNotice(formatVnd(80000)))).not.toBeNull();
    expect(checkbox().checked).toBe(false);
    expect(submit().disabled).toBe(true);
    click(checkbox());
    expect(submit().disabled).toBe(false);
    click(submit());
    await flush(6);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ acknowledgedWalletBalance: 80000, acceptWalletForfeit: true });
  });

  it('Huỷ sau lỗi: thẻ đóng; mở lại thì lời lỗi cũ và ô đồng ý đều sạch', async () => {
    mocks.get.mockResolvedValue({ walletBalance: FORFEIT });
    mocks.post.mockRejectedValueOnce(new ApiError('Số dư ví vừa thay đổi, kiểm tra lại nhé.', 400));
    mount();
    await openCard();
    click(checkbox());
    click(submit());
    await flush(6);
    expect(alerts()).toHaveLength(1);
    click(cancel());
    expect(cardOpen()).toBe(false);
    await openCard();
    expect(alerts()).toHaveLength(0);
    expect(checkbox().checked).toBe(false);
  });

  it('Huỷ khi đã tick: mở lại thì chưa tick, chưa gọi máy chủ', async () => {
    mocks.get.mockResolvedValue({ walletBalance: FORFEIT });
    mount();
    await openCard();
    click(checkbox());
    expect(checkbox().checked).toBe(true);
    click(cancel());
    expect(region()).toBeNull();
    await openCard();
    expect(checkbox().checked).toBe(false);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('gửi lại sau lỗi: lời lỗi cũ biến mất lúc đang gửi và thành công thì hiện thông báo kết quả', async () => {
    mocks.post.mockRejectedValueOnce(new ApiError('Máy chủ đang bận, thử lại nhé.', 500));
    mount();
    await openCard();
    click(submit());
    await flush(6);
    expect(alerts()).toHaveLength(1);
    const again = deferred<{ message: string }>();
    mocks.post.mockReturnValue(again.promise);
    click(submit());
    await flush(3);
    expect(alerts()).toHaveLength(0);
    await act(async () => again.resolve({ message: 'Đã ghi nhận yêu cầu' }));
    await flush(4);
    expect(region()).toBeNull();
    expect(statuses().map((s) => s.textContent)).toContain('Đã ghi nhận yêu cầu');
  });
});
