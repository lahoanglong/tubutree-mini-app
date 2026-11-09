// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { CtvMilestoneItem, CtvMilestonesResponse } from '@tubutree/app-core/api/affiliate';
import { act } from 'react';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

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

let mounted: Rendered | null = null;
const mount = (d: CtvMilestonesResponse) => (mounted = render(<MilestoneRewards data={d} />));
const btn = (re: RegExp) => Array.from(mounted!.container.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''))!;
const claimPaths = () => state.claims.map((c) => c.path);

beforeEach(() => {
  state.claims = [];
  state.handler = async () => ({ success: true, message: 'ok', rewardPoints: 1, monthKey: 'x' });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('MilestoneRewards — danh sách gọn', () => {
  it('mặc định chỉ hiện mốc nhận được và mốc kế tiếp; "Xem tất cả" mở đủ, "Thu gọn" gập lại', async () => {
    const { container } = mount(data());
    expect(container.textContent).toContain('Mốc B');
    expect(container.textContent).toContain('Mốc C');
    expect(container.textContent).not.toContain('Mốc A');
    click(btn(/^Xem tất cả 3 mốc$/));
    await flush();
    expect(container.textContent).toContain('Mốc A');
    click(btn(/^Thu gọn$/));
    await flush();
    expect(container.textContent).not.toContain('Mốc A');
  });

  it('mỗi mốc một dòng: thưởng bằng điểm, đã nhận có nhãn, đạt chưa nhận có nút, chưa đạt có chữ còn thiếu', async () => {
    const { container } = mount(data());
    click(btn(/^Xem tất cả 3 mốc$/));
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('+200 điểm');
    expect(text.match(/\+50 điểm/g)).toHaveLength(2);
    expect(text).toContain('Đã nhận');
    expect(btn(/^Nhận thưởng$/)).toBeTruthy();
    expect(text).toContain('Còn thiếu 1.000.000đ doanh số đã chốt');
    expect(text).toContain('Thưởng mốc doanh số tháng');
    expect(text).toContain('tháng 10/2026');
    expect(text).toContain('không gồm phí ship');
  });

  it('có doanh số đang chờ chốt: nói rõ chưa tính vào mốc', () => {
    expect(mount(data({ pendingRevenue: 750_000 })).container.textContent).toContain('Đang chờ chốt: 750.000đ');
  });

  it('một mốc nhận được: không có Nhận tất cả; nút trên dòng gọi đúng endpoint và tháng, rồi báo lời máy chủ', async () => {
    state.handler = async () => ({ success: true, message: 'Đã cộng 200 điểm', rewardPoints: 200, monthKey: '2026-10' });
    const { container } = mount(data());
    expect(btn(/Nhận tất cả/)).toBeUndefined();
    click(btn(/^Nhận thưởng$/));
    await flush();
    expect(state.claims).toEqual([{ path: '/affiliate/milestones/B/claim', body: { month: '2026-10' } }]);
    expect(container.textContent).toContain('Đã cộng 200 điểm');
  });

  it('thang chữ và nút theo Mini ở điện thoại: tên mốc dòng 22, chữ phụ 13px màu tertiary, nút Button của Mini (48px)', () => {
    const { container } = mount(data({ pendingRevenue: 750_000 }));
    const id = (t: string) => container.querySelector(`[data-testid="${t}"]`)!;
    for (const t of ['milestone-title', 'milestone-row-title']) expect(id(t).className).toContain('max-md:leading-[var(--type-body-sm-lh)]');
    for (const t of ['milestone-meta', 'milestone-note', 'milestone-row-meta']) {
      expect(id(t).className).toContain('max-md:text-[length:var(--type-caption-size)]');
      expect(id(t).className).toContain('text-[var(--color-text-tertiary)]');
      expect(id(t).className).not.toContain('text-stone-600');
    }
    const claim = btn(/^Nhận thưởng$/);
    expect(claim.className).toContain('zaui-btn');
    expect(claim.className).not.toContain('bg-forest-600');
  });

  it('nhận tất cả: nút Button của Mini toàn chiều rộng, loading báo aria-busy', async () => {
    state.handler = () => new Promise(() => {});
    mount(data({ milestones: [claimable('B'), claimable('C')] }));
    const all = btn(/Nhận tất cả/);
    expect(all.className).toContain('zaui-btn-full-width');
    click(all);
    await flush();
    expect(btn(/Nhận tất cả/).getAttribute('aria-busy')).toBe('true');
    // Như Mini: nút đang chạy vẽ vòng xoay chứ không xám đi (Button chỉ vẽ vòng xoay khi loading mà không disabled).
    expect(btn(/Nhận tất cả/).className).toContain('zaui-btn-loading');
  });

  it('không có mốc nào: không vẽ gì', () => {
    expect(mount(data({ milestones: [] })).container.innerHTML).toBe('');
  });

  it('còn thưởng tháng trước chưa nhận: có nhóm riêng, hạn nhận nói rõ', () => {
    const { container } = mount(data({ previousMonth: { monthKey: '2026-09', revenue: 3_000_000, milestones: [claimable('P1')] } }));
    expect(container.textContent).toContain('Thưởng tháng 9/2026 chưa nhận — nhận trước khi hết tháng 10/2026');
    expect(container.textContent).toContain('Mốc P1');
  });
});

describe('MilestoneRewards — Nhận tất cả', () => {
  const two = () =>
    data({
      milestones: [claimable('B', 200), claimable('C', 50)],
      previousMonth: { monthKey: '2026-09', revenue: 3_000_000, milestones: [claimable('P1', 100)] },
    });

  it('từ 2 mốc nhận được: nút ghi số mốc và tổng điểm', () => {
    mount(two());
    expect(btn(/Nhận tất cả/).textContent).toBe('Nhận tất cả (3 mốc, +350 điểm)');
  });

  it('gọi từng mốc tuần tự, tháng trước trước, mốc sau chỉ bắt đầu khi mốc trước xong', async () => {
    const releases: Array<() => void> = [];
    state.handler = () => new Promise((resolve) => releases.push(() => resolve({ success: true, message: 'ok' })));
    const { container } = mount(two());
    click(btn(/Nhận tất cả/));
    await flush();
    expect(claimPaths()).toEqual(['/affiliate/milestones/P1/claim']);
    expect(state.claims[0]!.body).toEqual({ month: '2026-09' });
    releases[0]!();
    await flush();
    expect(claimPaths()).toEqual(['/affiliate/milestones/P1/claim', '/affiliate/milestones/B/claim']);
    releases[1]!();
    await flush();
    expect(claimPaths()).toHaveLength(3);
    expect(state.claims[2]!.body).toEqual({ month: '2026-10' });
    releases[2]!();
    await flush();
    expect(container.textContent).toContain('Đã nhận 3 mốc thưởng.');
  });

  it('đang chạy: bấm thêm không gọi lần nữa', async () => {
    state.handler = () => new Promise(() => {});
    mount(two());
    const b = btn(/Nhận tất cả/);
    click(b);
    await flush();
    expect(b.getAttribute('aria-busy')).toBe('true');
    click(b);
    expect(claimPaths()).toHaveLength(1);
  });

  it('một mốc lỗi: các mốc còn lại vẫn nhận, lỗi báo đúng tên mốc và tháng', async () => {
    let n = 0;
    state.handler = async () => {
      if (n++ === 1) throw new Error('Mốc này đã nhận rồi');
      return { success: true, message: 'ok' };
    };
    const { container } = mount(two());
    click(btn(/Nhận tất cả/));
    await flush();
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe('Mốc B (tháng 10/2026): Mốc này đã nhận rồi');
    expect(claimPaths()).toHaveLength(3);
    expect(container.textContent).toContain('Đã nhận 2/3 mốc. Có 1 mốc chưa nhận được, xem bên dưới.');
  });

  it('mọi mốc lỗi: báo lỗi, không báo thành công', async () => {
    state.handler = async () => {
      throw new Error('Lỗi mạng');
    };
    const { container } = mount(two());
    click(btn(/Nhận tất cả/));
    await flush();
    expect(container.textContent).toContain('Chưa nhận được mốc nào. Xem lý do bên dưới.');
    expect(container.textContent).not.toContain('Đã nhận 3');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Mốc P1 (tháng 9/2026): Lỗi mạng');
  });

  it('cùng một mốc lỗi ở hai tháng: hai dòng riêng, mỗi dòng ghi đúng tháng', async () => {
    state.handler = async () => {
      throw new Error('Lỗi mạng');
    };
    const { container } = mount(
      data({ milestones: [claimable('B')], previousMonth: { monthKey: '2026-09', revenue: 1, milestones: [claimable('B')] } }),
    );
    click(btn(/Nhận tất cả/));
    await flush();
    const rows = Array.from(container.querySelector('[role="alert"]')!.children).map((c) => c.textContent);
    expect(rows).toEqual(['Mốc B (tháng 9/2026): Lỗi mạng', 'Mốc B (tháng 10/2026): Lỗi mạng']);
  });
});

const OK = { success: true, message: 'ok', rewardPoints: 1, monthKey: 'x' };
const neverSettles = () => new Promise<never>(() => {});
const twoMilestones = () =>
  data({
    milestones: [claimable('B', 200), claimable('C', 50)],
    previousMonth: { monthKey: '2026-09', revenue: 3_000_000, milestones: [claimable('P1', 100)] },
  });
const rowBtns = () => Array.from(mounted!.container.querySelectorAll('button')).filter((b) => b.textContent === 'Nhận thưởng');
const byId = (id: string) => mounted!.container.querySelector<HTMLElement>(`#${CSS.escape(id)}`);

describe('MilestoneRewards — aria-controls của nút Xem tất cả / Thu gọn', () => {
  it('nút trỏ tới đúng danh sách mốc tháng này, dù đang gập hay mở; nhóm tháng trước nằm ngoài danh sách', async () => {
    mount(data({ previousMonth: { monthKey: '2026-09', revenue: 3_000_000, milestones: [claimable('P1')] } }));
    const toggle = btn(/^Xem tất cả 3 mốc$/);
    const id = toggle.getAttribute('aria-controls')!;
    expect(id).toBeTruthy();
    const list = byId(id)!;
    expect(list).not.toBeNull();
    expect(list.tagName).toBe('UL');
    expect(list.textContent).toContain('Mốc B');
    expect(list.textContent).not.toContain('Mốc A');
    expect(list.textContent).not.toContain('Mốc P1');
    click(toggle);
    await flush();
    expect(btn(/^Thu gọn$/).getAttribute('aria-controls')).toBe(id);
    expect(byId(id)!.textContent).toContain('Mốc A');
  });

  it('hai thẻ cùng trang có id danh sách khác nhau (không trùng id)', () => {
    mounted = render(
      <>
        <MilestoneRewards data={data()} />
        <MilestoneRewards data={data()} />
      </>,
    );
    const ids = Array.from(mounted.container.querySelectorAll('button[aria-controls]')).map((b) => b.getAttribute('aria-controls'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('MilestoneRewards — khoá nhận thưởng đồng bộ', () => {
  it('hai cú bấm sát nhau vào cùng "Nhận thưởng" trước khi vẽ lại: chỉ gọi API một lần', async () => {
    state.handler = neverSettles;
    mount(data());
    const b = rowBtns()[0]!;
    await act(async () => {
      click(b);
      click(b);
    });
    expect(claimPaths()).toEqual(['/affiliate/milestones/B/claim']);
  });

  it('hai cú bấm sát nhau vào "Nhận tất cả": chỉ một lượt (mốc đầu chỉ gọi một lần)', async () => {
    state.handler = neverSettles;
    mount(twoMilestones());
    const all = btn(/Nhận tất cả/);
    await act(async () => {
      click(all);
      click(all);
    });
    expect(claimPaths()).toEqual(['/affiliate/milestones/P1/claim']);
  });

  it('"Nhận thưởng" rồi "Nhận tất cả" cùng một nhịp: chỉ lượt đầu chạy', async () => {
    state.handler = neverSettles;
    mount(twoMilestones());
    const row = rowBtns().at(-1)!;
    const all = btn(/Nhận tất cả/);
    await act(async () => {
      click(row);
      click(all);
    });
    expect(claimPaths()).toEqual(['/affiliate/milestones/C/claim']);
  });

  it('"Nhận tất cả" rồi "Nhận thưởng" cùng một nhịp: chỉ lượt đầu chạy', async () => {
    state.handler = neverSettles;
    mount(twoMilestones());
    const row = rowBtns().at(-1)!;
    const all = btn(/Nhận tất cả/);
    await act(async () => {
      click(all);
      click(row);
    });
    expect(claimPaths()).toEqual(['/affiliate/milestones/P1/claim']);
  });

  it('nhận xong (thành công) thì nhận tiếp được: khoá nhả khi mutation kết thúc', async () => {
    state.handler = async () => OK;
    mount(data());
    click(rowBtns()[0]!);
    await flush();
    click(rowBtns()[0]!);
    await flush();
    expect(claimPaths()).toHaveLength(2);
  });

  it('nhận lỗi thì nhận lại được: khoá nhả cả khi mutation lỗi', async () => {
    state.handler = async () => {
      throw new Error('Mạng chập chờn');
    };
    mount(data());
    click(rowBtns()[0]!);
    await flush();
    click(rowBtns()[0]!);
    await flush();
    expect(claimPaths()).toHaveLength(2);
  });

  it('Nhận tất cả xong thì nhận lại được: khoá nhả khi cả lượt kết thúc', async () => {
    state.handler = async () => OK;
    mount(twoMilestones());
    click(btn(/Nhận tất cả/));
    await flush();
    expect(claimPaths()).toHaveLength(3);
    click(btn(/Nhận tất cả/));
    await flush();
    expect(claimPaths()).toHaveLength(6);
  });

  it('Nhận tất cả với mọi mốc lỗi vẫn nhả khoá để thử lại', async () => {
    state.handler = async () => {
      throw new Error('Lỗi mạng');
    };
    mount(twoMilestones());
    click(btn(/Nhận tất cả/));
    await flush();
    click(btn(/Nhận tất cả/));
    await flush();
    expect(claimPaths()).toHaveLength(6);
  });
});

describe('MilestoneRewards — làm mới sau khi nhận', () => {
  let inv: MockInstance<QueryClient['invalidateQueries']>;
  beforeEach(() => {
    inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
  });
  afterEach(() => inv.mockRestore());
  const keys = () => inv.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
  const BALANCES = ['["loyalty"]', '["me"]', '["wallet"]', '["wallet-txn"]', '["points-txn"]'];

  it('Nhận tất cả có mốc nhận được: tải lại danh sách mốc, Điểm Xanh và các số dư', async () => {
    state.handler = async () => OK;
    mount(twoMilestones());
    click(btn(/Nhận tất cả/));
    await flush();
    expect(keys()).toContain('["affiliate-milestones"]');
    for (const k of BALANCES) expect(keys()).toContain(k);
  });

  it('Nhận tất cả một phần lỗi (done > 0): vẫn tải lại cả hai nhóm', async () => {
    let n = 0;
    state.handler = async () => {
      if (n++ === 1) throw new Error('Đã nhận rồi');
      return OK;
    };
    mount(twoMilestones());
    click(btn(/Nhận tất cả/));
    await flush();
    expect(keys()).toContain('["affiliate-milestones"]');
    for (const k of BALANCES) expect(keys()).toContain(k);
  });

  it('Nhận tất cả mà mọi mốc lỗi (done === 0): chỉ tải lại danh sách mốc, không tải lại Điểm Xanh hay số dư', async () => {
    state.handler = async () => {
      throw new Error('Lỗi mạng');
    };
    mount(twoMilestones());
    click(btn(/Nhận tất cả/));
    await flush();
    expect(keys()).toContain('["affiliate-milestones"]');
    for (const k of BALANCES) expect(keys()).not.toContain(k);
  });

  it('Nhận thưởng một mốc thành công: tải lại danh sách mốc, Điểm Xanh và số dư', async () => {
    state.handler = async () => OK;
    mount(data());
    click(rowBtns()[0]!);
    await flush();
    expect(keys()).toContain('["affiliate-milestones"]');
    for (const k of BALANCES) expect(keys()).toContain(k);
  });

  it('Nhận thưởng một mốc lỗi: chỉ tải lại danh sách mốc cho khớp backend', async () => {
    state.handler = async () => {
      throw new Error('Chưa đạt');
    };
    mount(data());
    click(rowBtns()[0]!);
    await flush();
    expect(keys()).toContain('["affiliate-milestones"]');
    for (const k of BALANCES) expect(keys()).not.toContain(k);
  });
});
