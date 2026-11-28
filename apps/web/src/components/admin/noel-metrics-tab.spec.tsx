// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NoelMetricsDTO } from '@tubutree/shared-types';
import { NoelMetricsTab } from './noel-metrics-tab';
import { busyNoelMetrics, emptyNoelMetrics } from '@/test-utils/fixtures/noel-metrics';
import { click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const mountWith = async (body: NoelMetricsDTO | ((url: string) => NoelMetricsDTO), status = 200) => {
  const api = mockFetch({ '/admin/analytics/noel': { status, body: typeof body === 'function' ? body('') : body } });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<NoelMetricsTab />);
  mounted.push(r);
  await flush();
  return { api, ...r };
};

const noelCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.includes('/admin/analytics/noel'));
const section = (c: HTMLElement, name: string) => c.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;
const rowOf = (root: HTMLElement, label: string) => Array.from(root.querySelectorAll('tbody tr')).find((tr) => tr.querySelector('th')?.textContent === label)!;
const cells = (tr: Element) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent);
const windowButton = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Khoảng thời gian"] button')).find((b) => b.textContent === label)!;
const card = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll('dl[aria-label="Tóm tắt Noel"] > div')).find((d) => d.querySelector('dt')?.textContent === label)!;

describe('NoelMetricsTab', () => {
  it('đang tải: khung xương, chưa có bảng; tải xong hiện số liệu', async () => {
    const api = mockFetch({ '/admin/analytics/noel': { body: busyNoelMetrics() } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<NoelMetricsTab />);
    mounted.push(r);
    expect(r.container.querySelector('[aria-busy="true"][aria-label="Đang tải số liệu Noel"]')).not.toBeNull();
    expect(r.container.querySelector('table')).toBeNull();
    await flush();
    expect(r.container.querySelector('[data-skeleton]')).toBeNull();
    expect(r.container.querySelector('table')).not.toBeNull();
  });

  it('lỗi tải: câu tiếng Việt kèm Thử lại, bấm lại thì tải được', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n += 1;
        return n === 1
          ? new Response(JSON.stringify({ message: 'x' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
          : new Response(JSON.stringify(busyNoelMetrics()), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const r = render(<NoelMetricsTab />);
    mounted.push(r);
    await flush();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Không tải được số liệu Noel.');
    expect(r.container.querySelector('table')).toBeNull();
    click(Array.from(r.container.querySelectorAll('button')).find((b) => b.textContent === 'Thử lại') ?? null);
    await flush();
    expect(r.container.querySelector('table')).not.toBeNull();
    expect(r.container.textContent).not.toContain('Không tải được số liệu Noel.');
  });

  it('đầu trang: ba nút 1/7/14 ngày (mặc định 7, aria-pressed), nút Làm mới, chạm ≥ 44px, giờ cập nhật theo giờ Việt Nam', async () => {
    const { container, api } = await mountWith(busyNoelMetrics());
    expect(noelCalls(api.calls).map((c) => c.url.slice(c.url.indexOf('?')))).toEqual(['?days=7']);
    expect(container.querySelector('h2')?.textContent).toBe('Noel Xanh');
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Khoảng thời gian"] button'));
    expect(buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['1 ngày', 'false'],
      ['7 ngày', 'true'],
      ['14 ngày', 'false'],
    ]);
    expect(buttons.every((b) => b.className.includes('min-h-[44px]'))).toBe(true);
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Làm mới' && b.className.includes('min-h-[44px]'))).toBe(true);
    expect(container.textContent).toContain('từ 14/12 đến 20/12');
    expect(container.textContent).toContain('Cập nhật lúc 10:00');
  });

  it('đổi khoảng gọi API với đúng số ngày và đánh dấu nút đang chọn', async () => {
    const { container, api } = await mountWith(busyNoelMetrics());
    click(windowButton(container, '14 ngày'));
    await flush();
    click(windowButton(container, '1 ngày'));
    await flush();
    expect(noelCalls(api.calls).map((c) => c.url.slice(c.url.indexOf('?')))).toEqual(['?days=7', '?days=14', '?days=1']);
    expect(windowButton(container, '1 ngày').getAttribute('aria-pressed')).toBe('true');
    expect(windowButton(container, '7 ngày').getAttribute('aria-pressed')).toBe('false');
  });

  it('Làm mới tải lại cùng khoảng', async () => {
    const { container, api } = await mountWith(busyNoelMetrics());
    click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Làm mới') ?? null);
    await flush();
    expect(noelCalls(api.calls)).toHaveLength(2);
  });

  it('thẻ tóm tắt: số khách và lượt nhận quà, hoàn thành lịch, thiệp, tắt tuyết', async () => {
    const { container } = await mountWith(busyNoelMetrics());
    expect(card(container, 'Khách điểm danh nhận quà').textContent).toContain('40');
    expect(card(container, 'Khách điểm danh nhận quà').textContent).toContain('140 lượt · TB 20/ngày');
    expect(card(container, 'Hoàn thành lịch quà').textContent).toContain('20%');
    expect(card(container, 'Hoàn thành lịch quà').textContent).toContain('8/40 khách');
    expect(card(container, 'Bấm chia sẻ thiệp').textContent).toContain('20');
    expect(card(container, 'Bấm chia sẻ thiệp').textContent).toContain('12 khách');
    expect(card(container, 'Tắt tuyết').textContent).toContain('75%');
    expect(card(container, 'Tắt tuyết').textContent).toContain('18 lượt tắt · 6 lượt bật');
    expect(container.querySelectorAll('dl[aria-label="Tóm tắt Noel"] dd').length).toBe(4);
    expect(Array.from(container.querySelectorAll('dl[aria-label="Tóm tắt Noel"] dd')).every((d) => d.className.includes('tabular-nums'))).toBe(true);
  });

  it('nhận quà theo ngày: một hàng mỗi ngày, ngày dạng dd/mm', async () => {
    const { container } = await mountWith(busyNoelMetrics());
    const rows = Array.from(section(container, 'Nhận quà theo ngày').querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(7);
    expect(rows[0]!.querySelector('th')?.textContent).toBe('14/12');
    expect(rows[0]!.querySelector('td')?.textContent).toBe('10');
    expect(rows[6]!.querySelector('th')?.textContent).toBe('20/12');
    expect(rows[6]!.querySelector('td')?.textContent).toBe('40');
  });

  it('lịch quà: số khách từng ô; ô chưa tới ngày hiện gạch, không thanh', async () => {
    const { container } = await mountWith(busyNoelMetrics());
    const advent = section(container, 'Lịch quà 12 ngày');
    expect(advent.textContent).toContain('Đã tới ô 7/12.');
    expect(advent.textContent).toContain('mở đủ 6 ô tới hôm qua: 8 khách (20%)');
    expect(cells(rowOf(advent, 'Ô 1 · 14/12'))[0]).toBe('30');
    const future = rowOf(advent, 'Ô 12 · 25/12');
    expect(cells(future)[0]).toBe('—');
    expect(future.querySelector('div[aria-hidden="true"]')).toBeNull();
  });

  it('lịch quà: trước 14/12, ngày đầu và sau 25/12 có câu giải thích riêng; hoàn thành chỉ tính khi đã có ô trọn ngày', async () => {
    const base = busyNoelMetrics();
    const before = await mountWith({ ...base, advent: { ...base.advent, phase: 'before', daysElapsed: 0, requiredDays: 0, openedAny: 0, completed: null, completionPct: null } });
    expect(section(before.container, 'Lịch quà 12 ngày').textContent).toContain('Lịch quà bắt đầu từ 14/12, chưa có ô nào tới ngày.');
    expect(section(before.container, 'Lịch quà 12 ngày').textContent).not.toContain('Mở ít nhất một ô');
    expect(card(before.container, 'Hoàn thành lịch quà').textContent).toContain('Chưa tới 14/12');
    const first = await mountWith({ ...base, advent: { ...base.advent, phase: 'during', daysElapsed: 1, requiredDays: 0, openedAny: 9, completed: null, completionPct: null } });
    expect(section(first.container, 'Lịch quà 12 ngày').textContent).toContain('Mở ít nhất một ô: 9 khách · tỉ lệ hoàn thành tính từ ngày thứ 2');
    expect(card(first.container, 'Hoàn thành lịch quà').textContent).toContain('Tính từ ngày thứ 2');
    const after = await mountWith({ ...base, advent: { ...base.advent, phase: 'after', daysElapsed: 12, requiredDays: 12 } });
    expect(section(after.container, 'Lịch quà 12 ngày').textContent).toContain('Lịch quà đã kết thúc (ngày cuối 25/12).');
    expect(section(after.container, 'Lịch quà 12 ngày').textContent).toContain('mở đủ 12 ô: 8 khách (20%)');
    expect(section(after.container, 'Lịch quà 12 ngày').textContent).not.toContain('mở đủ 12 ô tới hôm qua');
  });

  it('trang trí cây: tên món tiếng Việt, mở khoá/treo/gỡ kèm số khách; có câu điều kiện chuỗi điểm danh', async () => {
    const { container } = await mountWith(busyNoelMetrics());
    const o = section(container, 'Trang trí cây thông');
    expect(cells(rowOf(o, 'Ngôi sao đỉnh cây'))).toEqual(['1 (1)', '0 (0)', '0 (0)']);
    expect(cells(rowOf(o, 'Quả châu đỏ'))).toEqual(['3 (3)', '4 (2)', '0 (0)']);
    expect(cells(rowOf(o, 'Vòng nguyệt quế'))).toEqual(['6 (6)', '10 (5)', '2 (1)']);
    expect(o.textContent).toContain('từ 3 ngày liền 18 khách (Quả châu đỏ)');
    expect(o.textContent).toContain('từ 7 ngày liền 4 khách (Tuần lộc mini)');
    expect(o.textContent).not.toContain('Chưa có khách trang trí cây');
  });

  it('game: tên game, ván, điểm TB (arcade là điểm, mini là đúng/tổng, chưa có là gạch), mã game lạ hiện nguyên mã', async () => {
    const base = busyNoelMetrics();
    const { container } = await mountWith({
      ...base,
      games: [...base.games, { game: 'quiz_x', kind: 'mini', plays: 1, users: 1, avgScore: null, avgOutOf: null, rewardedPlays: 0, water: 0, points: 0 }],
    });
    const g = section(container, 'Game trong Sảnh');
    expect(cells(rowOf(g, 'Hứng Giọt Sương'))).toEqual(['120', '45', '412,3', '90', '450', '90']);
    expect(cells(rowOf(g, 'Phân Loại Vỏ Chai Thần Tốc'))).toEqual(['0', '0', '—', '0', '0', '0']);
    expect(cells(rowOf(g, 'Ghép Mầm Xanh'))[2]).toBe('4,3/8');
    expect(cells(rowOf(g, 'Băng Chuyền Xanh'))[2]).toBe('6/8');
    expect(cells(rowOf(g, 'Đố Xanh Mỗi Ngày'))[2]).toBe('2,5/3');
    expect(rowOf(g, 'quiz_x')).toBeDefined();
    expect(g.querySelector('table')?.className).toContain('tabular-nums');
    expect(g.querySelector('table')?.parentElement?.className).toContain('overflow-x-auto');
    expect(g.textContent).toContain('chỉ đếm ván từ lúc tab này ra mắt');
  });

  it('thưởng game: số kỳ này so với kỳ trước và dòng "chưa thấy vượt trần" khi bình thường', async () => {
    const { container } = await mountWith(busyNoelMetrics());
    const e = section(container, 'Thưởng game đã phát');
    expect(e.textContent).toContain('Chưa thấy thưởng game vượt trần hay tăng bất thường');
    expect(e.querySelector('[role="alert"]')).toBeNull();
    const heads = Array.from(e.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(heads).toEqual(['Chỉ số', '14/12 đến 20/12', '07/12 đến 13/12']);
    expect(cells(rowOf(e, 'Giọt nước phát từ game mini'))).toEqual(['415', '380']);
    expect(cells(rowOf(e, 'Lượt arcade có thưởng'))).toEqual(['90', '60']);
    expect(cells(rowOf(e, 'Nhiều nhất một khách một ngày: giọt nước (trần 40)'))).toEqual(['40', '40']);
    expect(cells(rowOf(e, 'Điểm Xanh game phát nhiều nhất một ngày (ngân sách 200.000)'))).toEqual(['900', '600']);
  });

  it('thưởng game vượt trần: ô đỏ role=alert; tăng mạnh: ô vàng role=status; không còn dòng "chưa thấy"', async () => {
    const base = busyNoelMetrics();
    const { container } = await mountWith({
      ...base,
      economy: { ...base.economy, current: { ...base.economy.current, maxUserWaterInDay: 55, miniWater: 600 } },
    });
    const e = section(container, 'Thưởng game đã phát');
    const red = e.querySelector('[role="alert"]');
    expect(red?.textContent).toContain('55 giọt nước game trong một ngày, vượt trần 40');
    expect(e.querySelector('[role="status"]')?.textContent).toContain('Giọt nước phát từ game mini tăng');
    expect(e.textContent).not.toContain('Chưa thấy thưởng game vượt trần');
  });

  it('quay lại D+1: hai nhóm, chênh lệch có dấu, không cảnh báo mẫu nhỏ khi đủ mẫu, có câu không chứng minh nguyên nhân', async () => {
    const { container } = await mountWith(busyNoelMetrics());
    const r = section(container, 'Quay lại hôm sau (D+1)');
    expect(r.textContent).toContain('Có điểm danh hoặc thao tác Noel');
    expect(r.textContent).toContain('60%');
    expect(r.textContent).toContain('60/100 lượt khách-ngày quay lại hôm sau');
    expect(r.textContent).toContain('Không điểm danh, không thao tác Noel');
    expect(r.textContent).toContain('120/400 lượt khách-ngày quay lại hôm sau');
    expect(r.textContent).toContain('Chênh lệch: +30 điểm phần trăm.');
    expect(r.textContent).not.toContain('Mẫu còn nhỏ');
    expect(r.textContent).toContain('chưa chứng minh Noel là nguyên nhân');
    expect(r.textContent).toContain('ngày 12/12 đến 18/12');
  });

  it('mẫu D+1 nhỏ: hiện cảnh báo', async () => {
    const base = busyNoelMetrics();
    const { container } = await mountWith({
      ...base,
      retention: { ...base.retention, noel: { userDays: 10, returned: 5, ratePct: 50 } },
    });
    expect(section(container, 'Quay lại hôm sau (D+1)').textContent).toContain('Mẫu còn nhỏ (dưới 30 lượt khách-ngày ở một nhóm)');
  });

  it('trạng thái rỗng: mọi số 0 hoặc gạch, câu "chưa có", không NaN, không cảnh báo đỏ, vẫn đủ mọi khối', async () => {
    const { container } = await mountWith(emptyNoelMetrics());
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    expect(card(container, 'Khách điểm danh nhận quà').textContent).toContain('0 lượt · TB 0/ngày');
    expect(card(container, 'Hoàn thành lịch quà').textContent).toContain('—');
    expect(card(container, 'Tắt tuyết').textContent).toContain('—');
    expect(text).toContain('Chưa có khách nhận quà trong khoảng này.');
    expect(text).toContain('Chưa có khách trang trí cây trong khoảng này.');
    expect(section(container, 'Nhận quà theo ngày').querySelector('table')).toBeNull();
    expect(section(container, 'Game trong Sảnh').querySelectorAll('tbody tr')).toHaveLength(4);
    expect(section(container, 'Quay lại hôm sau (D+1)').textContent).not.toContain('Chênh lệch');
    expect(section(container, 'Quay lại hôm sau (D+1)').textContent).toContain('Mẫu còn nhỏ');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(text).toContain('Chưa thấy thưởng game vượt trần');
  });

  it('khoảng 1 ngày: TB mỗi ngày bằng đúng số lượt, không chia sai', async () => {
    const base = busyNoelMetrics();
    const { container } = await mountWith({ ...base, days: 1, claims: { ...base.claims, claims: 12, users: 12, perDay: [{ dayKey: '2026-12-20', count: 12 }] } });
    expect(card(container, 'Khách điểm danh nhận quà').textContent).toContain('12 lượt · TB 12/ngày');
    expect(section(container, 'Nhận quà theo ngày').querySelectorAll('tbody tr')).toHaveLength(1);
  });
});
