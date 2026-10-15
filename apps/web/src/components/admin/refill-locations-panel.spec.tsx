// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RefillLocationsPanel } from './refill-locations-panel';
import { RefillTab } from './refill-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});
const mount = async (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  await flush();
  return r.container;
};

const LOC = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'l1',
  name: 'Cửa hàng Quận 1',
  address: '12 Lê Lợi, Quận 1',
  hours: '8h–20h',
  phone: '0901234567',
  isActive: true,
  sortOrder: 0,
  ...over,
});
const THREE = [
  LOC(),
  LOC({ id: 'l2', name: 'Kho Thủ Đức', address: '5 Võ Văn Ngân', hours: null, phone: null, sortOrder: 1 }),
  LOC({ id: 'l3', name: 'Điểm cũ', address: '9 Hai Bà Trưng', isActive: false, sortOrder: 2 }),
];

interface Call {
  url: string;
  method: string;
  body: unknown;
}
type Reply = { status?: number; body: unknown };

/** fetch giả theo (method, url): ghi lại mọi lời gọi để assert nội dung gửi đi. */
function stub(handler: (call: Call) => Reply) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const r = handler(call);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}
const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');

const listOnly = (list: unknown) => (c: Call): Reply => (c.method === 'GET' ? { body: list } : { body: LOC() });
const btn = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === label)!;
const field = (c: HTMLElement, label: string) =>
  Array.from(c.querySelectorAll('label')).find((l) => l.textContent?.includes(label))!.querySelector('input')!;
const alertText = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent ?? '';

describe('RefillLocationsPanel — admin quản lý điểm nhận vỏ', () => {
  it('liệt kê đủ điểm theo thứ tự: tên, địa chỉ, giờ, SĐT, trạng thái; đếm số điểm đang bật', async () => {
    stub(listOnly(THREE));
    const c = await mount(<RefillLocationsPanel />);

    expect(c.textContent).toContain('3 điểm · 2 đang bật');
    const items = Array.from(c.querySelectorAll('li'));
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain('#1');
    expect(items[0]!.textContent).toContain('Cửa hàng Quận 1');
    expect(items[0]!.textContent).toContain('12 Lê Lợi, Quận 1');
    expect(items[0]!.textContent).toContain('8h–20h · 0901234567');
    expect(items[0]!.textContent).toContain('Đang bật');
    expect(items[1]!.textContent).not.toContain('·');
    expect(items[2]!.textContent).toContain('Đã tắt');
    expect(unnamedControls(c)).toEqual([]);
  });

  it('chưa có điểm nào: báo khách đang thấy địa chỉ cũ trong Cấu hình', async () => {
    stub(listOnly([]));
    const c = await mount(<RefillLocationsPanel />);

    expect(c.textContent).toContain('Chưa có điểm nhận nào');
    expect(c.textContent).toContain('Cấu hình hệ thống');
  });

  it('có điểm nhưng không điểm nào đang bật: cảnh báo khách sẽ không thấy điểm nào', async () => {
    stub(listOnly([LOC({ isActive: false })]));
    const c = await mount(<RefillLocationsPanel />);

    expect(c.textContent).toContain('Chưa có điểm nào đang bật');
  });

  it('thêm điểm: chặn khi thiếu tên/địa chỉ hoặc SĐT sai, gửi đúng nội dung (đã cắt khoảng trắng) khi hợp lệ', async () => {
    const calls = stub(listOnly([]));
    const c = await mount(<RefillLocationsPanel />);
    click(byText(c, 'button', 'Thêm điểm nhận'));
    await flush();

    click(byText(c, 'button', 'Thêm điểm'));
    await flush();
    expect(alertText(c)).toContain('Nhập tên điểm nhận.');
    expect(writes(calls)).toHaveLength(0);

    typeInto(field(c, 'Tên điểm'), 'Kho Bình Thạnh');
    typeInto(field(c, 'Địa chỉ'), '1 Điện Biên Phủ');
    typeInto(field(c, 'SĐT'), '09012');
    click(byText(c, 'button', 'Thêm điểm'));
    await flush();
    expect(alertText(c)).toContain('SĐT phải là 10 số');
    expect(writes(calls)).toHaveLength(0);

    typeInto(field(c, 'SĐT'), '0901234567');
    typeInto(field(c, 'Giờ mở cửa'), ' 8h–17h ');
    click(byText(c, 'button', 'Thêm điểm'));
    await flush();

    expect(writes(calls)).toEqual([
      {
        url: expect.stringContaining('/admin/refill-locations'),
        method: 'POST',
        body: { name: 'Kho Bình Thạnh', address: '1 Điện Biên Phủ', hours: '8h–17h', phone: '0901234567', isActive: true },
      },
    ]);
    expect(c.querySelector('form')).toBeNull();
  });

  it('lỗi từ API khi thêm hiện nguyên văn trong form và giữ form mở', async () => {
    stub((call) => (call.method === 'POST' ? { status: 400, body: { message: 'Tối đa 50 điểm nhận vỏ.' } } : { body: [] }));
    const c = await mount(<RefillLocationsPanel />);
    click(byText(c, 'button', 'Thêm điểm nhận'));
    await flush();
    typeInto(field(c, 'Tên điểm'), 'A');
    typeInto(field(c, 'Địa chỉ'), 'B');
    click(byText(c, 'button', 'Thêm điểm'));
    await flush();

    expect(alertText(c)).toContain('Tối đa 50 điểm nhận vỏ.');
    expect(c.querySelector('form')).not.toBeNull();
  });

  it('sửa điểm: form có sẵn giá trị cũ, PATCH gửi tên/địa chỉ/giờ/SĐT (xoá giờ = chuỗi rỗng)', async () => {
    const calls = stub(listOnly(THREE));
    const c = await mount(<RefillLocationsPanel />);

    click(Array.from(c.querySelectorAll('li'))[0]!.querySelector('button:not([aria-label])'));
    await flush();
    expect(field(c, 'Địa chỉ').value).toBe('12 Lê Lợi, Quận 1');
    typeInto(field(c, 'Địa chỉ'), 'Địa chỉ mới');
    typeInto(field(c, 'Giờ mở cửa'), '');
    click(byText(c, 'button', 'Lưu thay đổi'));
    await flush();

    expect(writes(calls)).toEqual([
      {
        url: expect.stringContaining('/admin/refill-locations/l1'),
        method: 'PATCH',
        body: { name: 'Cửa hàng Quận 1', address: 'Địa chỉ mới', hours: '', phone: '0901234567' },
      },
    ]);
  });

  it('tắt điểm phải xác nhận: huỷ thì không gọi API; xác nhận thì PATCH isActive=false', async () => {
    const calls = stub(listOnly(THREE));
    const c = await mount(<RefillLocationsPanel />);

    click(byText(c, 'button', 'Tắt điểm'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Khách sẽ không còn thấy và không chọn được điểm này');
    answerConfirm(false);
    await flush();
    expect(writes(calls)).toHaveLength(0);

    click(byText(c, 'button', 'Tắt điểm'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(writes(calls)).toEqual([{ url: expect.stringContaining('/admin/refill-locations/l1'), method: 'PATCH', body: { isActive: false } }]);
  });

  it('bật lại điểm đã tắt không cần xác nhận', async () => {
    const calls = stub(listOnly(THREE));
    const c = await mount(<RefillLocationsPanel />);

    click(byText(c, 'button', 'Bật lại'));
    await flush();

    expect(confirmDialog()).toBeNull();
    expect(writes(calls)).toEqual([{ url: expect.stringContaining('/admin/refill-locations/l3'), method: 'PATCH', body: { isActive: true } }]);
  });

  it('lỗi khi bật/tắt hiện ở đầu danh sách', async () => {
    stub((call) => (call.method === 'PATCH' ? { status: 404, body: { message: 'Không tìm thấy điểm nhận vỏ.' } } : { body: THREE }));
    const c = await mount(<RefillLocationsPanel />);

    click(byText(c, 'button', 'Bật lại'));
    await flush();

    expect(alertText(c)).toContain('Không tìm thấy điểm nhận vỏ.');
  });

  it('chuyển xuống gửi TOÀN BỘ id theo thứ tự mới; hàng đầu không lên được, hàng cuối không xuống được', async () => {
    const calls = stub((call) => (call.method === 'PUT' ? { body: [THREE[1], THREE[0], THREE[2]] } : { body: THREE }));
    const c = await mount(<RefillLocationsPanel />);

    expect(btn(c, 'Chuyển "Cửa hàng Quận 1" lên trên').disabled).toBe(true);
    expect(btn(c, 'Chuyển "Điểm cũ" xuống dưới').disabled).toBe(true);

    click(btn(c, 'Chuyển "Cửa hàng Quận 1" xuống dưới'));
    await flush();

    expect(writes(calls)).toEqual([{ url: expect.stringContaining('/admin/refill-locations/order'), method: 'PUT', body: { ids: ['l2', 'l1', 'l3'] } }]);
    const names = Array.from(c.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(names[0]).toContain('Kho Thủ Đức');
    expect(names[1]).toContain('Cửa hàng Quận 1');
  });

  it('chuyển lên đổi chỗ với điểm ngay trên', async () => {
    const calls = stub((call) => (call.method === 'PUT' ? { body: THREE } : { body: THREE }));
    const c = await mount(<RefillLocationsPanel />);

    click(btn(c, 'Chuyển "Điểm cũ" lên trên'));
    await flush();

    expect(writes(calls)[0]!.body).toEqual({ ids: ['l1', 'l3', 'l2'] });
  });

  it('409 khi sắp xếp (admin khác vừa đổi) → hiện lỗi và tải lại danh sách', async () => {
    const calls = stub((call) =>
      call.method === 'PUT' ? { status: 409, body: { message: 'Danh sách điểm nhận đã thay đổi. Vui lòng tải lại rồi sắp xếp lại.' } } : { body: THREE },
    );
    const c = await mount(<RefillLocationsPanel />);
    expect(calls.filter((x) => x.method === 'GET')).toHaveLength(1);

    click(btn(c, 'Chuyển "Cửa hàng Quận 1" xuống dưới'));
    await flush();

    expect(alertText(c)).toContain('Danh sách điểm nhận đã thay đổi');
    expect(calls.filter((x) => x.method === 'GET')).toHaveLength(2);
  });

  it('không tải được danh sách → báo lỗi', async () => {
    stub(() => ({ status: 500, body: { message: 'x' } }));
    const c = await mount(<RefillLocationsPanel />);

    expect(alertText(c)).toContain('Không tải được danh sách điểm nhận vỏ.');
  });
});

describe('RefillTab — mục Điểm nhận vỏ chỉ dành cho ADMIN', () => {
  const PENDING = [
    {
      id: 'b1',
      quantity: 2,
      seedsAwarded: 20,
      status: 'PENDING',
      createdAt: '2026-10-14T01:00:00.000Z',
      user: { id: 'u1', fullName: 'Lê Cúc', phone: '0922000222' },
      pickupLocation: { id: 'l2', name: 'Kho Thủ Đức', address: '5 Võ Văn Ngân' },
    },
    {
      id: 'b0',
      quantity: 1,
      seedsAwarded: 10,
      status: 'PENDING',
      createdAt: '2026-10-13T01:00:00.000Z',
      user: { id: 'u2', fullName: 'An', phone: null },
      pickupLocation: null,
    },
  ];
  const route = (call: Call): Reply => ({ body: call.url.includes('/refill/admin/pending') ? PENDING : THREE });

  it('nhân viên không thấy mục quản lý điểm; mỗi yêu cầu hiện điểm khách chọn (yêu cầu cũ không có thì bỏ qua)', async () => {
    const calls = stub(route);
    const c = await mount(<RefillTab />);

    expect(byText(c, 'button', 'Điểm nhận vỏ')).toBeNull();
    expect(c.textContent).toContain('Mang tới: Kho Thủ Đức · 5 Võ Văn Ngân');
    expect(c.textContent?.match(/Mang tới/g)).toHaveLength(1);
    expect(calls.some((x) => x.url.includes('/admin/refill-locations'))).toBe(false);
  });

  it('admin chuyển qua mục Điểm nhận vỏ rồi quay lại danh sách chờ duyệt', async () => {
    stub(route);
    const c = await mount(<RefillTab isAdmin />);

    expect(byText(c, 'button', 'Chờ duyệt')!.getAttribute('aria-pressed')).toBe('true');
    click(byText(c, 'button', 'Điểm nhận vỏ'));
    await flush();
    expect(c.textContent).toContain('Cửa hàng Quận 1');
    expect(c.textContent).not.toContain('Lê Cúc');

    click(byText(c, 'button', 'Chờ duyệt'));
    await flush();
    expect(c.textContent).toContain('Lê Cúc');
  });
});
