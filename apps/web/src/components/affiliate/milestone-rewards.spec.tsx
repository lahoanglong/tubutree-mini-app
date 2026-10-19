// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CtvMilestoneItem, CtvMilestonesResponse } from '@tubutree/app-core/api/affiliate';
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
  it('mỗi mốc một dòng: thưởng bằng điểm, đã nhận có nhãn, đạt chưa nhận có nút, chưa đạt có chữ còn thiếu', () => {
    const { container } = mount(data());
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
