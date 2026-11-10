// @vitest-environment jsdom
import { act } from 'react';
import { useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderInvoicePanel } from './order-detail-extras';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminOrder } from '@/lib/admin-client';

// W96B: "Đã xuất hoá đơn" (ghi nhận hoá đơn VAT, báo khách) giữ khoá tới khi đơn làm mới về (tối đa 4 giây), tải lại (chờ ≤4 giây) khi máy chủ từ chối vì đơn đã đổi:
// không gõ link thì 400/404/409; có gõ link thì 400 là lỗi nhập (link bị máy chủ từ chối, vd tên miền không được phép) hiện tại form, không tải lại, chỉ 404/409 tải lại.
// Test dựng QueryClient trần, không có MutationCache như production (ở đó khoá admin-* vẫn bị làm cũ sau mỗi lệnh), nên "không tải lại" là lệnh không tự gọi
// và không chờ tải lại. Nút báo bận bằng aria-busy/aria-disabled và ô link chỉ readOnly (không disabled).

const order = (): AdminOrder => ({
  id: 'o1',
  code: 'TB-500',
  status: 'DELIVERED',
  total: 300_000,
  paymentMethod: 'COD',
  createdAt: '2026-10-01T00:00:00.000Z',
  invoiceStatus: 'REQUESTED',
  invoiceRequest: { taxCode: '0312345678', companyName: 'Công ty ABC', address: '1 Lê Lợi, Q1', email: 'ketoan@abc.vn' },
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

/** Giữ một truy vấn ['admin-orders'] đang quan sát như danh sách đơn ở trang cha: làm mới nó là việc khoá phải đợi. */
function Harness() {
  useQuery({ queryKey: ['admin-orders'], queryFn: async () => (await fetch('/admin/orders')).json() as Promise<unknown> });
  return <OrderInvoicePanel order={order()} />;
}

let ordersLoads = 0;
let ordersGate: Promise<void> | undefined;
let postGate: Promise<void> | undefined;
let postStatus = 200;
const posts: string[] = [];

let mounted: Rendered | null = null;
beforeEach(() => {
  ordersLoads = 0;
  ordersGate = undefined;
  postGate = undefined;
  postStatus = 200;
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(url);
        await postGate;
        if (postStatus !== 200) return json(postStatus, { statusCode: postStatus, message: 'Hoá đơn của đơn TB-500 vừa được phát hành bởi người khác.' });
        return json(200, { message: 'Đã ghi nhận hoá đơn cho đơn TB-500.' });
      }
      if (url.includes('/admin/orders')) {
        ordersLoads += 1;
        if (ordersLoads > 1) await ordersGate;
        return json(200, { data: [] });
      }
      return json(200, {});
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = async () => {
  mounted = render(<Harness />);
  await flush();
  return mounted.container;
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const tap = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};
const btn = (c: HTMLElement) => byText(c, 'button', /^Đã xuất hoá đơn$|^Đang ghi nhận…$/) as HTMLButtonElement;
const issue = async (c: HTMLElement) => {
  click(btn(c));
  await flush(1);
  answerConfirm(true);
  await flush(4);
};

describe('OrderInvoicePanel: Đã xuất hoá đơn giữ khoá', () => {
  it('lệnh còn bay: nút aria-busy/aria-disabled (không disabled), ô link chỉ readOnly, chạm lại không mở hộp hỏi, đúng một POST', async () => {
    const c = await mount();
    const post = gate();
    postGate = post.promise;
    await issue(c);
    expect(posts).toHaveLength(1);
    expect(btn(c).getAttribute('aria-busy')).toBe('true');
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    expect(btn(c).disabled).toBe(false);
    const input = c.querySelector<HTMLInputElement>('input[type="url"]')!;
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);
    await tap(btn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(posts).toHaveLength(1);
    post.resolve();
    await flush();
  });

  it('xong mà đơn chưa làm mới về: chạm lại không mở hộp hỏi, đúng một POST; về rồi mới nhả', async () => {
    const c = await mount();
    const list = gate();
    ordersGate = list.promise;
    await issue(c);
    expect(posts).toHaveLength(1);
    expect(ordersLoads).toBe(2);
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    await tap(btn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(posts).toHaveLength(1);
    list.resolve();
    await flush();
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('đơn không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    const c = await mount();
    useHangTimers();
    ordersGate = new Promise<void>(() => {});
    await issue(c);
    await advance(3_500);
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    await advance(700);
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it.each([400, 409])('bị từ chối %i (người khác vừa xuất): lỗi hiện nguyên văn, đơn tải lại, khoá giữ tới khi đơn về', async (status) => {
    postStatus = status;
    const c = await mount();
    const list = gate();
    ordersGate = list.promise;
    await issue(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('vừa được phát hành bởi người khác');
    expect(ordersLoads).toBe(2);
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });

  const LINK = 'https://hoadon.abc.vn/TB-500';
  const typeLink = (c: HTMLElement) => typeInto(c.querySelector('input[type="url"]'), LINK);

  it('có gõ link, máy chủ từ chối 400 (link không được chấp nhận): lỗi hiện tại form, KHÔNG tải lại đơn, nhả khoá ngay, link còn để sửa', async () => {
    postStatus = 400;
    const c = await mount();
    typeLink(c);
    const list = gate();
    ordersGate = list.promise;
    await issue(c);
    expect(posts).toHaveLength(1);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('vừa được phát hành bởi người khác');
    expect(ordersLoads).toBe(1);
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
    const input = c.querySelector<HTMLInputElement>('input[type="url"]')!;
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe(LINK);
    list.resolve();
    await flush();
  });

  it.each([404, 409])('có gõ link, bị từ chối %i (đơn đã đổi): đơn tải lại, khoá giữ tới khi đơn về', async (status) => {
    postStatus = status;
    const c = await mount();
    typeLink(c);
    const list = gate();
    ordersGate = list.promise;
    await issue(c);
    expect(ordersLoads).toBe(2);
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it.each([500, 403])('lỗi %i: hiện lỗi, lệnh không tự tải lại đơn (QueryClient trần, không có MutationCache như production), nhả khoá ngay', async (status) => {
    postStatus = status;
    const c = await mount();
    await issue(c);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(ordersLoads).toBe(1);
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });
});
