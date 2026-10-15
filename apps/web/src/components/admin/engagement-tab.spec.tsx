// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EngagementTab } from './engagement-tab';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const MISSIONS = [
  { id: 'm-first', code: 'FIRST_ORDER', title: 'Đơn đầu tiên', description: 'Hoàn tất đơn đầu', rewardPoints: 30, goal: 1, isRepeatable: false, claimedCount: 12 },
  { id: 'm-streak', code: 'CHECKIN_7', title: 'Điểm danh 7 ngày', description: 'Giữ chuỗi 7 ngày', rewardPoints: 20, goal: 7, isRepeatable: true, claimedCount: 3 },
];
const REWARDS = [
  { id: 'reward-freeship', title: 'Voucher Miễn phí vận chuyển', description: 'x', pointsCost: 20, type: 'FREESHIP', value: 0, minOrder: 99000, redeemedCount: 40, redeemed30d: 9 },
];

function stub(patch: { status?: number; body: unknown } = { body: { id: 'm-first' } }) {
  const m = mockFetch({
    '/admin/engagement/missions/': () => patch,
    '/admin/engagement/missions': { body: MISSIONS },
    '/admin/engagement/rewards': { body: REWARDS },
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  return { patches: () => m.calls.filter((c) => c.init?.method === 'PATCH') };
}

describe('EngagementTab (Nhiệm vụ & quà đổi điểm)', () => {
  it('liệt kê nhiệm vụ với mục tiêu, lượt đã nhận; danh mục quà với giá điểm và lượt đổi', async () => {
    stub();
    const { container } = mount(<EngagementTab />);
    await flush();
    const first = container.querySelector<HTMLElement>('[data-mission="FIRST_ORDER"]')!;
    expect(first.textContent).toContain('12 lượt đã nhận');
    const streak = container.querySelector<HTMLElement>('[data-mission="CHECKIN_7"]')!;
    expect(streak.textContent).toContain('Mục tiêu 7 · lặp lại');
    const reward = container.querySelector<HTMLElement>('[data-reward="reward-freeship"]')!;
    expect(reward.textContent).toContain('Voucher Miễn phí vận chuyển');
    expect(reward.textContent).toContain('20 điểm');
    expect(reward.textContent).toContain('40 lượt đổi · 9 trong 30 ngày');
  });

  it('sửa điểm thưởng rồi Lưu → PATCH đúng nhiệm vụ', async () => {
    const api = stub();
    const { container } = mount(<EngagementTab />);
    await flush();
    const row = container.querySelector<HTMLElement>('[data-mission="FIRST_ORDER"]')!;
    const save = byText(row, 'button', 'Lưu') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    typeInto(row.querySelector('input[name="rewardPoints"]'), '40');
    click(save);
    await flush();
    const [call] = api.patches();
    expect(call!.url).toContain('/admin/engagement/missions/m-first');
    expect(JSON.parse(String(call!.init!.body))).toEqual({ title: 'Đơn đầu tiên', description: 'Hoàn tất đơn đầu', rewardPoints: 40 });
    expect(row.textContent).toContain('Đã lưu');
  });

  it('điểm không hợp lệ khoá nút Lưu; lỗi API hiện nguyên văn', async () => {
    stub({ status: 400, body: { message: 'rewardPoints must not be greater than 500' } });
    const { container } = mount(<EngagementTab />);
    await flush();
    const row = container.querySelector<HTMLElement>('[data-mission="CHECKIN_7"]')!;
    const save = byText(row, 'button', 'Lưu') as HTMLButtonElement;
    typeInto(row.querySelector('input[name="rewardPoints"]'), '2.5');
    expect(save.disabled).toBe(true);
    typeInto(row.querySelector('input[name="rewardPoints"]'), '501');
    expect(save.disabled).toBe(true);
    expect(row.textContent).toContain('Điểm thưởng từ 0 đến 500');
    typeInto(row.querySelector('input[name="rewardPoints"]'), '25');
    click(save);
    await flush();
    expect(row.textContent).toContain('rewardPoints must not be greater than 500');
  });
});
