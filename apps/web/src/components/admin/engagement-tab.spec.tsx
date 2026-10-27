// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EngagementTab } from './engagement-tab';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

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
  { id: 'm-first', code: 'FIRST_ORDER', title: 'Đơn đầu tiên', description: 'Hoàn tất đơn đầu', rewardPoints: 30_000, goal: 1, isRepeatable: false, kind: 'ORDER_COUNT', disabled: false, claimedCount: 12 },
  { id: 'm-streak', code: 'CHECKIN_7', title: 'Điểm danh 7 ngày', description: 'Giữ chuỗi 7 ngày', rewardPoints: 20_000, goal: 7, isRepeatable: true, kind: 'CHECKIN_STREAK', disabled: true, claimedCount: 3 },
];

function stub(patch: { status?: number; body: unknown } = { body: { id: 'm-first' } }) {
  const m = mockFetch({
    '/admin/engagement/seasons': { body: [] },
    '/admin/engagement/missions/': () => patch,
    '/admin/engagement/missions': { body: MISSIONS },
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  return {
    patches: () => m.calls.filter((c) => c.init?.method === 'PATCH'),
    posts: () => m.calls.filter((c) => c.init?.method === 'POST'),
    calls: m.calls,
  };
}

describe('EngagementTab (Nhiệm vụ & quà đổi điểm)', () => {
  it('liệt kê nhiệm vụ với mục tiêu, lượt đã nhận', async () => {
    stub();
    const { container } = mount(<EngagementTab />);
    await flush();
    const first = container.querySelector<HTMLElement>('[data-mission="FIRST_ORDER"]')!;
    expect(first.textContent).toContain('12 lượt đã nhận');
    const streak = container.querySelector<HTMLElement>('[data-mission="CHECKIN_7"]')!;
    expect(streak.textContent).toContain('Mục tiêu 7 · lặp lại');
  });

  it('không còn danh mục quà chỉ xem; trỏ sang tab Đổi rác (13.2)', async () => {
    const api = stub();
    const { container } = mount(<EngagementTab />);
    await flush();
    expect(container.querySelector('[data-reward]')).toBeNull();
    expect(container.textContent).not.toContain('cố định trong mã nguồn');
    expect(container.textContent).toContain('Quà đổi Điểm Xanh nay quản lý ở tab Đổi rác, mục Quà.');
    expect(api.calls.some((c) => c.url.includes('/admin/engagement/rewards'))).toBe(false);
  });

  it('sửa điểm thưởng rồi Lưu → PATCH đúng nhiệm vụ', async () => {
    const api = stub();
    const { container } = mount(<EngagementTab />);
    await flush();
    const row = container.querySelector<HTMLElement>('[data-mission="FIRST_ORDER"]')!;
    const save = byText(row, 'button', 'Lưu') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    typeInto(row.querySelector('input[name="rewardPoints"]'), '40000');
    click(save);
    await flush();
    const [call] = api.patches();
    expect(call!.url).toContain('/admin/engagement/missions/m-first');
    expect(JSON.parse(String(call!.init!.body))).toEqual({ title: 'Đơn đầu tiên', description: 'Hoàn tất đơn đầu', rewardPoints: 40000 });
    expect(row.textContent).toContain('Đã lưu');
  });

  it('điểm không hợp lệ khoá nút Lưu; lỗi API hiện nguyên văn', async () => {
    stub({ status: 400, body: { message: 'rewardPoints must not be greater than 500000' } });
    const { container } = mount(<EngagementTab />);
    await flush();
    const row = container.querySelector<HTMLElement>('[data-mission="CHECKIN_7"]')!;
    const save = byText(row, 'button', 'Lưu') as HTMLButtonElement;
    typeInto(row.querySelector('input[name="rewardPoints"]'), '2.5');
    expect(save.disabled).toBe(true);
    typeInto(row.querySelector('input[name="rewardPoints"]'), '500001');
    expect(save.disabled).toBe(true);
    expect(row.textContent).toContain('Điểm thưởng từ 0 đến 500.000');
    typeInto(row.querySelector('input[name="rewardPoints"]'), '25000');
    click(save);
    await flush();
    expect(row.textContent).toContain('rewardPoints must not be greater than 500000');
  });

  it('Tạm dừng / Bật lại gửi cờ disabled đảo ngược; nhiệm vụ đang dừng có nhãn', async () => {
    const api = stub();
    const { container } = mount(<EngagementTab />);
    await flush();
    const streak = container.querySelector<HTMLElement>('[data-mission="CHECKIN_7"]')!;
    expect(streak.textContent).toContain('Đang tạm dừng');
    click(byText(streak, 'button', 'Bật lại'));
    await flush();
    const first = container.querySelector<HTMLElement>('[data-mission="FIRST_ORDER"]')!;
    click(byText(first, 'button', 'Tạm dừng'));
    await flush();
    expect(api.patches().map((c) => [c.url.split('/').pop(), JSON.parse(String(c.init!.body))])).toEqual([
      ['m-streak', { disabled: false }],
      ['m-first', { disabled: true }],
    ]);
  });

  it('thêm nhiệm vụ điểm danh: hộp xác nhận nói rõ vé giữ lửa và hồi sinh chuỗi làm nhiệm vụ đếm lại', async () => {
    stub({ body: { id: 'm-new' } });
    const { container } = mount(<EngagementTab />);
    await flush();
    click(byText(container, 'button', 'Thêm nhiệm vụ'));
    const form = container.querySelector<HTMLFormElement>('form[aria-label="Thêm nhiệm vụ"]')!;
    expect(form.textContent).not.toContain('hồi sinh chuỗi');
    typeInto(form.querySelector('select[name="kind"]'), 'CHECKIN_STREAK');
    expect(form.textContent).toContain('hồi sinh chuỗi');
    typeInto(form.querySelector('input[name="title"]'), 'Điểm danh 3 ngày');
    typeInto(form.querySelector('input[name="goal"]'), '3');
    typeInto(form.querySelector('input[name="rewardPoints"]'), '100');
    click(byText(form, 'button', 'Thêm nhiệm vụ'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('vé giữ lửa hay hồi sinh chuỗi');
  });

  it('thêm nhiệm vụ: khoá nút khi mục tiêu vượt trần của loại hoặc điểm vượt trần; gửi đúng dữ liệu', async () => {
    const api = stub({ body: { id: 'm-new' } });
    const { container } = mount(<EngagementTab />);
    await flush();
    click(byText(container, 'button', 'Thêm nhiệm vụ'));
    const form = container.querySelector<HTMLFormElement>('form[aria-label="Thêm nhiệm vụ"]')!;
    const submit = byText(form, 'button', 'Thêm nhiệm vụ') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    typeInto(form.querySelector('input[name="title"]'), ' Mời bạn ');
    expect(submit.disabled).toBe(true); // chưa nhập điểm thưởng: không có số mặc định
    expect((form.querySelector('input[name="rewardPoints"]') as HTMLInputElement).value).toBe('');
    typeInto(form.querySelector('input[name="rewardPoints"]'), '1');
    expect(submit.disabled).toBe(false);
    typeInto(form.querySelector('input[name="goal"]'), '101');
    expect(submit.disabled).toBe(true);
    expect(form.textContent).toContain('từ 1 đến 100');
    typeInto(form.querySelector('input[name="goal"]'), '2');
    typeInto(form.querySelector('input[name="rewardPoints"]'), '500001');
    expect(submit.disabled).toBe(true);
    typeInto(form.querySelector('input[name="rewardPoints"]'), '30000');
    expect(submit.disabled).toBe(false);
    click(submit);
    await flush();
    expect(api.posts()).toHaveLength(0);
    expect(confirmDialog()?.textContent).toContain('Chỉ tính việc khách làm từ lúc tạo');
    expect(confirmDialog()?.textContent).toContain('tối đa 30.000 Điểm Xanh');
    answerConfirm(true);
    await flush();
    const [call] = api.posts();
    expect(call!.url).toContain('/admin/engagement/missions');
    expect(JSON.parse(String(call!.init!.body))).toEqual({ title: 'Mời bạn', description: '', kind: 'ORDER_COUNT', goal: 2, rewardPoints: 30000 });
  });
});
