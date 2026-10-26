// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { UsersList } from './users-list';
import { click, render, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';
import type { AdminUser } from '@/lib/admin-client';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const USERS: AdminUser[] = [
  { id: 'u1', fullName: 'Chủ Gian Hàng Một', phone: '0900000001', role: 'DEALER', pointsBalance: 120, pointsConvertedBalance: 30, createdAt: '2026-10-01T03:00:00.000Z', isBlocked: false },
  { id: 'u2', fullName: null, phone: '0900000002', role: 'CUSTOMER', pointsBalance: 0, createdAt: '2026-10-02T03:00:00.000Z', isBlocked: true, blockedReason: 'farm voucher nhiều tài khoản' },
];

function setup(over: Partial<React.ComponentProps<typeof UsersList>> = {}) {
  const handlers = { onOpenDetail: vi.fn(), onBlock: vi.fn(), onUnblock: vi.fn() };
  const r = render(<UsersList users={USERS} isAdmin narrow={false} blockBusy={false} unblockBusy={false} {...handlers} {...over} />);
  mounted.push(r);
  return { root: r.container, ...handlers };
}

describe('UsersList — R4-ADMIN-12', () => {
  it('màn rộng: cột Trạng thái chỉ nói trạng thái, nút Khoá / Mở khoá ở cột Thao tác riêng', () => {
    const { root, onBlock, onUnblock, onOpenDetail } = setup();
    expect(root.querySelector('table')).not.toBeNull();
    expect(Array.from(root.querySelectorAll('th')).map((h) => h.textContent)).toEqual(['Tên', 'SĐT', 'Vai trò', 'Điểm', 'Ngày', 'Trạng thái', 'Thao tác']);
    const statusCells = Array.from(root.querySelectorAll('tbody tr')).map((r) => r.querySelectorAll('td')[5]!);
    for (const c of statusCells) expect(c.querySelector('button')).toBeNull();
    click(root.querySelector('[aria-label="Khoá Chủ Gian Hàng Một"]'));
    expect(onBlock).toHaveBeenCalledWith(USERS[0]);
    click(root.querySelector('[aria-label="Mở khoá 0900000002"]'));
    expect(onUnblock).toHaveBeenCalledWith(USERS[1]);
    click(root.querySelector('[aria-label="Xem chi tiết Chủ Gian Hàng Một"]'));
    expect(onOpenDetail).toHaveBeenCalledWith('u1');
    expect(unnamedControls(root)).toEqual([]);
  });

  it('màn hẹp: mỗi người dùng một thẻ — tên nguyên cụm, SĐT, vai trò, điểm, ngày, nhãn "Đã khoá" cùng lý do và nút; không còn bảng cuộn ngang', () => {
    const { root, onBlock, onUnblock, onOpenDetail } = setup({ narrow: true });
    expect(root.querySelector('table')).toBeNull();
    expect(root.querySelector('[role="region"]')).toBeNull();
    const cards = Array.from(root.querySelectorAll('ul[aria-label="Danh sách người dùng"] > li'));
    expect(cards).toHaveLength(2);

    const active = cards[0]!;
    expect(active.textContent).toContain('Chủ Gian Hàng Một');
    expect(active.textContent).toContain('0900000001');
    expect(active.textContent).toContain('Đại lý');
    expect(active.textContent).toContain('150');
    expect(active.textContent).toContain('01/10/2026');
    expect(active.textContent).not.toContain('Đã khoá');

    const blocked = cards[1]!;
    expect(blocked.textContent).toContain('0900000002');
    expect(blocked.textContent).toContain('Khách hàng');
    expect(blocked.textContent).toContain('Đã khoá');
    expect(blocked.textContent).toContain('Lý do: farm voucher nhiều tài khoản');

    click(active.querySelector('[aria-label="Khoá Chủ Gian Hàng Một"]'));
    expect(onBlock).toHaveBeenCalledWith(USERS[0]);
    click(blocked.querySelector('[aria-label="Mở khoá 0900000002"]'));
    expect(onUnblock).toHaveBeenCalledWith(USERS[1]);
    click(active.querySelector('[aria-label="Xem chi tiết Chủ Gian Hàng Một"]'));
    expect(onOpenDetail).toHaveBeenCalledWith('u1');
    expect(unnamedControls(root)).toEqual([]);
  });

  it('nhân viên (không phải admin) chỉ thấy trạng thái, không có nút khoá, ở cả hai bố cục', () => {
    for (const narrow of [false, true]) {
      const { root } = setup({ isAdmin: false, narrow });
      expect(root.textContent).toContain('Đang hoạt động');
      expect(root.textContent).toContain('Đã khoá');
      expect(root.querySelector('[aria-label^="Khoá "]')).toBeNull();
      expect(root.querySelector('[aria-label^="Mở khoá "]')).toBeNull();
      mounted.pop()!.unmount();
    }
  });

  it('đang xử lý khoá thì nút khoá bị vô hiệu để không bấm hai lần', () => {
    const { root } = setup({ narrow: true, blockBusy: true, unblockBusy: true });
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Khoá Chủ Gian Hàng Một"]')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Mở khoá 0900000002"]')!.disabled).toBe(true);
  });
});

// D7-07 / D7-11: số điểm lớn đọc lướt dễ nhầm nếu thiếu dấu chấm; vai trò hiện nhãn tiếng Việt, không lộ mã enum.
describe('UsersList — định dạng điểm và nhãn vai trò (D7-07)', () => {
  const BIG: AdminUser[] = [
    { id: 'u9', fullName: 'Khách Điểm Lớn', phone: '0900000009', role: 'AFFILIATE', pointsBalance: 100_000, pointsConvertedBalance: 30_000, createdAt: '2026-10-01T03:00:00.000Z', isBlocked: false },
  ];

  it.each([false, true])('narrow=%s: tổng điểm 130.000 có dấu chấm ngăn cách, vai trò là "CTV"', (narrow) => {
    const { root } = setup({ users: BIG, narrow });
    const text = root.textContent ?? '';
    expect(text).toContain('130.000');
    expect(text).not.toContain('130000');
    expect(text).toContain('CTV');
    expect(text).not.toContain('AFFILIATE');
  });
});
