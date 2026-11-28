// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdminOrder, AdminOrderStaffNote } from '@/lib/admin-client';
import { OrderStaffNotePanel } from './order-staff-note';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

const NOTE: AdminOrderStaffNote = { note: 'Gói thêm xốp', updatedAt: '2026-11-28T07:00:00.000Z', updatedById: 'c1', updatedByName: 'Lan CSKH' };
const order = (o: { status?: string; staffNote?: AdminOrderStaffNote | null }) =>
  ({ id: 'o1', code: 'TB1', status: o.status ?? 'CONFIRMED', staffNote: o.staffNote ?? null }) as unknown as AdminOrder;

interface Call {
  method: string;
  url: string;
  body: unknown;
}
let calls: Call[] = [];
let mounted: Rendered[] = [];

function stub(put: () => { status: number; body: unknown } = () => ({ status: 200, body: { orderId: 'o1', code: 'TB1', changed: true, staffNote: NOTE } })) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const res = method === 'PUT' ? put() : { status: 200, body: {} };
      return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

function mount(o: AdminOrder, canEdit: boolean) {
  const r = render(<OrderStaffNotePanel order={o} canEdit={canEdit} />);
  mounted.push(r);
  return r.container;
}

describe('OrderStaffNotePanel — ghi chú nội bộ cho kho (w51-01)', () => {
  it('chưa có ghi chú và không được sửa (kho, kế toán): không chiếm chỗ', () => {
    stub();
    expect(mount(order({}), false).querySelector('[data-staff-note]')).toBeNull();
  });

  it('có ghi chú: ai xem đơn cũng đọc được kèm người lưu, không có nút sửa khi không có quyền', () => {
    stub();
    const root = mount(order({ staffNote: NOTE }), false);
    const box = root.querySelector('[data-staff-note]')!;
    expect(box.textContent).toContain('Gói thêm xốp');
    expect(box.textContent).toContain('Lan CSKH');
    expect(byText(root, 'button', 'Sửa')).toBeNull();
  });

  it.each(['DELIVERED', 'CANCELLED', 'RETURNED'])('đơn %s: chỉ đọc dù có quyền', (status) => {
    stub();
    const withNote = mount(order({ status, staffNote: NOTE }), true);
    expect(byText(withNote, 'button', 'Sửa')).toBeNull();
    expect(mount(order({ status }), true).querySelector('[data-staff-note]')).toBeNull();
  });

  it('thêm ghi chú: PUT đúng đơn, chữ đã cắt khoảng trắng, mốc null; xong báo đã lưu', async () => {
    stub();
    const root = mount(order({}), true);
    click(byText(root, 'button', 'Thêm ghi chú'));
    typeInto(root.querySelector('textarea[name="staffNote"]'), '  Gói thêm xốp  ');
    click(byText(root, 'button[type=submit]', 'Lưu'));
    await flush();
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('/admin/orders/o1/staff-note');
    expect(put.body).toEqual({ note: 'Gói thêm xốp', baseUpdatedAt: null });
    expect(root.querySelector('[role=status]')!.textContent).toContain('Đã lưu ghi chú cho kho.');
  });

  it('danh sách đơn tải lại giữa lúc soạn (mang bản của đồng nghiệp): vẫn gửi mốc lúc bấm Sửa để máy chủ trả 409', async () => {
    stub();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const r = render(<OrderStaffNotePanel order={order({ staffNote: NOTE })} canEdit />, client);
    mounted.push(r);
    click(byText(r.container, 'button', 'Sửa'));
    typeInto(r.container.querySelector('textarea[name="staffNote"]'), 'Bản của tôi');
    const theirs: AdminOrderStaffNote = { ...NOTE, note: 'Bản đồng nghiệp', updatedAt: '2026-11-28T07:05:00.000Z' };
    act(() =>
      r.root.render(
        <QueryClientProvider client={client}>
          <OrderStaffNotePanel order={order({ staffNote: theirs })} canEdit />
        </QueryClientProvider>,
      ),
    );
    expect(r.container.querySelector<HTMLTextAreaElement>('textarea[name="staffNote"]')!.value).toBe('Bản của tôi');
    click(byText(r.container, 'button[type=submit]', 'Lưu'));
    await flush();
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ note: 'Bản của tôi', baseUpdatedAt: NOTE.updatedAt });
  });

  it('sửa ghi chú: gửi mốc bản đang thấy; 409 thì hiện câu của máy chủ', async () => {
    stub(() => ({ status: 409, body: { statusCode: 409, message: 'Ghi chú nội bộ của đơn này vừa được người khác sửa. Tải lại để xem bản mới.' } }));
    const root = mount(order({ staffNote: NOTE }), true);
    click(byText(root, 'button', 'Sửa'));
    typeInto(root.querySelector('textarea[name="staffNote"]'), 'Gọi khách trước');
    click(byText(root, 'button[type=submit]', 'Lưu'));
    await flush();
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ note: 'Gọi khách trước', baseUpdatedAt: NOTE.updatedAt });
    expect(root.querySelector('[role=alert]')!.textContent).toContain('vừa được người khác sửa');
  });
});
