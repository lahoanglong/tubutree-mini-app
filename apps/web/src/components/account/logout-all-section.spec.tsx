// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Cùng ý nghĩa logout-all-section.spec.tsx của Mini App: hỏi xác nhận rồi cắt hết phiên; khoá khi đang gửi; lỗi hiện thành banner và mất khi mở lại.

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  apiFetch: vi.fn(),
}));
// Bọc ConfirmSheet để đọc props mới nhất: `dismissible=false` và nút Huỷ `disabled` đã chặn mọi đường bấm,
// nên chỉ gọi thẳng onConfirm/onCancel mới chứng minh được guard trong LogoutAllSection.
const sheetSpy = vi.hoisted(() => ({
  calls: [] as Array<{ open: boolean; loading?: boolean; onConfirm: () => void; onCancel: () => void }>,
}));
vi.mock('@/components/ui/confirm-sheet', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui/confirm-sheet')>();
  return {
    ...orig,
    ConfirmSheet: (p: Parameters<typeof orig.ConfirmSheet>[0]) => {
      sheetSpy.calls.push(p);
      return <orig.ConfirmSheet {...p} />;
    },
  };
});
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ logout: mocks.logout }) }));
vi.mock('@/lib/client-api', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), apiFetch: mocks.apiFetch }));

import { LogoutAllSection } from './logout-all-section';

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
  const r = render(<LogoutAllSection />);
  mounted.push(r);
  return r;
};
const body = () => document.body;
const lastSheet = () => sheetSpy.calls.at(-1)!;
const trigger = () => byText(body(), 'button', 'Đăng xuất mọi thiết bị') as HTMLButtonElement;
const confirmBtn = () => byText(body(), 'button', 'Đăng xuất mọi máy') as HTMLButtonElement;
const cancelBtn = () => byText(body(), 'button', 'Huỷ') as HTMLButtonElement;
const sheetOpen = () => body().textContent?.includes('Đăng xuất khỏi mọi thiết bị?') ?? false;
const banner = () => body().querySelector<HTMLElement>('p[role="alert"]');

beforeEach(() => {
  sheetSpy.calls.length = 0;
  mocks.logout.mockReset();
  mocks.apiFetch.mockReset().mockResolvedValue({});
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('LogoutAllSection (web)', () => {
  it('bấm nút → hỏi xác nhận (chưa gọi gì); xác nhận gọi logout-all đúng một lần rồi đăng xuất máy này', async () => {
    mount();
    expect(trigger().disabled).toBe(false);
    click(trigger());
    expect(sheetOpen()).toBe(true);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    click(confirmBtn());
    await flush(4);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/logout-all', { method: 'POST' });
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('Huỷ khi chưa gửi: đóng hộp xác nhận, không gọi máy chủ', async () => {
    mount();
    click(trigger());
    click(cancelBtn());
    await flush(2);
    expect(sheetOpen()).toBe(false);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('máy chủ lỗi: banner role="alert", đóng hộp xác nhận, giữ phiên; mở lại hộp thì banner cũ biến mất', async () => {
    mocks.apiFetch.mockRejectedValueOnce(new Error('Máy chủ bận'));
    mount();
    click(trigger());
    click(confirmBtn());
    await flush(6);
    expect(banner()?.textContent).toContain('Máy chủ bận');
    expect(sheetOpen()).toBe(false);
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(trigger().disabled).toBe(false);

    click(trigger());
    await flush(2);
    expect(banner()).toBeNull();
    expect(sheetOpen()).toBe(true);
  });
});

describe('LogoutAllSection (web): khoá khi đang đăng xuất mọi thiết bị', () => {
  async function startPending() {
    const pending = deferred<unknown>();
    mocks.apiFetch.mockReturnValue(pending.promise);
    mount();
    click(trigger());
    click(confirmBtn());
    await flush(2);
    return pending;
  }

  it('đang gửi: nút mở hộp bị khoá, nút xác nhận báo bận, Huỷ bị khoá, hộp không đóng bằng bấm', async () => {
    const pending = await startPending();
    expect(lastSheet().loading).toBe(true);
    expect(trigger().disabled).toBe(true);
    expect(confirmBtn().getAttribute('aria-busy')).toBe('true');
    expect(cancelBtn().disabled).toBe(true);
    click(cancelBtn());
    click(confirmBtn());
    await flush(2);
    expect(sheetOpen()).toBe(true);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    pending.resolve({});
    await flush(4);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('đang gửi: onCancel bị guard (hộp vẫn mở), onConfirm bị guard (không gửi lần hai)', async () => {
    const pending = await startPending();
    act(() => lastSheet().onCancel());
    expect(lastSheet().open).toBe(true);
    expect(sheetOpen()).toBe(true);
    act(() => lastSheet().onConfirm());
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    pending.resolve({});
    await flush(4);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('gửi xong lỗi: nút mở khoá lại, mở hộp xoá banner cũ, gửi lại được', async () => {
    const pending = await startPending();
    pending.reject(new Error('Máy chủ bận'));
    await flush(6);
    expect(lastSheet().open).toBe(false);
    expect(banner()?.textContent).toContain('Máy chủ bận');
    expect(trigger().disabled).toBe(false);

    mocks.apiFetch.mockResolvedValue({});
    click(trigger());
    await flush(2);
    expect(banner()).toBeNull();
    click(confirmBtn());
    await flush(4);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });
});
