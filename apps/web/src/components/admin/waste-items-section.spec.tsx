// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, click, confirmDialog, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { expectNoBannedCopy, wasteItem } from '@/test-utils/fixtures/waste-admin';
import { WasteItemsSection } from './waste-items-section';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const ITEMS = [
  wasteItem(),
  wasteItem({ id: 'i2', code: 'MILK', name: 'Vỏ hộp sữa', unitLabel: 'vỏ', unitsPerPoint: 5, dailyCapQty: 50, monthlyCapQty: 300, sortOrder: 1 }),
  wasteItem({ id: 'i5', code: 'BATTERY', name: 'Pin đã dùng', unitLabel: 'viên', dailyCapQty: null, monthlyCapQty: null, status: 'COMING_SOON', hazardous: true, sortOrder: 4, prepInstructions: null }),
];
// Dạng thật của GET /admin/config?category=: object {khoá: giá trị}, không phải mảng dòng.
const LOYALTY = { 'loyalty.vnd_per_point_redeem': 1, 'loyalty.point_expire_months': 12, 'loyalty.max_redeem_pct': 0.2 };
const WASTE = { 'waste.mailin_min_points': 15000 };

type Route = { status?: number; body: unknown };
async function mount(patch?: Route) {
  const api = mockFetch({
    '/admin/waste/items/order': { body: ITEMS },
    '/admin/waste/items/': patch ?? { body: ITEMS[0] },
    '/admin/waste/items': { body: ITEMS },
    '/admin/config?category=loyalty': { body: LOYALTY },
    '/admin/config?category=waste': { body: WASTE },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<WasteItemsSection />);
  mounted.push(r);
  await flush();
  return { api, c: r.container };
}

const row = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-item="${id}"]`)!;
const field = (c: HTMLElement, name: string) => c.querySelector<HTMLInputElement>(`[name="${name}"]`);
const saveBtn = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Lưu')!;
const callsTo = (api: { calls: { url: string; init?: RequestInit }[] }, part: string, method: string) =>
  api.calls.filter((x) => x.url.includes(part) && (x.init?.method ?? 'GET') === method);
const body = (call: { init?: RequestInit }) => JSON.parse(String(call.init!.body));

function fillNew(c: HTMLElement) {
  click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Thêm món')!);
  typeInto(field(c, 'code'), 'MILK2');
  typeInto(field(c, 'name'), 'Vỏ hộp sữa');
  typeInto(field(c, 'unitLabel'), 'vỏ');
  typeInto(field(c, 'unitsPerPoint'), '5');
  typeInto(field(c, 'pointsPerGroup'), '1000');
  typeInto(field(c, 'monthlyCapQty'), '300');
}

describe('WasteItemsSection', () => {
  it('bảng món có cột "Trần ngày (mang tới điểm)" và "Trần tháng"; trần trống hiện —', async () => {
    const { c } = await mount();
    const ths = Array.from(c.querySelectorAll('th')).map((t) => t.textContent);
    expect(ths).toContain('Trần ngày (mang tới điểm)');
    expect(ths).toContain('Trần tháng');
    const r2 = row(c, 'i2').textContent!;
    expect(r2).toContain('5 vỏ = 1.000 điểm');
    expect(r2).toContain('50');
    expect(r2).toContain('300');
    const cells = Array.from(row(c, 'i5').querySelectorAll('td')).map((t) => t.textContent);
    expect(cells.filter((t) => t === '—').length).toBeGreaterThanOrEqual(2);
  });

  // D7-26: 11 cột dồn chật ở 1440, chữ xuống dòng khó so hàng.
  it('D7-26: bảng gọn (tối đa 8 cột): mã món chung ô với tên, giọt nước và gram chung ô, cột thao tác không xuống dòng', async () => {
    const { c } = await mount();
    const ths = Array.from(c.querySelectorAll('th')).map((t) => t.textContent);
    expect(ths.length).toBeLessThanOrEqual(8);
    expect(ths).not.toContain('Mã');
    expect(ths).not.toContain('Đơn vị');
    const cells = Array.from(row(c, 'i2').querySelectorAll('td'));
    expect(cells).toHaveLength(ths.length);
    const name = cells.find((td) => td.textContent?.includes('Vỏ hộp sữa'))!;
    expect(name.textContent).toContain('MILK');
    const nowrap = (td: Element | undefined) => td?.className.includes('whitespace-nowrap');
    expect(nowrap(cells.at(-1))).toBe(true);
    expect(nowrap(cells.at(-2))).toBe(true);
  });

  it('chân bảng ghi đúng câu của spec 9', async () => {
    const { c } = await mount();
    expect(c.textContent).toContain('Thay đổi áp cho yêu cầu mới và cho yêu cầu khách sửa lại sau đó; yêu cầu chưa sửa giữ mức cũ.');
    expect(c.textContent).not.toContain('chỉ áp dụng cho yêu cầu mới');
  });

  it('dải thông số chỉ để xem: 1 điểm, hạn điểm, mức dùng tối đa, gói gửi kho tối thiểu', async () => {
    const { c } = await mount();
    const t = c.querySelector('[data-waste-params]')!.textContent!;
    expect(t).toContain('1 điểm = 1đ');
    expect(t).toContain('Hạn điểm 12 tháng');
    expect(t).toContain('Dùng tối đa 20% giá trị đơn');
    expect(t).toContain('Gói gửi kho tối thiểu 15.000 điểm');
    expect(c.querySelectorAll('[data-waste-params] input')).toHaveLength(0);
  });

  it('trạng thái là bộ chọn ba giá trị; đổi sang Sắp nhận gửi PATCH', async () => {
    const { c, api } = await mount();
    const sel = c.querySelector<HTMLSelectElement>('select[aria-label="Trạng thái Vỏ hộp sữa"]')!;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(['Đang nhận', 'Sắp nhận', 'Ẩn']);
    selectValue(sel, 'COMING_SOON');
    await flush();
    const patch = callsTo(api, '/admin/waste/items/i2', 'PATCH');
    expect(patch).toHaveLength(1);
    expect(body(patch[0]!)).toEqual({ status: 'COMING_SOON' });
    expect(c.querySelector('table input[type="checkbox"][role="switch"]')).toBeNull();
  });

  it('dòng đang mở panel Sửa: khoá bộ chọn trạng thái và nút đổi thứ tự để Lưu không ghi đè', async () => {
    const { c } = await mount();
    const sel = c.querySelector<HTMLSelectElement>('select[aria-label="Trạng thái Vỏ hộp sữa"]')!;
    click(Array.from(row(c, 'i2').querySelectorAll('button')).find((b) => b.textContent === 'Sửa')!);
    expect(sel.disabled).toBe(true);
    expect(row(c, 'i2').querySelector<HTMLButtonElement>('button[aria-label="Đưa Vỏ hộp sữa lên"]')!.disabled).toBe(true);
    expect(row(c, 'i2').querySelector<HTMLButtonElement>('button[aria-label="Đưa Vỏ hộp sữa xuống"]')!.disabled).toBe(true);
    expect(c.querySelector<HTMLSelectElement>('select[aria-label="Trạng thái Pin đã dùng"]')!.disabled).toBe(false);
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Đóng')!);
    expect(sel.disabled).toBe(false);
  });

  it('món nguy hại: không bỏ được cờ, vẫn đặt được Đang nhận', async () => {
    const { c, api } = await mount();
    const opt = row(c, 'i5').querySelector<HTMLOptionElement>('option[value="ACTIVE"]')!;
    expect(opt.disabled).toBe(false);
    click(Array.from(row(c, 'i5').querySelectorAll('button')).find((b) => b.textContent === 'Sửa')!);
    const hz = field(c, 'hazardous')!;
    expect(hz.checked).toBe(true);
    expect(hz.disabled).toBe(true);
    expect(c.textContent).toContain('Đã đánh dấu nguy hại: không bỏ được cờ, món chỉ nhận khi khách mang tới điểm nhận.');
    typeInto(field(c, 'prepInstructions'), 'Chưa nhận pin. Gom riêng, không bỏ chung với rác khác.');
    click(saveBtn(c));
    await flush();
    const patch = callsTo(api, '/admin/waste/items/i5', 'PATCH');
    expect(patch).toHaveLength(1);
    expect(body(patch[0]!)).toEqual({ prepInstructions: 'Chưa nhận pin. Gom riêng, không bỏ chung với rác khác.' });
  });

  it('bật món nguy hại (chọn Đang nhận ở bảng) hỏi xác nhận; Huỷ thì không gọi API, Đồng ý thì PATCH ACTIVE', async () => {
    const { c, api } = await mount();
    selectValue(c.querySelector('select[aria-label="Trạng thái Pin đã dùng"]'), 'ACTIVE');
    await flush();
    const text = confirmDialog()!.textContent!;
    expect(text).toContain('Chỉ bật khi đã có đủ: hợp đồng với đơn vị có giấy phép xử lý chất thải nguy hại, văn bản trả lời của Sở NN&MT, và bản Mini App mới đã lên.');
    expect(text).toContain('Kho nhận ngay mọi món đang nhận; đại lý chỉ nhận khi điểm có món này.');
    answerConfirm(false);
    await flush();
    expect(callsTo(api, '/admin/waste/items/i5', 'PATCH')).toHaveLength(0);
    selectValue(c.querySelector('select[aria-label="Trạng thái Pin đã dùng"]'), 'ACTIVE');
    await flush();
    answerConfirm(true);
    await flush();
    const patch = callsTo(api, '/admin/waste/items/i5', 'PATCH');
    expect(patch).toHaveLength(1);
    expect(body(patch[0]!)).toEqual({ status: 'ACTIVE' });
  });

  it('bật món nguy hại trong bảng sửa cũng hỏi xác nhận', async () => {
    const { c, api } = await mount();
    click(Array.from(row(c, 'i5').querySelectorAll('button')).find((b) => b.textContent === 'Sửa')!);
    selectValue(c.querySelector('[name="status"]'), 'ACTIVE');
    click(saveBtn(c));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Chỉ bật khi đã có đủ: hợp đồng với đơn vị có giấy phép');
    answerConfirm(true);
    await flush();
    expect(body(callsTo(api, '/admin/waste/items/i5', 'PATCH')[0]!)).toEqual({ status: 'ACTIVE' });
  });

  it('bật cờ nguy hại cho món ĐANG Đang nhận: sau hộp đánh dấu còn hộp điều kiện bật; không đổi trạng thái vẫn hỏi', async () => {
    const { c, api } = await mount();
    click(Array.from(row(c, 'i2').querySelectorAll('button')).find((b) => b.textContent === 'Sửa')!);
    click(field(c, 'hazardous'));
    click(saveBtn(c));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Không bỏ được cờ này sau khi lưu');
    answerConfirm(true);
    await flush();
    expect(confirmDialog()!.textContent).toContain('Chỉ bật khi đã có đủ: hợp đồng với đơn vị có giấy phép');
    answerConfirm(false);
    await flush();
    expect(callsTo(api, '/admin/waste/items/i2', 'PATCH')).toHaveLength(0);
  });

  it('tắt món nguy hại kèm gắn cờ trong cùng lần lưu thì không hỏi điều kiện bật; hộp bật nhắc chưa gắn cho đại lý', async () => {
    const { c, api } = await mount();
    click(Array.from(row(c, 'i2').querySelectorAll('button')).find((b) => b.textContent === 'Sửa')!);
    click(field(c, 'hazardous'));
    selectValue(c.querySelector('[name="status"]'), 'HIDDEN');
    click(saveBtn(c));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Không bỏ được cờ này sau khi lưu');
    answerConfirm(true);
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(callsTo(api, '/admin/waste/items/i2', 'PATCH')).toHaveLength(1);
    click(Array.from(row(c, 'i5').querySelectorAll('button')).find((b) => b.textContent === 'Sửa')!);
    selectValue(c.querySelector('[name="status"]'), 'ACTIVE');
    click(saveBtn(c));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Chưa gắn món này cho điểm đại lý cho tới khi Sở trả lời về điểm đối tác.');
  });

  it('thêm món: ô trần để trống gửi null; xem trước thẻ khách cập nhật theo ô nhập', async () => {
    const { c, api } = await mount();
    fillNew(c);
    expect(c.textContent).toContain('Hướng dẫn chuẩn bị (không ghi số trần; câu trần do hệ thống dựng)');
    expect(c.textContent).toContain('Chỉ nhập cho món có đầu ra thật: Tubu dùng lại để đóng gói hoặc giao cho bên thu mua có hợp đồng.');
    expect(c.textContent).not.toContain('(5.7)');
    const pv = c.querySelector('[data-item-preview]')!.textContent!;
    expect(pv).toContain('Vỏ hộp sữa');
    expect(pv).toContain('5 vỏ = 1.000 điểm');
    click(saveBtn(c));
    await flush();
    const post = callsTo(api, '/admin/waste/items', 'POST');
    expect(post).toHaveLength(1);
    expect(body(post[0]!)).toEqual({
      code: 'MILK2', name: 'Vỏ hộp sữa', unitLabel: 'vỏ', unitsPerPoint: 5, pointsPerGroup: 1000, dropsPerUnit: 0,
      dailyCapQty: null, monthlyCapQty: 300, status: 'HIDDEN', prepInstructions: null, imageUrl: null, gramsPerUnit: null, hazardous: false,
    });
  });

  it('đánh dấu nguy hại hỏi xác nhận vì không hoàn tác được', async () => {
    const { c, api } = await mount();
    fillNew(c);
    click(field(c, 'hazardous'));
    expect(c.querySelector<HTMLOptionElement>('[name="status"] option[value="ACTIVE"]')!.disabled).toBe(false);
    click(saveBtn(c));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Không bỏ được cờ này sau khi lưu');
    answerConfirm(false);
    await flush();
    expect(callsTo(api, '/admin/waste/items', 'POST')).toHaveLength(0);
    click(saveBtn(c));
    await flush();
    answerConfirm(true);
    await flush();
    const post = callsTo(api, '/admin/waste/items', 'POST');
    expect(post).toHaveLength(1);
    expect(body(post[0]!)).toMatchObject({ hazardous: true, status: 'HIDDEN' });
  });

  it('số không hợp lệ khoá nút Lưu', async () => {
    const { c } = await mount();
    fillNew(c);
    typeInto(field(c, 'unitsPerPoint'), '0');
    expect(c.textContent).toContain('Số đơn vị mỗi mức quy đổi là số nguyên từ 1');
    expect(saveBtn(c).disabled).toBe(true);
    typeInto(field(c, 'unitsPerPoint'), '5');
    expect(saveBtn(c).disabled).toBe(false);
    typeInto(field(c, 'gramsPerUnit'), '2.5');
    expect(c.textContent).toContain('Trọng lượng là số nguyên gram');
    expect(saveBtn(c).disabled).toBe(true);
    typeInto(field(c, 'gramsPerUnit'), '');
    typeInto(field(c, 'dropsPerUnit'), '-1');
    expect(c.textContent).toContain('Giọt nước là số nguyên từ 0');
    expect(saveBtn(c).disabled).toBe(true);
  });

  it('đổi thứ tự: Lên ở dòng thứ hai gửi PUT order', async () => {
    const { c, api } = await mount();
    click(c.querySelector('button[aria-label="Đưa Vỏ hộp sữa lên"]'));
    await flush();
    const put = callsTo(api, '/admin/waste/items/order', 'PUT');
    expect(put).toHaveLength(1);
    expect(body(put[0]!)).toEqual({ ids: ['i2', 'i1', 'i5'] });
  });

  it('lỗi API hiện nguyên văn', async () => {
    const { c } = await mount({ status: 400, body: { message: 'Không gỡ được cờ nguy hại của món.' } });
    selectValue(c.querySelector('select[aria-label="Trạng thái Vỏ hộp sữa"]'), 'HIDDEN');
    await flush();
    expect(c.querySelector('[role="alert"]')!.textContent).toContain('Không gỡ được cờ nguy hại của món.');
  });

  it('không có trường CO2e và không có chữ cấm', async () => {
    const { c } = await mount();
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Thêm món')!);
    expect(Array.from(c.querySelectorAll('[name]')).filter((e) => /co2/i.test(e.getAttribute('name')!))).toHaveLength(0);
    expectNoBannedCopy(c.textContent);
  });
});
