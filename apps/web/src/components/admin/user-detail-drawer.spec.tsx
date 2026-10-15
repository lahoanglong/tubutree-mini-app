// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { UserDetailDrawer } from './user-detail-drawer';
import { flush, render, type Rendered } from '@/test-utils/dom';
import type { AdminUserDetail } from '@/lib/admin-client';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const DETAIL: AdminUserDetail = {
  user: {
    id: 'u1',
    fullName: 'Nguyễn Văn An',
    phone: '0944444444',
    email: null,
    role: 'CUSTOMER',
    staffPermissions: [],
    referralCode: null,
    pointsBalance: 55,
    pointsConvertedBalance: 0,
    walletBalance: 220000,
    isBlocked: false,
    blockedAt: null,
    blockedReason: null,
    createdAt: '2026-09-01T03:00:00.000Z',
    tier: null,
  },
  orders: { items: [], total: 0 },
  wallet: [
    { id: 'w1', delta: 220000, balanceAfter: 220000, type: 'ORDER_REFUND', refType: 'ORDER', refId: 'o1', reason: 'Hoàn tiền trả hàng đơn TUBU2026101538731', createdAt: '2026-10-15T03:00:00.000Z' },
    { id: 'w2', delta: -50000, balanceAfter: 170000, type: 'WITHDRAW', refType: null, refId: null, reason: null, createdAt: '2026-10-15T04:00:00.000Z' },
  ],
  points: [
    { id: 'p1', delta: -22, reason: 'RETURN_REVERSED:TUBU2026101538731', refType: 'ORDER', refId: 'o1', lot: 'STANDARD', expiresAt: null, createdAt: '2026-10-15T03:00:00.000Z' },
    { id: 'p2', delta: 24, reason: 'ORDER_DELIVERED:TUBU2026101546241', refType: 'ORDER', refId: 'o2', lot: 'STANDARD', expiresAt: '2027-10-15T03:00:00.000Z', createdAt: '2026-10-14T03:00:00.000Z' },
    { id: 'p3', delta: 5, reason: 'MERGED:guest-1:STOREFRONT_QUEST:PROFILE', refType: 'QUEST', refId: null, lot: 'STANDARD', expiresAt: null, createdAt: '2026-10-13T03:00:00.000Z' },
    { id: 'p4', delta: 1, reason: 'MAI_MOI_LA:abc', refType: null, refId: null, lot: 'STANDARD', expiresAt: null, createdAt: '2026-10-12T03:00:00.000Z' },
  ],
  roleHistory: [],
  blockHistory: [],
  grants: [],
};

async function open() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(DETAIL), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
  const r = render(<UserDetailDrawer userId="u1" isAdmin onClose={() => undefined} />);
  mounted.push(r);
  await flush();
  return document.body;
}

const section = (root: HTMLElement, title: string) => root.querySelector(`section[aria-label="${title}"]`)!;

describe('UserDetailDrawer — sổ Điểm Xanh và sổ ví đọc được bằng tiếng Việt (R5-ADMIN-4)', () => {
  it('Điểm Xanh: nhãn tiếng Việt kèm mã đơn, không còn mã kỹ thuật ORDER_DELIVERED:… / RETURN_REVERSED:…', async () => {
    const body = await open();
    const text = section(body, 'Điểm Xanh').textContent ?? '';
    expect(text).toContain('Thu hồi điểm của đơn trả hàng · TUBU2026101538731');
    expect(text).toContain('Tích điểm từ đơn hàng · TUBU2026101546241');
    expect(text).toContain('Thưởng nhiệm vụ gian hàng');
    expect(text).not.toMatch(/ORDER_DELIVERED|RETURN_REVERSED|STOREFRONT_QUEST|MERGED/);
  });

  it('mã chưa biết hiện nhãn chung, không lộ mã; số điểm và hạn vẫn đúng', async () => {
    const body = await open();
    const text = section(body, 'Điểm Xanh').textContent ?? '';
    expect(text).toContain('Điều chỉnh Điểm Xanh');
    expect(text).not.toContain('MAI_MOI_LA');
    expect(text).toContain('-22');
    expect(text).toContain('+24');
    expect(text).toContain('hết hạn');
  });

  it('Sổ ví: lý do tiếng Việt giữ nguyên; dòng không có lý do hiện nhãn theo loại thay vì mã WITHDRAW', async () => {
    const body = await open();
    const text = section(body, 'Sổ ví').textContent ?? '';
    expect(text).toContain('Hoàn tiền trả hàng đơn TUBU2026101538731');
    expect(text).toContain('Rút về ngân hàng');
    expect(text).not.toContain('WITHDRAW');
  });

  it('nhãn dài kèm mã đơn ngắt dòng trong ô của nó, số điểm/số tiền luôn nằm bên phải (không rớt xuống dòng dưới)', async () => {
    const body = await open();
    for (const title of ['Điểm Xanh', 'Sổ ví']) {
      const rows = [...section(body, title).querySelectorAll('li')];
      expect(rows.length).toBeGreaterThan(0);
      for (const li of rows) {
        expect(li.className).not.toContain('flex-wrap');
        expect(li.children[0]!.className).toContain('min-w-0 flex-1 break-words');
        expect(li.children[1]!.className).toContain('shrink-0');
      }
    }
  });
});
