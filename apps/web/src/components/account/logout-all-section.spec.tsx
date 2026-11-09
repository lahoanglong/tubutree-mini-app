// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

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
  it('chưa bấm: nút mở dùng được, chưa có tấm xác nhận, chưa có lời lỗi', () => {
    mount();
    expect(trigger().disabled).toBe(false);
    expect(sheetOpen()).toBe(false);
    expect(lastSheet().open).toBe(false);
    expect(banner()).toBeNull();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('bấm nút → hỏi xác nhận (chưa gọi máy chủ); trong lúc hỏi nút mở bị khoá; Huỷ đóng tấm và mở khoá nút', async () => {
    mount();
    click(trigger());
    await flush(3);
    expect(sheetOpen()).toBe(true);
    expect(trigger().disabled).toBe(true);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    click(cancelBtn());
    await flush(3);
    expect(sheetOpen()).toBe(false);
    expect(trigger().disabled).toBe(false);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('xác nhận: gọi logout-all đúng một lần rồi đăng xuất máy này, không có lời lỗi', async () => {
    mount();
    click(trigger());
    await flush(3);
    click(confirmBtn());
    await flush(6);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/auth/logout-all', { method: 'POST' });
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(banner()).toBeNull();
  });

  it('đang gọi: nút mở bị khoá, tấm báo loading, Huỷ khoá; onCancel/onConfirm gọi thẳng bị bỏ qua', async () => {
    const pending = deferred<unknown>();
    mocks.apiFetch.mockReturnValue(pending.promise);
    mount();
    click(trigger());
    await flush(3);
    click(confirmBtn());
    await flush(3);
    expect(lastSheet().loading).toBe(true);
    expect(trigger().disabled).toBe(true);
    expect(cancelBtn().disabled).toBe(true);

    act(() => lastSheet().onCancel());
    act(() => lastSheet().onConfirm());
    act(() => lastSheet().onConfirm());
    expect(sheetOpen()).toBe(true);
    expect(lastSheet().open).toBe(true);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({}));
    await flush(4);
    expect(mocks.logout).toHaveBeenCalledTimes(1);
  });

  it('rảnh thì onCancel/onConfirm gọi thẳng vẫn làm việc của chúng', async () => {
    mount();
    click(trigger());
    await flush(3);
    expect(lastSheet().open).toBe(true);
    act(() => lastSheet().onCancel());
    await flush(3);
    expect(lastSheet().open).toBe(false);
    click(trigger());
    await flush(3);
    expect(lastSheet().open).toBe(true);
    act(() => lastSheet().onConfirm());
    await flush(4);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });

  it('gọi lỗi: banner role="alert" ngay dưới nút có lời lỗi; tấm đóng, nút mở dùng lại được, chưa đăng xuất', async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError('Máy chủ đang bận, thử lại nhé.', 500));
    mount();
    click(trigger());
    await flush(3);
    click(confirmBtn());
    await flush(6);
    expect(banner()?.textContent).toBe('Máy chủ đang bận, thử lại nhé.');
    expect(body().querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(sheetOpen()).toBe(false);
    expect(trigger().disabled).toBe(false);
    expect(trigger().compareDocumentPosition(banner()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('mở lại sau lỗi: banner cũ mất ngay lúc mở tấm; thất bại lần hai hiện lại', async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError('Máy chủ đang bận, thử lại nhé.', 500));
    mount();
    click(trigger());
    await flush(3);
    click(confirmBtn());
    await flush(6);
    expect(banner()).not.toBeNull();

    click(trigger());
    await flush(3);
    expect(sheetOpen()).toBe(true);
    expect(banner()).toBeNull();

    click(confirmBtn());
    await flush(6);
    expect(banner()?.textContent).toBe('Máy chủ đang bận, thử lại nhé.');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });
});
