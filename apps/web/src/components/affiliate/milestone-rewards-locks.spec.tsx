// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { CtvMilestoneItem, CtvMilestonesResponse } from '@tubutree/app-core/api/affiliate';
import { act } from 'react';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// Khoá nhận thưởng mốc CTV giữ tới khi danh sách mốc và Điểm Xanh tải lại xong, có hạn 4 giây (Mini ↔ web, Wave 96A ↔ Wave 88B).
// `invalidateQueries` được giả theo từng khoá truy vấn để dựng đúng khoảnh khắc "đã nhận nhưng dữ liệu mới chưa về".

const state = vi.hoisted(() => ({
  claims: [] as { path: string; body: unknown }[],
  handler: (async () => ({ success: true, message: 'ok', rewardPoints: 1, monthKey: 'x' })) as (path: string) => Promise<unknown>,
}));

vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    post: async (path: string, body: unknown) => {
      state.claims.push({ path, body });
      return state.handler(path);
    },
  },
}));

import { MilestoneRewards } from './milestone-rewards';

const OK = { success: true, message: 'ok', rewardPoints: 1, monthKey: 'x' };
const MILESTONES = '["affiliate-milestones"]';
const LOYALTY = '["loyalty"]';
const ME = '["me"]';

const m = (id: string, over: Partial<CtvMilestoneItem> = {}): CtvMilestoneItem => ({
  id, title: `Mốc ${id}`, threshold: 1_000_000, rewardPoints: 50, description: `Doanh số ${id}`,
  achieved: false, claimed: false, canClaim: false, progressPct: 40, ...over,
});
const claimable = (id: string, pts = 50) => m(id, { achieved: true, canClaim: true, progressPct: 100, rewardPoints: pts });
const data = (over: Partial<CtvMilestonesResponse> = {}): CtvMilestonesResponse => ({
  monthKey: '2026-10', currentRevenue: 4_000_000, pendingRevenue: 0, holdDays: 20,
  milestones: [m('A', { claimed: true, achieved: true, progressPct: 100 }), claimable('B', 200), m('C', { threshold: 5_000_000 })],
  previousMonth: null, ...over,
});
const two = () =>
  data({
    milestones: [claimable('B', 200), claimable('C', 50)],
    previousMonth: { monthKey: '2026-09', revenue: 3_000_000, milestones: [claimable('P1', 100)] },
  });

const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const never = () => new Promise<never>(() => undefined);

let mounted: Rendered | null = null;
let inv: MockInstance<QueryClient['invalidateQueries']>;
/** Khoá truy vấn (JSON) → hàm dựng lời hứa mà `invalidateQueries` trả (dựng lúc được gọi, kẻo lời hứa từ chối đứng không ai bắt); khoá không có trong bảng xong ngay. */
let holds = new Map<string, () => Promise<unknown>>();

beforeEach(() => {
  state.claims = [];
  state.handler = async () => OK;
  holds = new Map();
  inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockImplementation((filters) => {
    const key = JSON.stringify((filters as { queryKey: unknown }).queryKey);
    return (holds.get(key)?.() ?? Promise.resolve()) as Promise<void>;
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  inv.mockRestore();
  vi.useRealTimers();
});

const mount = (d: CtvMilestonesResponse) => (mounted = render(<MilestoneRewards data={d} />));
const btn = (re: RegExp) => Array.from(mounted!.container.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''))!;
const rowBtns = () => Array.from(mounted!.container.querySelectorAll('button')).filter((b) => b.textContent === 'Nhận thưởng');
const claims = () => state.claims.length;
const isBusy = (b: HTMLElement) => b.getAttribute('aria-busy') === 'true';
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
/** Hai cú chạm sát nhau trong cùng một lần act, tức trước khi React vẽ lại. */
const tapTogether = (...els: HTMLElement[]) =>
  act(async () => {
    for (const e of els) e.click();
  });

describe('Nhận thưởng một mốc: khoá giữ tới khi danh sách mốc và Điểm Xanh về', () => {
  it('đã nhận mà dữ liệu chưa về: nút báo bận (aria-busy/aria-disabled, không disabled), chạm đúp không gọi lần hai; về đủ mới nhả và nhận lại được', async () => {
    const milestones = gate();
    const loyalty = gate();
    holds.set(MILESTONES, () => milestones.promise);
    holds.set(LOYALTY, () => loyalty.promise);
    mount(data());
    const b = rowBtns()[0]!;
    click(b);
    await flush();
    expect(claims()).toBe(1);
    expect(isBusy(b)).toBe(true);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await tapTogether(b, b);
    await flush();
    expect(claims()).toBe(1);

    milestones.resolve();
    loyalty.resolve();
    await flush();
    expect(isBusy(b)).toBe(false);
    click(b);
    await flush();
    expect(claims()).toBe(2);
  });

  it.each([
    ['danh sách mốc về trước, Điểm Xanh chưa về', MILESTONES, LOYALTY],
    ['Điểm Xanh về trước, danh sách mốc chưa về', LOYALTY, MILESTONES],
  ])('%s: vẫn giữ khoá, đủ cả hai mới nhả', async (_name, firstKey, secondKey) => {
    const first = gate();
    const second = gate();
    holds.set(firstKey, () => first.promise);
    holds.set(secondKey, () => second.promise);
    mount(data());
    const b = rowBtns()[0]!;
    click(b);
    await flush();
    first.resolve();
    await flush();
    expect(isBusy(b)).toBe(true);
    click(b);
    await flush();
    expect(claims()).toBe(1);
    second.resolve();
    await flush();
    expect(isBusy(b)).toBe(false);
  });

  it('các số dư khác (me, ví, lịch sử) tải lại nền, không giữ khoá', async () => {
    holds.set(ME, never);
    mount(data());
    const b = rowBtns()[0]!;
    click(b);
    await flush();
    expect(inv.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))).toContain(ME);
    expect(isBusy(b)).toBe(false);
    click(b);
    await flush();
    expect(claims()).toBe(2);
  });

  it('nhận lỗi (đã nhận ở máy khác): hiện lỗi, giữ khoá tới khi danh sách mốc về rồi mới cho nhận lại', async () => {
    state.handler = async () => {
      throw new Error('Bạn đã nhận thưởng mốc này rồi.');
    };
    const milestones = gate();
    holds.set(MILESTONES, () => milestones.promise);
    const { container } = mount(data());
    const b = rowBtns()[0]!;
    click(b);
    await flush();
    expect(container.textContent).toContain('Bạn đã nhận thưởng mốc này rồi.');
    expect(isBusy(b)).toBe(true);
    click(b);
    await flush();
    expect(claims()).toBe(1);
    milestones.resolve();
    await flush();
    expect(isBusy(b)).toBe(false);
    click(b);
    await flush();
    expect(claims()).toBe(2);
  });

  it('dữ liệu mới không về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây và nhận lại được', async () => {
    useHangTimers();
    holds.set(MILESTONES, never);
    holds.set(LOYALTY, never);
    mount(data());
    const b = rowBtns()[0]!;
    click(b);
    await advance(3_500);
    expect(claims()).toBe(1);
    expect(isBusy(b)).toBe(true);
    await tapTogether(b);
    expect(claims()).toBe(1);
    await advance(1_000);
    await flush();
    expect(isBusy(b)).toBe(false);
    click(b);
    await flush();
    expect(claims()).toBe(2);
  });

  it('nhận lỗi mà danh sách mốc không về: cũng nhả sau hạn 4 giây', async () => {
    useHangTimers();
    state.handler = async () => {
      throw new Error('Chưa đạt');
    };
    holds.set(MILESTONES, never);
    mount(data());
    const b = rowBtns()[0]!;
    click(b);
    await advance(3_500);
    expect(isBusy(b)).toBe(true);
    await advance(1_000);
    await flush();
    expect(isBusy(b)).toBe(false);
  });

  it('dòng đang nhận không bị disabled (giữ focus), các dòng khác thì disabled', async () => {
    state.handler = never;
    mount(data({ milestones: [claimable('B'), claimable('C')] }));
    const [first, second] = rowBtns() as [HTMLButtonElement, HTMLButtonElement];
    click(first);
    await flush();
    expect(isBusy(first)).toBe(true);
    expect(first.disabled).toBe(false);
    expect(second.disabled).toBe(true);
    expect(isBusy(second)).toBe(false);
  });
});

describe('Nhận tất cả: khoá giữ tới khi danh sách mốc và Điểm Xanh về', () => {
  it('xong cả lượt mà dữ liệu chưa về: mọi nút giữ khoá, chạm tiếp không gọi API; về đủ mới nhả', async () => {
    const milestones = gate();
    const loyalty = gate();
    holds.set(MILESTONES, () => milestones.promise);
    holds.set(LOYALTY, () => loyalty.promise);
    const { container } = mount(two());
    const all = btn(/Nhận tất cả/);
    click(all);
    await flush();
    expect(claims()).toBe(3);
    expect(container.textContent).toContain('Đã nhận 3 mốc thưởng.');
    expect(isBusy(all)).toBe(true);
    expect(all.getAttribute('aria-disabled')).toBe('true');
    await tapTogether(all, ...rowBtns());
    await flush();
    expect(claims()).toBe(3);

    milestones.resolve();
    await flush();
    expect(isBusy(all)).toBe(true);
    loyalty.resolve();
    await flush();
    expect(isBusy(all)).toBe(false);
    click(all);
    await flush();
    expect(claims()).toBe(6);
  });

  it('mọi mốc lỗi (không điểm nào đổi): chỉ chờ danh sách mốc, không chờ Điểm Xanh', async () => {
    state.handler = async () => {
      throw new Error('Lỗi mạng');
    };
    const milestones = gate();
    holds.set(MILESTONES, () => milestones.promise);
    holds.set(LOYALTY, never);
    mount(two());
    const all = btn(/Nhận tất cả/);
    click(all);
    await flush();
    expect(isBusy(all)).toBe(true);
    milestones.resolve();
    await flush();
    expect(isBusy(all)).toBe(false);
  });

  it('một phần thành công (có điểm đổi): chờ cả Điểm Xanh', async () => {
    let n = 0;
    state.handler = async () => {
      if (n++ === 1) throw new Error('Đã nhận rồi');
      return OK;
    };
    const loyalty = gate();
    holds.set(LOYALTY, () => loyalty.promise);
    mount(two());
    const all = btn(/Nhận tất cả/);
    click(all);
    await flush();
    expect(isBusy(all)).toBe(true);
    loyalty.resolve();
    await flush();
    expect(isBusy(all)).toBe(false);
  });

  it('dữ liệu mới không về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây và nhận lại được', async () => {
    useHangTimers();
    holds.set(MILESTONES, never);
    holds.set(LOYALTY, never);
    mount(two());
    const all = btn(/Nhận tất cả/);
    click(all);
    await advance(3_500);
    expect(claims()).toBe(3);
    await tapTogether(all);
    expect(claims()).toBe(3);
    await advance(1_000);
    await flush();
    expect(isBusy(all)).toBe(false);
    click(all);
    await flush();
    expect(claims()).toBe(6);
  });

  it('nhận một mốc xong mà dữ liệu chưa về: "Nhận tất cả" cũng giữ khoá (không bấm xen được)', async () => {
    holds.set(MILESTONES, never);
    holds.set(LOYALTY, never);
    mount(two());
    click(rowBtns()[0]!);
    await flush();
    expect(claims()).toBe(1);
    const all = btn(/Nhận tất cả/);
    expect(all.disabled).toBe(true);
    await tapTogether(all);
    expect(claims()).toBe(1);
  });
});

describe('làm mới hỏng không để lọt unhandled rejection', () => {
  it('tải lại danh sách mốc và Điểm Xanh đều bị từ chối: khoá vẫn nhả, không có unhandled rejection', async () => {
    holds.set(MILESTONES, () => Promise.reject(new Error('mất mạng')));
    holds.set(LOYALTY, () => Promise.reject(new Error('mất mạng')));
    mount(data());
    const b = rowBtns()[0]!;
    const seen = await captureUnhandledRejections(async () => {
      click(b);
      await flush();
    });
    expect(seen).toEqual([]);
    expect(isBusy(b)).toBe(false);
    click(b);
    await flush();
    expect(claims()).toBe(2);
  });
});

describe('số dùng tabular-nums', () => {
  it('điểm thưởng và chữ doanh số của từng mốc, đầu thẻ, dòng chờ chốt, nút Nhận tất cả và câu kết quả', async () => {
    const { container } = mount(
      data({ milestones: [claimable('B', 200), claimable('C', 50)], pendingRevenue: 750_000 }),
    );
    const id = (t: string) => container.querySelector(`[data-testid="${t}"]`)!;
    expect(id('milestone-meta').className).toContain('tabular-nums');
    expect(id('milestone-row-meta').className).toContain('tabular-nums');
    const points = Array.from(container.querySelectorAll('span')).find((s) => s.textContent === '+200 điểm')!;
    expect(points.className).toContain('tabular-nums');
    const pending = Array.from(container.querySelectorAll('p')).find((p) => p.textContent?.includes('Đang chờ chốt'))!;
    expect(pending.className).toContain('tabular-nums');
    const all = btn(/Nhận tất cả/);
    expect(all.className).toContain('tabular-nums');
    click(all);
    await flush();
    const notice = Array.from(container.querySelectorAll('p')).find((p) => p.textContent === 'Đã nhận 2 mốc thưởng.')!;
    expect(notice.className).toContain('tabular-nums');
  });
});
