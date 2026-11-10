// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommissionRatesTab } from './commission-rates-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { CommissionRatesPage } from '@/lib/commission-rates';

// W96B: ô "% hoa hồng" của một biến thể (TIỀN: hoa hồng CTV) khoá chạm đúp ngay cả khi hai cú chạm cùng một khung hình, giữ khoá tới khi danh sách tải lại
// xong (tối đa 4 giây). "Lưu" có ô nhập nên 400 là lỗi nhập liệu (hiện tại dòng, không tải lại, nhả khoá ngay); "Về mặc định" không có ô nhập nên 400/404/409 đều là dữ liệu cũ
// (tải lại, chờ ≤4 giây). Test dựng QueryClient trần, không có MutationCache như production (ở đó khoá admin-* vẫn bị làm cũ sau mỗi lệnh), nên "không tải lại" ở đây
// là lệnh không tự gọi và không chờ tải lại. Ô nhập đang bận không `disabled` để Enter không làm mất tiêu điểm.

const pageWith = (rate: number | null): CommissionRatesPage => ({
  items: [
    {
      id: 'p1',
      name: 'Nước rửa chén',
      thumbnail: null,
      brand: 'Tubu Tree',
      isActive: true,
      affiliateBlocked: false,
      approvalStatus: 'APPROVED',
      isPartner: false,
      variations: [{ id: 'v1', sku: 'NRC-500', name: '500ml', retailPrice: 100_000, salePrice: null, isActive: true, affiliateRate: rate, dealerPrices: null }],
    },
  ],
  nextCursor: null,
  maxRate: 50,
  defaultRate: 8,
  summary: { missing: 0, missingTubu: 0 },
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let listGate: Promise<void> | undefined;
let listLoads = 0;
let putStatus = 200;
let serverRate: number | null = 5;
const puts: unknown[] = [];

let mounted: Rendered | null = null;
beforeEach(() => {
  listGate = undefined;
  listLoads = 0;
  putStatus = 200;
  serverRate = 5;
  puts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/admin/dealer-tiers')) return json(200, []);
      if (url.includes('/admin/commission-rates/variations/') && init?.method === 'PUT') {
        puts.push(JSON.parse(String(init.body)));
        if (putStatus !== 200) return json(putStatus, { statusCode: putStatus, message: `Lỗi ${putStatus} từ máy chủ` });
        serverRate = (puts[puts.length - 1] as { rate: number | null }).rate;
        return json(200, { id: 'v1', sku: 'NRC-500', affiliateRate: serverRate });
      }
      if (url.includes('/admin/commission-rates?')) {
        listLoads += 1;
        if (listLoads > 1) await listGate;
        return json(200, pageWith(serverRate));
      }
      return json(500, { message: `no mock for ${url}` });
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
  mounted = render(<CommissionRatesTab />);
  await flush();
  return mounted.container;
};
const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="% hoa hồng NRC-500"]')!;
const row = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-commission-variation]')!;
const save = (c: HTMLElement) => byText(row(c), 'button', /^Lưu$|^Đang lưu/) as HTMLButtonElement;
const clear = (c: HTMLElement) => row(c).querySelector<HTMLButtonElement>('button[aria-label="Về mặc định NRC-500"]')!;
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

describe('Lưu %', () => {
  it('hai cú chạm cùng một khung hình: chỉ một lệnh PUT', async () => {
    const c = await mount();
    typeInto(input(c), '9');
    const b = save(c);
    await act(async () => {
      b.click();
      b.click();
    });
    await flush(3);
    expect(puts).toEqual([{ rate: 9 }]);
  });

  it('xong mà danh sách chưa về: "Về mặc định" còn aria-busy/aria-disabled (không disabled) tới khi danh sách về, rồi mới nhả', async () => {
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    typeInto(input(c), '9');
    click(save(c));
    await flush(4);
    expect(puts).toHaveLength(1);
    expect(listLoads).toBe(2);
    const b = clear(c);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    list.resolve();
    await flush();
    expect(clear(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount();
    listGate = new Promise<void>(() => {});
    typeInto(input(c), '9');
    click(save(c));
    await flush(4);
    await advance(3_500);
    expect(clear(c).getAttribute('aria-disabled')).toBe('true');
    await advance(600);
    expect(clear(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('bị từ chối vì dữ liệu đã đổi (409): lỗi hiện ngay, tải lại, chạm "Lưu" trong khoá không gửi lệnh thứ hai; về rồi mới nhả', async () => {
    putStatus = 409;
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    typeInto(input(c), '9');
    click(save(c));
    await flush(4);
    expect(listLoads).toBe(2);
    expect(row(c).textContent).toContain('Lỗi 409');
    const b = save(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    await tap(b);
    await flush(2);
    expect(puts).toHaveLength(1);
    list.resolve();
    await flush();
    expect(save(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('lỗi 400 (lỗi nhập liệu: % ngoài khoảng hoặc không nguyên): lỗi hiện ngay tại dòng, KHÔNG tải lại, nhả khoá ngay', async () => {
    putStatus = 400;
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    typeInto(input(c), '9');
    click(save(c));
    await flush(4);
    expect(puts).toEqual([{ rate: 9 }]);
    expect(listLoads).toBe(1);
    expect(row(c).textContent).toContain('Lỗi 400');
    expect(save(c).getAttribute('aria-disabled')).toBeNull();
    expect(save(c).getAttribute('aria-busy')).toBeNull();
    expect(input(c).readOnly).toBe(false);
    list.resolve();
    await flush();
  });

  it('lỗi 404 (biến thể không còn): tải lại, giữ khoá tới khi danh sách về', async () => {
    putStatus = 404;
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    typeInto(input(c), '9');
    click(save(c));
    await flush(4);
    expect(listLoads).toBe(2);
    expect(row(c).textContent).toContain('Lỗi 404');
    expect(save(c).getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(save(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('lỗi 500: hiện lỗi, lệnh không tự tải lại (QueryClient trần, không có MutationCache như production), nhả khoá ngay', async () => {
    putStatus = 500;
    const c = await mount();
    typeInto(input(c), '9');
    click(save(c));
    await flush(4);
    expect(listLoads).toBe(1);
    expect(row(c).textContent).toContain('Lỗi 500');
    expect(save(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('ô nhập đang bận không disabled (Enter không làm mất tiêu điểm), chỉ readOnly', async () => {
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    typeInto(input(c), '9');
    input(c).focus();
    await act(async () => {
      input(c).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush(4);
    expect(puts).toHaveLength(1);
    expect(input(c).disabled).toBe(false);
    expect(input(c).readOnly).toBe(true);
    list.resolve();
    await flush();
    expect(input(c).readOnly).toBe(false);
  });
});

describe('Về mặc định', () => {
  it('bị từ chối 409: nút aria-busy/aria-disabled (không disabled) tới khi danh sách về, chạm lại không mở hộp hỏi, chỉ một lệnh', async () => {
    putStatus = 409;
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    click(clear(c));
    await flush(1);
    answerConfirm(true);
    await flush(4);
    expect(puts).toEqual([{ rate: null }]);
    expect(listLoads).toBe(2);
    const b = clear(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await tap(b);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(puts).toHaveLength(1);
    list.resolve();
    await flush();
    expect(clear(c).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('Về mặc định: không có ô nhập nên 400 vẫn là dữ liệu cũ', () => {
  it('bị từ chối 400: tải lại danh sách, giữ khoá tới khi danh sách về', async () => {
    putStatus = 400;
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    click(clear(c));
    await flush(1);
    answerConfirm(true);
    await flush(4);
    expect(puts).toEqual([{ rate: null }]);
    expect(listLoads).toBe(2);
    expect(clear(c).getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(clear(c).getAttribute('aria-disabled')).toBeNull();
  });
});
