// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsersList } from './users-list';
import { click, render, type Rendered } from '@/test-utils/dom';
import type { AdminUser } from '@/lib/admin-client';

// Nút Khoá / Mở khoá đang giữ focus (admin vừa bấm xong hộp xác nhận rồi quay về nút) mà bị `disabled` thì Chromium thả focus về body;
// khi khoá lệnh đang chạy, nút báo bận bằng aria-busy/aria-disabled và handler tự chặn.

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const USERS: AdminUser[] = [
  { id: 'u1', fullName: 'Chủ Gian Hàng Một', phone: '0900000001', role: 'DEALER', pointsBalance: 120, createdAt: '2026-10-01T03:00:00.000Z', isBlocked: false },
  { id: 'u2', fullName: null, phone: '0900000002', role: 'CUSTOMER', pointsBalance: 0, createdAt: '2026-10-02T03:00:00.000Z', isBlocked: true, blockedReason: 'farm voucher' },
];

function setup(over: Partial<React.ComponentProps<typeof UsersList>> = {}) {
  const handlers = { onOpenDetail: vi.fn(), onBlock: vi.fn(), onUnblock: vi.fn() };
  const r = render(<UsersList users={USERS} isAdmin narrow={false} blockBusy={false} unblockBusy={false} {...handlers} {...over} />);
  mounted.push(r);
  return { root: r.container, ...handlers };
}
const blockBtn = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('[aria-label="Khoá Chủ Gian Hàng Một"]')!;
const unblockBtn = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('[aria-label="Mở khoá 0900000002"]')!;

describe.each([false, true])('UsersList: nút Khoá / Mở khoá khi lệnh đang chạy (narrow=%s)', (narrow) => {
  it('Khoá đang chạy: aria-busy + aria-disabled, KHÔNG disabled (giữ focus), chạm vào không gọi onBlock', () => {
    const { root, onBlock } = setup({ narrow, blockBusy: true });
    const b = blockBtn(root);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    click(b);
    expect(onBlock).not.toHaveBeenCalled();
  });

  it('Mở khoá đang chạy: aria-busy + aria-disabled, KHÔNG disabled, chạm vào không gọi onUnblock', () => {
    const { root, onUnblock } = setup({ narrow, unblockBusy: true });
    const b = unblockBtn(root);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    click(b);
    expect(onUnblock).not.toHaveBeenCalled();
  });

  it('Khoá đang chạy không làm nút Mở khoá bận (hai lệnh độc lập), và ngược lại', () => {
    const a = setup({ narrow, blockBusy: true });
    expect(unblockBtn(a.root).getAttribute('aria-busy')).toBeNull();
    expect(unblockBtn(a.root).getAttribute('aria-disabled')).toBeNull();
    click(unblockBtn(a.root));
    expect(a.onUnblock).toHaveBeenCalledTimes(1);
    mounted.pop()!.unmount();

    const b = setup({ narrow, unblockBusy: true });
    expect(blockBtn(b.root).getAttribute('aria-busy')).toBeNull();
    expect(blockBtn(b.root).getAttribute('aria-disabled')).toBeNull();
    click(blockBtn(b.root));
    expect(b.onBlock).toHaveBeenCalledTimes(1);
  });

  it('rảnh: không có aria-busy/aria-disabled và chạm gọi đúng một lần', () => {
    const { root, onBlock, onUnblock } = setup({ narrow });
    for (const el of [blockBtn(root), unblockBtn(root)]) {
      expect(el.getAttribute('aria-busy')).toBeNull();
      expect(el.getAttribute('aria-disabled')).toBeNull();
      expect(el.disabled).toBe(false);
    }
    click(blockBtn(root));
    click(unblockBtn(root));
    expect(onBlock).toHaveBeenCalledTimes(1);
    expect(onUnblock).toHaveBeenCalledTimes(1);
  });
});
