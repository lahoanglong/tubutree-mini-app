// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { expectNoBannedCopy, wasteItem, wastePoint } from '@/test-utils/fixtures/waste-admin';
import { WastePointForm } from './waste-point-form';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const ITEMS = [wasteItem(), wasteItem({ id: 'i2', name: 'Vỏ hộp sữa', unitLabel: 'vỏ' })];

type Route = { status?: number; body: unknown };
type Props = Partial<Parameters<typeof WastePointForm>[0]>;
async function mount(props: Props = {}, patch?: Route) {
  const api = mockFetch({
    '/geo/communes': { body: [{ code: '84_VN79_26734', name: 'Phường Bến Thành' }] },
    '/geo/provinces': { body: [{ code: '84_VN79', name: 'TP. Hồ Chí Minh' }] },
    '/admin/waste/points/': patch ?? { body: wastePoint() },
    '/admin/waste/points': { body: wastePoint() },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const onSaved = vi.fn();
  const r = render(
    <WastePointForm point={null} items={ITEMS} warehouseExists onSaved={onSaved} onCancel={() => undefined} {...props} />,
  );
  mounted.push(r);
  await flush();
  return { api, c: r.container, onSaved };
}

const q = (c: HTMLElement, sel: string) => c.querySelector<HTMLInputElement>(sel);
const btn = (c: HTMLElement, text: string) => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text)!;
const callsTo = (api: { calls: { url: string; init?: RequestInit }[] }, part: string, method: string) =>
  api.calls.filter((x) => x.url.includes(part) && (x.init?.method ?? 'GET') === method);
const body = (call: { init?: RequestInit }) => JSON.parse(String(call.init!.body));

async function fillNew(c: HTMLElement) {
  typeInto(q(c, 'input[name="name"]'), 'Tạp hoá Cô Ba');
  typeInto(q(c, 'input[name="addressLine"]'), '12 Lê Lợi');
  selectValue(q(c, 'select[aria-label="Tỉnh/thành"]'), '84_VN79');
  await flush();
  selectValue(q(c, 'select[aria-label="Phường/xã"]'), '84_VN79_26734');
  typeInto(q(c, 'input[name="lat"]'), '10.7769');
  typeInto(q(c, 'input[name="lng"]'), '106.7009');
  typeInto(q(c, 'input[name="phone"]'), '0901000111');
  typeInto(q(c, 'input[name="monthlyQuotaPoints"]'), '100000');
  click(q(c, 'input[aria-label="Thùng carton cũ"]'));
}

function openMonday(c: HTMLElement) {
  click(q(c, 'input[aria-label="Thứ 2 mở cửa"]'));
  typeInto(q(c, 'input[aria-label="Thứ 2 giờ mở 1"]'), '08:00');
  typeInto(q(c, 'input[aria-label="Thứ 2 giờ đóng 1"]'), '20:00');
}

describe('WastePointForm', () => {
  it('đăng ký đại lý mới: tỉnh, phường/xã từ danh mục, toạ độ nhập tay, giờ mở theo thứ', async () => {
    const { api, c, onSaved } = await mount();
    expect(q(c, 'input[name="kind"][value="PARTNER"]')!.checked).toBe(true);
    expect(q(c, 'input[name="kind"][value="WAREHOUSE"]')!.disabled).toBe(true);
    expect(c.textContent).toContain('Đã có kho Tubu (chỉ một kho)');
    await fillNew(c);
    openMonday(c);
    click(btn(c, 'Đăng ký điểm'));
    await flush();
    const posts = callsTo(api, '/admin/waste/points', 'POST');
    expect(posts).toHaveLength(1);
    expect(body(posts[0]!)).toEqual({
      kind: 'PARTNER', name: 'Tạp hoá Cô Ba', addressLine: '12 Lê Lợi', provinceCode: '84_VN79', provinceName: 'TP. Hồ Chí Minh',
      communeCode: '84_VN79_26734', communeName: 'Phường Bến Thành', lat: 10.7769, lng: 106.7009, phone: '0901000111',
      openingHours: { MON: [{ open: '08:00', close: '20:00' }] }, status: 'PENDING', monthlyQuotaPoints: 100_000,
      giftHandoverEnabled: false, note: null, itemIds: ['i1'],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('không có ô quận và không có câu sai về cộng tác viên', async () => {
    const { c } = await mount();
    Array.from(c.querySelectorAll('label')).forEach((l) => expect(l.textContent).not.toContain('Quận'));
    expectNoBannedCopy(c.textContent);
    expect(c.textContent).toContain('Đề xuất 100.000 điểm cho điểm mới, 300.000 cho điểm đã chạy ổn');
  });

  it('đại lý không có ô trao quà; kho có ô trao quà, luôn Đang nhận, không hạn mức', async () => {
    const partner = await mount();
    expect(q(partner.c, 'input[name="giftHandoverEnabled"]')).toBeNull();
    const wh = await mount({ point: wastePoint({ id: 'wh', kind: 'WAREHOUSE', name: 'Kho Tubu HCM', monthlyQuotaPoints: null, staff: [] }) });
    expect(q(wh.c, 'input[name="giftHandoverEnabled"]')).not.toBeNull();
    const status = wh.c.querySelector<HTMLSelectElement>('select[name="status"]')!;
    expect(status.disabled).toBe(true);
    expect(status.value).toBe('ACTIVE');
    expect(wh.c.textContent).toContain('Kho luôn Đang nhận; muốn dừng nhận mới thì tắt waste.enabled hoặc cờ waste.lane_*');
    expect(q(wh.c, 'input[name="monthlyQuotaPoints"]')).toBeNull();
  });

  it('đại lý mới: tuỳ chọn Đang nhận bị khoá và body gửi lên không phải ACTIVE', async () => {
    const { api, c } = await mount();
    const active = c.querySelector<HTMLOptionElement>('select[name="status"] option[value="ACTIVE"]')!;
    expect(active.disabled).toBe(true);
    expect(c.textContent).toContain('gắn chủ điểm rồi mới kích hoạt');
    await fillNew(c);
    click(btn(c, 'Đăng ký điểm'));
    await flush();
    expect(body(callsTo(api, '/admin/waste/points', 'POST')[0]!).status).not.toBe('ACTIVE');
  });

  it('kho mới vẫn chọn được Đang nhận; sửa đại lý đang có vẫn chọn được Đang nhận', async () => {
    const wh = await mount({ warehouseExists: false });
    click(q(wh.c, 'input[name="kind"][value="WAREHOUSE"]'));
    await flush();
    expect(wh.c.querySelector<HTMLOptionElement>('select[name="status"] option[value="ACTIVE"]')!.disabled).toBe(false);
    const edit = await mount({ point: wastePoint({ status: 'PAUSED' }) });
    expect(edit.c.querySelector<HTMLOptionElement>('select[name="status"] option[value="ACTIVE"]')!.disabled).toBe(false);
    expect(edit.c.textContent).not.toContain('gắn chủ điểm rồi mới kích hoạt');
  });

  it('đổi loại sang đại lý khi đang chọn Đang nhận của kho thì status rơi về không phải ACTIVE', async () => {
    const { api, c } = await mount({ warehouseExists: false });
    click(q(c, 'input[name="kind"][value="WAREHOUSE"]'));
    await flush();
    click(q(c, 'input[name="kind"][value="PARTNER"]'));
    await flush();
    expect(q(c, 'select[name="status"]')!.value).not.toBe('ACTIVE');
    expect(c.querySelector<HTMLOptionElement>('select[name="status"] option[value="ACTIVE"]')!.disabled).toBe(true);
    await fillNew(c);
    click(btn(c, 'Đăng ký điểm'));
    await flush();
    expect(body(callsTo(api, '/admin/waste/points', 'POST')[0]!).status).not.toBe('ACTIVE');
  });

  it('toạ độ ngoài biên và giờ đóng trước giờ mở bị chặn', async () => {
    const { c } = await mount();
    await fillNew(c);
    typeInto(q(c, 'input[name="lat"]'), '91');
    expect(c.textContent).toContain('Vĩ độ từ -90 tới 90');
    typeInto(q(c, 'input[name="lat"]'), '10.7769');
    typeInto(q(c, 'input[name="lng"]'), '-181');
    expect(c.textContent).toContain('Kinh độ từ -180 tới 180');
    typeInto(q(c, 'input[name="lng"]'), '106.7009');
    click(q(c, 'input[aria-label="Thứ 3 mở cửa"]'));
    typeInto(q(c, 'input[aria-label="Thứ 3 giờ mở 1"]'), '18:00');
    typeInto(q(c, 'input[aria-label="Thứ 3 giờ đóng 1"]'), '08:00');
    expect(c.textContent).toContain('Giờ đóng phải sau giờ mở');
    expect(btn(c, 'Đăng ký điểm').disabled).toBe(true);
  });

  it('đại lý bắt buộc có hạn mức tháng', async () => {
    const { c } = await mount();
    await fillNew(c);
    typeInto(q(c, 'input[name="monthlyQuotaPoints"]'), '');
    expect(c.textContent).toContain('Nhập hạn mức điểm mỗi tháng cho đại lý (số nguyên từ 1)');
    expect(btn(c, 'Đăng ký điểm').disabled).toBe(true);
  });

  it('sửa điểm: nâng hạn mức 100.000 → 300.000 gửi PATCH không kèm kind', async () => {
    const { api, c } = await mount({ point: wastePoint() });
    expect(q(c, 'input[name="name"]')!.value).toBe('Tạp hoá Cô Ba');
    expect(q(c, 'select[aria-label="Phường/xã"]')!.value).toBe('84_VN79_26734');
    expect(q(c, 'input[aria-label="Thứ 2 giờ mở 1"]')!.value).toBe('08:00');
    typeInto(q(c, 'input[name="monthlyQuotaPoints"]'), '300000');
    click(btn(c, 'Lưu điểm'));
    await flush();
    const patches = callsTo(api, '/admin/waste/points/p1', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(body(patches[0]!)).toEqual({ monthlyQuotaPoints: 300_000 });
  });

  it('sửa tên điểm đang nhận không gửi status; không đổi gì thì không gửi', async () => {
    const { api, c } = await mount({ point: wastePoint() });
    click(btn(c, 'Lưu điểm'));
    await flush();
    expect(callsTo(api, '/admin/waste/points/p1', 'PATCH')).toHaveLength(0);
    typeInto(q(c, 'input[name="name"]'), 'Tạp hoá Cô Ba (chi nhánh 2)');
    click(btn(c, 'Lưu điểm'));
    await flush();
    const patches = callsTo(api, '/admin/waste/points/p1', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(body(patches[0]!)).toEqual({ name: 'Tạp hoá Cô Ba (chi nhánh 2)' });
  });

  it('thêm khung giờ thứ hai trong một ngày', async () => {
    const { api, c } = await mount();
    await fillNew(c);
    click(q(c, 'input[aria-label="Thứ 7 mở cửa"]'));
    const sat = c.querySelector<HTMLElement>('[data-weekday="SAT"]')!;
    click(Array.from(sat.querySelectorAll('button')).find((b) => b.textContent === 'Thêm khung giờ')!);
    ['giờ mở 1', 'giờ đóng 1', 'giờ mở 2', 'giờ đóng 2'].forEach((s) => expect(q(c, `input[aria-label="Thứ 7 ${s}"]`)).not.toBeNull());
    typeInto(q(c, 'input[aria-label="Thứ 7 giờ mở 1"]'), '07:00');
    typeInto(q(c, 'input[aria-label="Thứ 7 giờ đóng 1"]'), '11:00');
    typeInto(q(c, 'input[aria-label="Thứ 7 giờ mở 2"]'), '14:00');
    typeInto(q(c, 'input[aria-label="Thứ 7 giờ đóng 2"]'), '18:00');
    click(btn(c, 'Đăng ký điểm'));
    await flush();
    const posts = callsTo(api, '/admin/waste/points', 'POST');
    expect(body(posts[0]!).openingHours.SAT).toEqual([{ open: '07:00', close: '11:00' }, { open: '14:00', close: '18:00' }]);
  });

  it('lỗi API hiện nguyên văn', async () => {
    const message = 'Điểm đại lý cần đúng một chủ điểm trước khi chuyển sang Đang nhận';
    const { api, c } = await mount({ point: wastePoint({ status: 'PENDING' }) }, { status: 400, body: { message } });
    selectValue(c.querySelector('select[name="status"]'), 'ACTIVE');
    click(btn(c, 'Lưu điểm'));
    await flush();
    const patches = callsTo(api, '/admin/waste/points/p1', 'PATCH');
    expect(body(patches[0]!)).toEqual({ status: 'ACTIVE' });
    expect(c.querySelector('[role="alert"]')!.textContent).toContain(message);
  });
});
