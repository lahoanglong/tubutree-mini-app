// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShiftApprovalTab } from './shift-approval-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

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

const staff = { id: 's1', fullName: 'Lan', phone: '0911111111', avatarUrl: null };
const shift = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id,
  staffId: 's1',
  staff,
  workDate: '2026-10-19T00:00:00.000Z',
  startAt: '2026-10-19T01:00:00.000Z',
  endAt: '2026-10-19T05:00:00.000Z',
  templateId: null,
  status,
  approvedStart: null,
  approvedEnd: null,
  rejectReason: null,
  cancelReason: null,
  isEmergency: false,
  evidenceUrl: null,
  cancelPenalty: false,
  ...over,
});

function stub(shifts: unknown[], templates: unknown[] = []) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (init?.method === 'POST' && url.includes('bulk-approve')) return json({ approved: 2 });
      if (init?.method === 'POST' && url.includes('/approve')) return json({ approved: true });
      if (init?.method === 'POST' && url.includes('/reject')) return json({ rejected: true });
      if (init?.method === 'POST' && url.includes('/admin/shift-templates')) return json({ id: 't9' });
      if (init?.method === 'DELETE') return json({ deleted: true });
      if (url.includes('/admin/shift-templates')) return json(templates);
      return json(shifts);
    }),
  );
  return { to: (p: string, m = 'POST') => calls.filter((c) => c.url.includes(p) && c.init?.method === m) };
}

describe('ShiftApprovalTab (Duyệt ca)', () => {
  it('gom ca theo nhân viên, hiện giờ và trạng thái; chỉ ca chờ duyệt có nút thao tác', async () => {
    stub([shift('a', 'PENDING'), shift('b', 'APPROVED')]);
    const { container } = mount(<ShiftApprovalTab />);
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('Lan');
    expect(t).toContain('08:00–12:00');
    expect(t).toContain('Chờ duyệt');
    expect(t).toContain('Đã duyệt');
    expect(container.querySelectorAll('[aria-label^="Duyệt ca"]')).toHaveLength(1);
  });

  it('duyệt một ca gọi POST /approve không kèm giờ', async () => {
    const api = stub([shift('a', 'PENDING')]);
    const { container } = mount(<ShiftApprovalTab />);
    await flush();
    click(container.querySelector('[aria-label^="Duyệt ca"]'));
    await flush();
    expect(api.to('/admin/shifts/a/approve')).toHaveLength(1);
    expect(JSON.parse(api.to('/admin/shifts/a/approve')[0]!.init!.body as string)).toEqual({});
    expect(container.textContent).toContain('Đã duyệt ca.');
  });

  it('từ chối bắt buộc có lý do; huỷ hộp thoại thì không gọi API', async () => {
    const api = stub([shift('a', 'PENDING')]);
    const { container } = mount(<ShiftApprovalTab />);
    await flush();
    click(container.querySelector('[aria-label^="Từ chối ca"]'));
    await flush();
    const accept = confirmDialog()!.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!;
    expect(accept.disabled).toBe(true);
    answerConfirm(false);
    await flush();
    expect(api.to('/reject')).toHaveLength(0);
    click(container.querySelector('[aria-label^="Từ chối ca"]'));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), 'Trùng lịch');
    answerConfirm(true);
    await flush();
    expect(JSON.parse(api.to('/admin/shifts/a/reject')[0]!.init!.body as string)).toEqual({ reason: 'Trùng lịch' });
  });

  it('duyệt hàng loạt gửi đúng danh sách ca chờ', async () => {
    const api = stub([shift('a', 'PENDING'), shift('b', 'PENDING'), shift('c', 'REJECTED')]);
    const { container } = mount(<ShiftApprovalTab />);
    await flush();
    click(byText(container, 'button', 'Duyệt tất cả (2)'));
    await flush();
    expect(JSON.parse(api.to('/bulk-approve')[0]!.init!.body as string)).toEqual({ ids: ['a', 'b'] });
    expect(container.textContent).toContain('Đã duyệt 2 ca.');
  });

  it('chỉnh giờ rồi duyệt gửi approvedStart/approvedEnd theo giờ VN', async () => {
    const api = stub([shift('a', 'PENDING')]);
    const { container } = mount(<ShiftApprovalTab />);
    await flush();
    click(container.querySelector('[aria-label^="Chỉnh giờ"]'));
    await flush();
    const inputs = document.querySelectorAll<HTMLInputElement>('[role=dialog] input');
    typeInto(inputs[0]!, '09:00');
    typeInto(inputs[1]!, '13:30');
    click(byText(document.body, 'button', 'Duyệt với giờ đã chỉnh'));
    await flush();
    expect(JSON.parse(api.to('/admin/shifts/a/approve')[0]!.init!.body as string)).toEqual({
      approvedStart: '2026-10-19T02:00:00.000Z',
      approvedEnd: '2026-10-19T06:30:00.000Z',
    });
  });

  it('ca chuẩn: liệt kê, thêm và xoá', async () => {
    const api = stub([], [{ id: 't1', name: 'Ca sáng', startMin: 480, endMin: 720, active: true, sortOrder: 0 }]);
    const { container } = mount(<ShiftApprovalTab />);
    await flush();
    click(byText(container, 'button', 'Ca chuẩn'));
    await flush();
    expect(document.body.textContent).toContain('Ca sáng · 08:00–12:00');
    typeInto(document.querySelector('[role=dialog] input[placeholder^="Tên ca"]'), 'Ca chiều');
    click(byText(document.body, 'button', 'Thêm ca chuẩn'));
    await flush();
    expect(JSON.parse(api.to('/admin/shift-templates')[0]!.init!.body as string)).toEqual({ name: 'Ca chiều', startMin: 480, endMin: 720 });
    click(document.querySelector('[aria-label="Xoá ca chuẩn Ca sáng"]'));
    await flush();
    expect(api.to('/admin/shift-templates/t1', 'DELETE')).toHaveLength(1);
  });

  it('tuần không có ca và lỗi tải', async () => {
    stub([]);
    const a = mount(<ShiftApprovalTab />);
    await flush();
    expect(a.container.textContent).toContain('Không có ca nào trong tuần này');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Hỏng' }), { status: 500 })));
    const b = mount(<ShiftApprovalTab />);
    await flush();
    expect(b.container.querySelector('[role=alert]')).not.toBeNull();
  });
});
