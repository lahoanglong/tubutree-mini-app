// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { dealerMeQuery } from '@tubutree/app-core/queries/dealer';
import { ApiError } from '@/lib/client-api';
import { coreHttp } from '@/lib/core-http';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// Khoá nút Đại lý giữ tới khi dữ liệu làm mới về, CÓ HẠN 4 giây (chỉ web: Mini chỉ gọi `void invalidateQueries` nên không giữ khoá): làm mới treo thì nút nhả sau hạn thay vì kẹt tới khi
// yêu cầu hết thời gian. Mỗi ca: lệnh ghi xong ngay, lần làm mới treo; còn khoá ở 3,5 giây (chạm thêm không gửi lệnh), nhả sau 4 giây và gửi lại được.

const h = vi.hoisted(() => ({
  hang: new Set<string>(),
  gets: [] as string[],
  data: {} as Record<string, unknown>,
  post: vi.fn(),
  del: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: (path: string) => {
      h.gets.push(path);
      if (h.hang.has(path)) return new Promise(() => undefined);
      return Promise.resolve(h.data[path]);
    },
    post: (path: string, body?: unknown) => h.post(path, body),
    delete: (path: string) => h.del(path),
  },
}));

import { CreditTab } from './credit-tab';
import { PriceTab } from './price-tab';
import { RewardsCard } from './rewards-card';

const REWARD = {
  id: 'r1', title: 'Tour Đà Lạt', description: null, type: 'TOUR', threshold: 100_000_000, period: 'QUARTER', periodKey: '2026-Q4', periodLabel: 'Quý 4/2026',
  isCurrentPeriod: true, volume: 120_000_000, pendingVolume: 0, achieved: true, toGo: 0, claimStatus: null, claimId: null, rejectionReason: null,
  claimDeadline: '2027-01-30T00:00:00.000Z', canClaim: true,
};
const ROW = { variationId: 'v1', sku: 'S1', product: 'Phân A', brand: 'Tubu', variation: '1kg', retailPrice: 100_000, dealerPrice: 80_000, discountPct: 20, stock: 9 };
const TEMPLATE = { id: 't1', name: 'Đơn tháng', items: [{ variationId: 'v1', quantity: 2 }] };

let mounted: Rendered | null = null;
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const mount = async (ui: React.ReactElement) => {
  mounted = render(ui);
  await flush(6);
  return mounted.container;
};
const isBusy = (b: HTMLElement) => b.getAttribute('aria-busy') === 'true';
const posts = (path: string) => h.post.mock.calls.filter((c) => c[0] === path).length;

/** Giữ `/dealer/me` đang được theo dõi (như trung tâm đại lý thật), để lượt làm mới của các khoá 'dealer-me' có chỗ treo. */
function MeProbe() {
  useQuery(dealerMeQuery(coreHttp));
  return null;
}

beforeEach(() => {
  h.hang = new Set();
  h.gets = [];
  h.data = {
    '/dealer/rewards': { quarter: '2026-Q4', year: 2026, quarterVolume: 0, yearVolume: 0, quarterPendingVolume: 0, yearPendingVolume: 0, claimGraceDays: 30, rewards: [REWARD] },
    '/dealer/credit-ledger': { balance: 500_000, entries: [] },
    '/dealer/pricelist': [ROW],
    '/dealer/templates': [TEMPLATE],
    '/dealer/me': { isDealer: true, status: 'APPROVED', tier: null, currentDebt: 0 },
  };
  h.post.mockReset().mockResolvedValue({ ok: true });
  h.del.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('Phần thưởng đại lý: yêu cầu bị từ chối mà làm mới không về', () => {
  it('lời lỗi hiện ngay; còn khoá ở 3,5 giây, nhả sau 4 giây và gửi lại được', async () => {
    useHangTimers();
    h.post.mockRejectedValue(new ApiError('Đã hết hạn gửi yêu cầu.', 400));
    const c = await mount(<RewardsCard />);
    const claim = byText(c, 'button', 'Yêu cầu nhận thưởng') as HTMLButtonElement;
    h.hang.add('/dealer/rewards');
    click(claim);
    await flush(4);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Đã hết hạn gửi yêu cầu.');
    expect(isBusy(claim)).toBe(true);
    await advance(3_500);
    expect(isBusy(claim)).toBe(true);
    click(claim);
    await flush(2);
    expect(posts('/dealer/rewards/r1/claim')).toBe(1);
    await advance(1_000);
    await flush(2);
    expect(isBusy(claim)).toBe(false);
    click(claim);
    await flush(2);
    expect(posts('/dealer/rewards/r1/claim')).toBe(2);
  });
});

describe('Công nợ: báo đã chuyển khoản mà làm mới không về', () => {
  it('còn khoá ở 3,5 giây (nhập số khác rồi chạm cũng không gửi), nhả sau 4 giây và gửi lại được', async () => {
    useHangTimers();
    const c = await mount(<CreditTab />);
    const amount = c.querySelector<HTMLInputElement>('input[type="number"]')!;
    const pay = byText(c, 'button', 'Báo đã chuyển khoản') as HTMLButtonElement;
    typeInto(amount, '100000');
    h.hang.add('/dealer/credit-ledger');
    click(pay);
    await flush(4);
    expect(posts('/dealer/credit-payment')).toBe(1);
    expect(isBusy(pay)).toBe(true);
    await advance(3_500);
    expect(isBusy(pay)).toBe(true);
    typeInto(amount, '50000');
    click(pay);
    await flush(2);
    expect(posts('/dealer/credit-payment')).toBe(1);
    await advance(1_000);
    await flush(2);
    expect(isBusy(pay)).toBe(false);
    click(pay);
    await flush(2);
    expect(posts('/dealer/credit-payment')).toBe(2);
  });
});

describe('Bảng giá đại lý: lệnh ghi xong mà làm mới không về', () => {
  const tapAdd = async (c: HTMLElement) => {
    click(c.querySelector('[aria-label^="Tăng số lượng"]'));
    await flush(2);
  };

  it('xoá mẫu đơn: còn khoá ở 3,5 giây, nhả sau 4 giây và xoá lại được', async () => {
    useHangTimers();
    const c = await mount(<PriceTab creditLimit={50_000_000} debt={0} />);
    const del = c.querySelector<HTMLButtonElement>('[aria-label="Xoá mẫu đơn"]')!;
    h.hang.add('/dealer/templates');
    click(del);
    await flush(4);
    expect(h.del).toHaveBeenCalledTimes(1);
    expect(isBusy(del)).toBe(true);
    await advance(3_500);
    expect(isBusy(del)).toBe(true);
    click(del);
    await flush(2);
    expect(h.del).toHaveBeenCalledTimes(1);
    await advance(1_000);
    await flush(2);
    expect(isBusy(del)).toBe(false);
    click(del);
    await flush(2);
    expect(h.del).toHaveBeenCalledTimes(2);
  });

  const placeButtons = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Trả trước');
  const mountWithMe = () =>
    mount(
      <>
        <MeProbe />
        <PriceTab creditLimit={50_000_000} debt={0} />
      </>,
    );

  it('đặt đơn xong (giỏ trống đi): thêm hàng lại thì nút vẫn bận ở 3,5 giây, nhả sau 4 giây', async () => {
    useHangTimers();
    h.post.mockResolvedValue({ code: 'TUBU1', status: 'CONFIRMED', paymentMethod: 'CREDIT', items: [{ variationId: 'v1', quantity: 1, backorderedQty: 0 }] });
    const c = await mountWithMe();
    await tapAdd(c);
    h.hang.add('/dealer/me');
    click(placeButtons(c)[0]!);
    await flush(4);
    expect(posts('/dealer/orders')).toBe(1);
    await tapAdd(c);
    expect(placeButtons(c).length).toBeGreaterThan(0);
    await advance(3_500);
    expect(placeButtons(c).every(isBusy)).toBe(true);
    click(placeButtons(c)[0]!);
    await flush(2);
    expect(posts('/dealer/orders')).toBe(1);
    await advance(1_000);
    await flush(2);
    expect(placeButtons(c).length).toBeGreaterThan(0);
    expect(placeButtons(c).some(isBusy)).toBe(false);
  });

  it('máy chủ trả đơn của lần đặt trước (giỏ giữ nguyên): nút còn bận ở 3,5 giây, nhả sau 4 giây', async () => {
    useHangTimers();
    h.post.mockResolvedValue({ code: 'TUBU2', status: 'CONFIRMED', paymentMethod: 'CREDIT', items: [{ variationId: 'v9', quantity: 1, backorderedQty: 0 }] });
    const c = await mountWithMe();
    await tapAdd(c);
    h.hang.add('/dealer/me');
    click(placeButtons(c)[0]!);
    await flush(4);
    expect(posts('/dealer/orders')).toBe(1);
    expect(placeButtons(c).every(isBusy)).toBe(true);
    await advance(3_500);
    expect(placeButtons(c).every(isBusy)).toBe(true);
    click(placeButtons(c)[0]!);
    await flush(2);
    expect(posts('/dealer/orders')).toBe(1);
    await advance(1_000);
    await flush(2);
    expect(placeButtons(c).some(isBusy)).toBe(false);
    click(placeButtons(c)[0]!);
    await flush(2);
    expect(posts('/dealer/orders')).toBe(2);
  });

  it('lưu mẫu đơn: mở lại hộp Lưu mẫu thì nút còn bận ở 3,5 giây, nhả sau 4 giây', async () => {
    useHangTimers();
    const c = await mount(<PriceTab creditLimit={50_000_000} debt={0} />);
    await tapAdd(c);
    const openSheet = () => click(byText(c, 'button', 'Lưu mẫu'));
    openSheet();
    await flush(2);
    typeInto(document.querySelector('[aria-label="Tên mẫu"]'), 'Đơn mới');
    h.hang.add('/dealer/templates');
    const footerBtn = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) => /^(Lưu mẫu|Đang lưu…)$/.test(b.textContent ?? ''))!;
    click(footerBtn());
    await flush(4);
    expect(posts('/dealer/templates')).toBe(1);
    await advance(3_500);
    openSheet();
    await flush(2);
    expect(isBusy(footerBtn())).toBe(true);
    await advance(1_000);
    await flush(2);
    expect(isBusy(footerBtn())).toBe(false);
  });
});
