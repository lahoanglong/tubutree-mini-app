// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DealerTiersSection } from './dealer-tiers-section';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// W96B: "Lưu bậc" (chiết khấu, hạn mức công nợ của đại lý) giữ khoá tới khi danh sách bậc làm mới về (tối đa 4 giây) để nút "Sửa" không mở form với giá trị
// cũ, nút báo bận bằng aria-busy/aria-disabled (không disabled), và khi người khác vừa sửa (409) thì đợi danh sách tải lại rồi mới nhả.

const TIER = { id: 'DEALER_2', name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, creditLimit: 5_000_000, paymentTerms: 'NET 15', dealerCount: 2 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let tierLoads = 0;
let tierGate: Promise<void> | undefined;
let putGate: Promise<void> | undefined;
let putStatus = 200;
const puts: string[] = [];
const posts: string[] = [];

let mounted: Rendered | null = null;
beforeEach(() => {
  tierLoads = 0;
  tierGate = undefined;
  putGate = undefined;
  putStatus = 200;
  puts.length = 0;
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(url);
        await putGate;
        if (putStatus !== 200) return json(putStatus, { statusCode: putStatus, message: 'Bậc này vừa được sửa.' });
        return json(200, { id: 'DEALER_2' });
      }
      if (init?.method === 'POST') {
        posts.push(url);
        await putGate;
        return json(200, { id: 'DEALER_9' });
      }
      if (url.includes('/admin/dealer-tiers/manage')) {
        tierLoads += 1;
        if (tierLoads > 1) await tierGate;
        return json(200, { tiers: [TIER], maxDiscountPct: 45, dealersWithoutTier: 0 });
      }
      return json(200, []);
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
  mounted = render(<DealerTiersSection />);
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
const editBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-label="Sửa bậc Đại lý Cấp 2"]')!;
const field = (c: HTMLElement, label: string) => c.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
const saveBtn = (c: HTMLElement) => byText(c, 'button', /^Lưu bậc$|^Đang lưu…$/) as HTMLButtonElement;
const save = async (c: HTMLElement) => {
  click(editBtn(c));
  await flush();
  typeInto(field(c, 'Chiết khấu (%)'), '35');
  click(saveBtn(c));
  await flush(1);
  answerConfirm(true);
  await flush(4);
};

describe('DealerTiersSection: Lưu bậc giữ khoá', () => {
  it('lệnh còn bay: "Lưu bậc" aria-busy/aria-disabled (không disabled), "Huỷ" aria-disabled không disabled, chạm lại không hỏi lần hai, đúng một PUT', async () => {
    const c = await mount();
    const put = gate();
    putGate = put.promise;
    await save(c);
    expect(puts).toHaveLength(1);
    expect(saveBtn(c).getAttribute('aria-busy')).toBe('true');
    expect(saveBtn(c).getAttribute('aria-disabled')).toBe('true');
    expect(saveBtn(c).disabled).toBe(false);
    const cancel = byText(c, 'button', /^Huỷ$/) as HTMLButtonElement;
    expect(cancel.getAttribute('aria-disabled')).toBe('true');
    expect(cancel.disabled).toBe(false);
    await tap(cancel);
    await flush(2);
    expect(c.querySelector('form')).not.toBeNull();
    await tap(saveBtn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(puts).toHaveLength(1);
    put.resolve();
    await flush();
  });

  it('lưu xong mà danh sách bậc chưa về: "Sửa" aria-disabled và chạm vào không mở form với giá trị cũ; về rồi mới mở được', async () => {
    const c = await mount();
    const list = gate();
    tierGate = list.promise;
    await save(c);
    expect(puts).toHaveLength(1);
    expect(c.querySelector('form')).toBeNull();
    expect(editBtn(c).getAttribute('aria-disabled')).toBe('true');
    await tap(editBtn(c));
    await flush(2);
    expect(c.querySelector('form')).toBeNull();
    list.resolve();
    await flush();
    expect(editBtn(c).getAttribute('aria-disabled')).toBeNull();
    click(editBtn(c));
    await flush();
    expect(c.querySelector('form')).not.toBeNull();
  });

  it('danh sách bậc không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    const c = await mount();
    useHangTimers();
    tierGate = new Promise<void>(() => {});
    await save(c);
    await advance(3_500);
    expect(editBtn(c).getAttribute('aria-disabled')).toBe('true');
    await advance(700);
    expect(editBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('người khác vừa sửa (409): báo "tải lại", form giữ nguyên, khoá giữ tới khi danh sách bậc tải lại xong', async () => {
    putStatus = 409;
    const c = await mount();
    const list = gate();
    tierGate = list.promise;
    await save(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('vừa được người khác sửa');
    expect(tierLoads).toBe(2);
    expect(saveBtn(c).getAttribute('aria-disabled')).toBe('true');
    await tap(saveBtn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(puts).toHaveLength(1);
    list.resolve();
    await flush();
    expect(saveBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('lỗi 500: hiện lỗi, form giữ nguyên, nhả khoá ngay', async () => {
    putStatus = 500;
    const c = await mount();
    await save(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Bậc này vừa được sửa.');
    expect(saveBtn(c).getAttribute('aria-disabled')).toBeNull();
    expect(tierLoads).toBe(1);
  });
});

describe('DealerTiersSection: Tạo bậc (không có hộp xác nhận)', () => {
  it('hai lần gửi form cùng một khung hình: chỉ một POST tạo bậc', async () => {
    const c = await mount();
    click(byText(c, 'button', /^Thêm bậc$/));
    await flush();
    typeInto(field(c, 'Mã bậc'), 'DEALER_9');
    typeInto(field(c, 'Tên bậc'), 'Đại lý Cấp 9');
    typeInto(field(c, 'Doanh số tối thiểu (đ)'), '1000000');
    typeInto(field(c, 'Chiết khấu (%)'), '10');
    typeInto(field(c, 'Hạn mức công nợ (đ)'), '0');
    const b = saveBtn(c);
    await act(async () => {
      b.click();
      b.click();
    });
    await flush(3);
    expect(posts).toHaveLength(1);
  });
});
