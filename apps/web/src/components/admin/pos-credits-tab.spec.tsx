// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PosCreditsTab } from './pos-credits-tab';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CREDIT = {
  id: 'c1',
  receiptId: 'HD-001',
  orderTotal: 250_000,
  points: 25,
  multiplier: 1,
  note: null,
  dayKey: '2026-10-10',
  createdAt: '2026-10-10T03:00:00.000Z',
  staff: { id: 'staff1', name: 'Thu Hà', phone: '0900000002' },
  member: { id: 'mem1', name: 'Nguyễn An', phone: '0900000001', memberCode: 'TB-AN01' },
};
const USERS = {
  data: [{ id: 'staff9', fullName: 'Lê Bình', phone: '0911111111', role: 'STAFF', pointsBalance: 0, createdAt: '2026-01-01T00:00:00.000Z' }],
  meta: { page: 1, limit: 8, total: 1 },
};

function setup() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const body = url.includes('/admin/users') ? USERS : [CREDIT];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  const r = render(<PosCreditsTab />);
  mounted.push(r);
  return { ...r, calls };
}

// C-092 (A1-031): bộ lọc nhân viên / thành viên bắt admin dán userId thô.
describe('PosCreditsTab — lọc theo người', () => {
  it('không còn ô nhập userId thô: có ô tìm người theo SĐT/tên', async () => {
    const { container } = setup();
    await flush();
    expect(container.querySelector('input[placeholder="userId nhân viên"]')).toBeNull();
    expect(container.querySelector('input[placeholder="userId thành viên"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Lọc theo nhân viên"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Lọc theo thành viên"]')).not.toBeNull();
  });

  it('gõ SĐT/tên nhân viên → chọn → lọc sổ theo đúng id, hiện nhãn đã chọn', async () => {
    const { container, calls } = setup();
    await flush();
    typeInto(container.querySelector('input[aria-label="Lọc theo nhân viên"]'), 'Bình');
    await new Promise((r) => setTimeout(r, 320));
    await flush();
    click(container.querySelector('[role="option"]'));
    await flush();
    expect(calls.at(-1)).toContain('staffUserId=staff9');
    expect(container.textContent).toContain('Lê Bình · 0911111111');
  });

  it('bấm tên thành viên trong bảng vẫn lọc nhanh; "Xoá lọc" bỏ cả hai', async () => {
    const { container, calls } = setup();
    await flush();
    click(byText(container, 'button', 'Nguyễn An'));
    await flush();
    expect(calls.at(-1)).toContain('memberId=mem1');
    expect(container.textContent).toContain('Nguyễn An · 0900000001');
    click(byText(container, 'button', 'Xoá lọc'));
    await flush();
    expect(calls.at(-1)).not.toContain('memberId=');
    expect(calls.at(-1)).not.toContain('day=');
  });
});
