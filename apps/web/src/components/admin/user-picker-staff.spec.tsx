// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserPicker } from './user-picker';
import { flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

const role = vi.hoisted(() => ({ current: 'STAFF' as string | undefined }));
vi.mock('@/lib/auth-context', () => ({ useViewerRole: () => role.current }));

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const USERS = { data: [{ id: 'u1', fullName: 'Lan', phone: '0912345678', role: 'CUSTOMER', pointsBalance: 0, createdAt: '2026-10-01T00:00:00Z' }], meta: { total: 1, page: 1, limit: 8 } };
const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="search"]');

function open() {
  const api = mockFetch({ '/admin/users': { body: USERS } });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<UserPicker value={null} onChange={() => {}} label="Chọn khách" debounceMs={0} />);
  mounted.push(r);
  return { api, container: r.container };
}

// L1-06: CSKH phải gõ đủ SĐT/mã/3 ký tự tên mới được tra; trước đó ô chọn gọi API từ ký tự thứ 2 và nhận 400 từ máy chủ.
describe('UserPicker với CSKH (STAFF)', () => {
  it('từ khoá chưa đủ chặt: hiện gợi ý, KHÔNG gọi API', async () => {
    role.current = 'STAFF';
    const { api, container } = open();
    typeInto(input(container), '09123');
    await flush();
    expect(api.calls).toHaveLength(0);
    expect(container.textContent).toContain('Số điện thoại cần đủ 10 số');
    typeInto(input(container), 'La');
    await flush();
    expect(api.calls).toHaveLength(0);
  });

  it('SĐT đủ 10 số: gọi API bình thường', async () => {
    role.current = 'STAFF';
    const { api, container } = open();
    typeInto(input(container), '0912345678');
    await flush();
    expect(api.calls).toHaveLength(1);
    expect(container.textContent).toContain('Lan');
  });

  it('ADMIN gõ 2 ký tự vẫn gọi API như cũ', async () => {
    role.current = 'ADMIN';
    const { api, container } = open();
    typeInto(input(container), 'La');
    await flush();
    expect(api.calls).toHaveLength(1);
  });
});
