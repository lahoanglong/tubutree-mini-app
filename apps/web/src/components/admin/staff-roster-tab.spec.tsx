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
    { id: 'u1', phone: '0911111111', fullName: 'Lan', avatarUrl: null, role: 'STAFF', staffPermissions: ['KHO'], createdAt: '2026-10-01T00:00:00Z' },
    { id: 'u2', phone: '0922222222', fullName: null, avatarUrl: null, role: 'ADMIN', staffPermissions: [], createdAt: '2026-10-01T00:00:00Z' },
  ],
  pendingInvites: [{ phone: '0933333333', role: 'STAFF', staffPermissions: ['KE_TOAN'], createdAt: '2026-10-02T00:00:00Z' }],
};

function stub(over: { list?: unknown; listStatus?: number; revoke?: unknown; grant?: unknown } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/admin/staff/grant')) return json(over.grant ?? { granted: 'STAFF', applied: false });
      if (url.includes('/staff-permissions')) return json({ id: 'u1', staffPermissions: [], changed: true });
      if (url.includes('/admin/staff/revoke')) return json(over.revoke ?? { revoked: 1, downgraded: true });
      return json(over.list ?? LIST, over.listStatus ?? 200);
    }),
  );
  return {
    posts: (p: string) => calls.filter((c) => c.url.includes(p) && c.init?.method === 'POST'),
    puts: (p: string) => calls.filter((c) => c.url.includes(p) && c.init?.method === 'PUT'),
  };
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

  it('dòng của chính mình: không có nút Thu hồi, ghi "(bạn)"; dòng người khác vẫn có', async () => {
    stub();
    const { container } = mount(<StaffRosterTab meId="u2" />);
    await flush();
    expect(container.querySelector('[aria-label="Thu hồi · 0922222222"]')).toBeNull();
    expect(container.textContent).toContain('(bạn)');
    expect(container.querySelector('[aria-label="Thu hồi · Lan"]')).not.toBeNull();
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

  it('thẻ nhân viên có nhóm việc đang bật; tick thêm rồi lưu gửi đúng danh sách; quản trị không có ô tick', async () => {
    const api = stub();
    const { container } = mount(<StaffRosterTab />);
    await flush();
    const memberList = container.querySelector('ul')!;
    expect(memberList.querySelectorAll('fieldset')).toHaveLength(1);
    expect(container.textContent).toContain('Quản trị thấy và làm được mọi việc.');
    const boxes = [...memberList.querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]')];
    expect(boxes.map((b) => b.checked)).toEqual([false, true, false, false]);
    const save = byText(memberList, 'button', 'Lưu nhóm việc') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    click(boxes[0]!);
    expect((byText(memberList, 'button', 'Lưu nhóm việc') as HTMLButtonElement).disabled).toBe(false);
    click(byText(memberList, 'button', 'Lưu nhóm việc'));
    await flush();
    expect(JSON.parse(api.puts('/admin/users/u1/staff-permissions')[0]!.init!.body as string)).toEqual({ permissions: ['KHO', 'CSKH'] });
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
    // D7-15: huỷ lời mời cũng hỏi lại (người được mời phải mời lại từ đầu).
    click(container.querySelector('[aria-label="Huỷ lời mời · 0933333333"]'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('0933333333');
    answerConfirm(false);
    await flush();
    expect(api.posts('/admin/staff/revoke')).toHaveLength(1);
    click(container.querySelector('[aria-label="Huỷ lời mời · 0933333333"]'));
    await flush();
    answerConfirm(true);
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

  describe('thêm lại SĐT của người đã là nhân viên (máy chủ thay nhóm cũ bằng nhóm vừa chọn)', () => {
    const hint = (container: HTMLElement) => container.querySelector('form')!.textContent ?? '';

    it('gõ SĐT của nhân viên đang có: hiện nhóm đang có và nói lưu sẽ thay; SĐT lạ thì giữ dòng gợi ý chung', async () => {
      stub();
      const { container } = mount(<StaffRosterTab />);
      await flush();
      expect(hint(container)).toContain('Không chọn nhóm nào: chỉ dùng quầy thu ngân');
      typeInto(container.querySelector('input[type=tel]'), '0911111111');
      expect(hint(container)).toContain('Nhóm đang có: Kho');
      expect(hint(container)).toContain('thay bằng nhóm bạn chọn');
      expect(hint(container)).not.toContain('chỉ dùng quầy thu ngân');
      typeInto(container.querySelector('input[type=tel]'), '0944444444');
      expect(hint(container)).toContain('Không chọn nhóm nào: chỉ dùng quầy thu ngân');
    });

    it('vai trò không đổi mà nhóm đã đổi ngay: báo "Đã đổi nhóm việc của <SĐT> thành ...", không hứa "sẽ áp khi họ mở app"', async () => {
      stub({ grant: { granted: 'STAFF', applied: false, permissionsChanged: true } });
      const { container } = mount(<StaffRosterTab />);
      await flush();
      typeInto(container.querySelector('input[type=tel]'), '0911111111');
      click(byText(container.querySelector('[aria-label="Nhóm việc cho người mới"]') as HTMLElement, 'button', 'Chăm sóc khách'));
      click(byText(container, 'button', 'Lưu quyền'));
      await flush();
      expect(container.textContent).toContain('Đã đổi nhóm việc của 0911111111 thành Chăm sóc khách.');
      expect(container.textContent).not.toContain('sẽ áp khi họ mở app');
    });
  });

  describe('nhóm việc cho người mới và lời mời chờ mở app', () => {
    it('cấp STAFF: chọn nhóm bằng nút bấm, body có permissions theo thứ tự chọn; đổi sang Quản trị thì ẩn nhóm và không gửi', async () => {
      const api = stub();
      const { container } = mount(<StaffRosterTab />);
      await flush();
      const form = container.querySelector('form')!;
      const group = form.querySelector('[role=group][aria-label="Nhóm việc cho người mới"]')!;
      expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Chăm sóc khách', 'Kho', 'Nội dung và khuyến mãi', 'Kế toán']);
      typeInto(container.querySelector('input[type=tel]'), '0944444444');
      click(byText(group, 'button', 'Kho'));
      click(byText(group, 'button', 'Chăm sóc khách'));
      expect(byText(group, 'button', 'Kho')!.getAttribute('aria-pressed')).toBe('true');
      click(byText(container, 'button', 'Lưu quyền'));
      await flush();
      expect(JSON.parse(api.posts('/admin/staff/grant')[0]!.init!.body as string)).toEqual({ phone: '0944444444', role: 'STAFF', permissions: ['KHO', 'CSKH'] });
      // Gửi xong thì chọn lại từ đầu, không kéo nhóm của người trước sang người sau.
      expect([...form.querySelectorAll('[aria-label="Nhóm việc cho người mới"] button[aria-pressed=true]')]).toHaveLength(0);

      typeInto(container.querySelector('input[type=tel]'), '0955555555');
      click(byText(form, 'button', 'Quản trị'));
      expect(form.querySelector('[aria-label="Nhóm việc cho người mới"]')).toBeNull();
    });

    it('đã chọn nhóm rồi đổi sang Quản trị: nhóm không đi theo lời cấp ADMIN', async () => {
      const api = stub();
      const { container } = mount(<StaffRosterTab />);
      await flush();
      typeInto(container.querySelector('input[type=tel]'), '0944444444');
      click(byText(container.querySelector('form')!, 'button', 'Kho'));
      click(byText(container.querySelector('form')!, 'button', 'Quản trị'));
      click(byText(container, 'button', 'Lưu quyền'));
      await flush();
      answerConfirm(true);
      await flush();
      expect(JSON.parse(api.posts('/admin/staff/grant')[0]!.init!.body as string)).toEqual({ phone: '0944444444', role: 'ADMIN' });
    });

    it('lời mời chờ mở app hiện nhóm đã chọn và cho đổi: lưu gửi lại lời cấp cùng SĐT với nhóm mới', async () => {
      const api = stub();
      const { container } = mount(<StaffRosterTab />);
      await flush();
      const invites = container.querySelector('section[aria-label="Chờ mở app"]')!;
      const boxes = [...invites.querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]')];
      expect(boxes.map((b) => b.checked)).toEqual([false, false, false, true]);
      click(boxes[1]!);
      click(byText(invites, 'button', 'Lưu nhóm việc'));
      await flush();
      expect(JSON.parse(api.posts('/admin/staff/grant')[0]!.init!.body as string)).toEqual({ phone: '0933333333', role: 'STAFF', permissions: ['KE_TOAN', 'KHO'] });
      expect(invites.textContent).toContain('Họ nhận đúng nhóm này khi mở app');
    });

    it('lời mời ADMIN không có ô chọn nhóm', async () => {
      stub({ list: { members: [], pendingInvites: [{ phone: '0966666666', role: 'ADMIN', staffPermissions: [], createdAt: '2026-10-02T00:00:00Z' }] } });
      const { container } = mount(<StaffRosterTab />);
      await flush();
      expect(container.querySelector('section[aria-label="Chờ mở app"] fieldset')).toBeNull();
      expect(container.textContent).toContain('0966666666');
    });
  });
});
