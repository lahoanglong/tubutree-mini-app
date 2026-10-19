// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffRosterTab } from './staff-roster-tab';
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

const LIST = {
  members: [
    { id: 'u1', phone: '0911111111', fullName: 'Lan', avatarUrl: null, role: 'STAFF', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'u2', phone: '0922222222', fullName: null, avatarUrl: null, role: 'ADMIN', createdAt: '2026-10-01T00:00:00Z' },
  ],
  pendingInvites: [{ phone: '0933333333', role: 'STAFF', createdAt: '2026-10-02T00:00:00Z' }],
};

function stub(over: { list?: unknown; listStatus?: number; revoke?: unknown } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/admin/staff/grant')) return json({ granted: 'STAFF', applied: false });
      if (url.includes('/admin/staff/revoke')) return json(over.revoke ?? { revoked: 1, downgraded: true });
      return json(over.list ?? LIST, over.listStatus ?? 200);
    }),
  );
  return { posts: (p: string) => calls.filter((c) => c.url.includes(p) && c.init?.method === 'POST') };
}

describe('StaffRosterTab (Nhân sự)', () => {
  it('liệt kê thành viên, vai trò và lời mời chờ mở app', async () => {
    stub();
    const { container } = mount(<StaffRosterTab />);
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('Lan');
    expect(t).toContain('Chưa có tên');
    expect(t).toContain('Quản trị');
    expect(t).toContain('Chờ mở app');
    expect(t).toContain('0933333333');
  });

  it('nút Lưu quyền khoá tới khi SĐT hợp lệ; cấp STAFF gửi đúng body, báo "sẽ áp khi họ mở app"', async () => {
    const api = stub();
    const { container } = mount(<StaffRosterTab />);
    await flush();
    const save = byText(container, 'button', 'Lưu quyền') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    typeInto(container.querySelector('input[type=tel]'), '0944444444');
    expect(save.disabled).toBe(false);
    click(save);
    await flush();
    expect(JSON.parse(api.posts('/admin/staff/grant')[0]!.init!.body as string)).toEqual({ phone: '0944444444', role: 'STAFF' });
    expect(container.textContent).toContain('Đã lưu quyền (sẽ áp khi họ mở app).');
  });

  it('cấp ADMIN phải xác nhận: huỷ thì KHÔNG gọi API, đồng ý thì gửi role ADMIN', async () => {
    const api = stub();
    const { container } = mount(<StaffRosterTab />);
    await flush();
    typeInto(container.querySelector('input[type=tel]'), '0944444444');
    click(byText(container, 'button', 'Quản trị'));
    click(byText(container, 'button', 'Lưu quyền'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('cấp quyền ADMIN (toàn quyền quản trị) cho SĐT 0944444444');
    answerConfirm(false);
    await flush();
    expect(api.posts('/admin/staff/grant')).toHaveLength(0);
    click(byText(container, 'button', 'Lưu quyền'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(JSON.parse(api.posts('/admin/staff/grant')[0]!.init!.body as string)).toEqual({ phone: '0944444444', role: 'ADMIN' });
  });

  it('thu hồi có xác nhận; huỷ lời mời chờ thì gọi thẳng revoke theo SĐT', async () => {
    const api = stub();
    const { container } = mount(<StaffRosterTab />);
    await flush();
    click(container.querySelector('[aria-label="Thu hồi · Lan"]'));
    await flush();
    answerConfirm(false);
    await flush();
    expect(api.posts('/admin/staff/revoke')).toHaveLength(0);
    click(container.querySelector('[aria-label="Thu hồi · Lan"]'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(JSON.parse(api.posts('/admin/staff/revoke')[0]!.init!.body as string)).toEqual({ phone: '0911111111' });
    expect(container.textContent).toContain('Đã thu hồi quyền.');
    click(container.querySelector('[aria-label="Huỷ lời mời · 0933333333"]'));
    await flush();
    expect(JSON.parse(api.posts('/admin/staff/revoke')[1]!.init!.body as string)).toEqual({ phone: '0933333333' });
  });

  it('thu hồi mà gian hàng đối tác còn việc dở: cảnh báo storeBlocked, không báo thành công', async () => {
    stub({ revoke: { revoked: 1, downgraded: true, storeBlocked: true } });
    const { container } = mount(<StaffRosterTab />);
    await flush();
    click(container.querySelector('[aria-label="Thu hồi · Lan"]'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(container.textContent).toContain('gian hàng đối tác của người này còn việc dở');
    expect(container.textContent).not.toContain('Đã thu hồi quyền.');
  });

  it('rỗng và lỗi tải', async () => {
    stub({ list: { members: [], pendingInvites: [] } });
    const a = mount(<StaffRosterTab />);
    await flush();
    expect(a.container.textContent).toContain('Chưa có nhân sự');
    stub({ list: { message: 'Hỏng' }, listStatus: 500 });
    const b = mount(<StaffRosterTab />);
    await flush();
    expect(b.container.querySelector('[role=alert]')).not.toBeNull();
    expect(b.container.textContent).toContain('Thử lại');
  });
});
