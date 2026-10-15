// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import type { AdminOrder } from '@/lib/admin-client';

// PANCAKE-9, ADMINOPS-4: admin không thấy đơn nào chưa lên kho Pancake, lỗi gì, và không có cách đẩy lại.

const mocks = vi.hoisted(() => ({ retryPancakePush: vi.fn() }));
vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  retryPancakePush: mocks.retryPancakePush,
}));

import { PancakeSyncBadge, PancakeSyncPanel, canRetryPancakePush, pancakeSyncState } from './pancake-sync';

const order = (o: Partial<AdminOrder> = {}): AdminOrder =>
  ({
    id: 'o1',
    code: 'TUBU1',
    status: 'CONFIRMED',
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    total: 230000,
    createdAt: '2026-10-13T02:00:00.000Z',
    pancakeOrderId: null,
    pancakePushStatus: 'FAILED',
    pancakeSyncError: 'Pancake trả 422 khi tạo đơn: variation_id không hợp lệ',
    pancakePushAttempts: 5,
    pancakeLastAttemptAt: '2026-10-13T03:00:00.000Z',
    pancakeCancelStatus: null,
    ...o,
  }) as AdminOrder;

/** Nút xác nhận trong hộp thoại (khác nút "Đẩy lại Pancake" mở hộp thoại). */
const confirmButton = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find((b) => b.textContent === 'Đẩy lại')!;

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

beforeEach(() => {
  mocks.retryPancakePush.mockReset().mockResolvedValue({ ok: true, message: 'Đã xếp lệnh đẩy đơn TUBU1 sang Pancake.' });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('pancakeSyncState', () => {
  it.each([
    [{ pancakePushStatus: 'FAILED' }, 'Pancake: đẩy lỗi', true],
    [{ pancakePushStatus: 'STALE' }, 'Pancake: quá hạn tự đẩy', true],
    [{ pancakePushStatus: 'NOT_CONFIGURED' }, 'Pancake: chưa cấu hình', true],
    [{ pancakePushStatus: 'WAITING_PAYMENT', pancakeSyncError: null }, 'Pancake: chờ thanh toán', false],
    [{ pancakeOrderId: '98765', pancakePushStatus: 'SYNCED' }, 'Đã lên Pancake', false],
    [{ status: 'CANCELLED', pancakeOrderId: '98765', pancakeCancelStatus: 'FAILED' }, 'Pancake: chưa huỷ được', true],
    [{ status: 'CANCELLED', pancakeOrderId: '98765', pancakeCancelStatus: 'TOO_LATE' }, 'Pancake: đã giao vận chuyển', true],
  ] as [Partial<AdminOrder>, string, boolean][])('%j → %s', (o, label, flag) => {
    expect(pancakeSyncState(order(o))).toMatchObject({ label, flag });
  });

  it('chỉ đơn còn trong kho, chưa lên Pancake, không chờ thanh toán mới được đẩy lại', () => {
    expect(canRetryPancakePush(order())).toBe(true);
    expect(canRetryPancakePush(order({ status: 'DELIVERED' }))).toBe(false);
    expect(canRetryPancakePush(order({ status: 'CANCELLED' }))).toBe(false);
    expect(canRetryPancakePush(order({ pancakeOrderId: '1' }))).toBe(false);
    expect(canRetryPancakePush(order({ pancakePushStatus: 'WAITING_PAYMENT' }))).toBe(false);
  });

  it('đơn đại lý còn hàng đặt trước → "chờ đủ hàng", không badge ở danh sách, không nút đẩy lại (R1)', () => {
    const items = [{ id: 'i1', productName: 'Sen đá', unitPrice: 40000, quantity: 5, total: 200000, backorderedQty: 3 }];
    const legacy = order({ type: 'DEALER', pancakePushStatus: null, pancakeSyncError: null, items });
    expect(pancakeSyncState(legacy)).toMatchObject({ label: 'Pancake: chờ đủ hàng', flag: false });
    expect(canRetryPancakePush(legacy)).toBe(false);
    expect(pancakeSyncState(order({ pancakePushStatus: 'WAITING_STOCK', pancakeSyncError: null }))).toMatchObject({
      label: 'Pancake: chờ đủ hàng',
      flag: false,
    });
    expect(canRetryPancakePush(order({ pancakePushStatus: 'WAITING_STOCK' }))).toBe(false);
    expect(canRetryPancakePush(order({ type: 'DEALER', items: [{ ...items[0]!, backorderedQty: 0 }] }))).toBe(true);
    const filled = order({ type: 'DEALER', pancakePushStatus: 'WAITING_STOCK', items: [{ ...items[0]!, backorderedQty: 0 }] });
    expect(canRetryPancakePush(filled)).toBe(true);
  });
});

describe('PancakeSyncBadge', () => {
  it('đơn đẩy lỗi → badge ở danh sách kèm lý do khi rê chuột; đơn đã lên Pancake → không badge', () => {
    const a = mount(<PancakeSyncBadge order={order()} />);
    const badge = byText(a.container, 'span', 'Pancake: đẩy lỗi');
    expect(badge?.getAttribute('title')).toContain('variation_id không hợp lệ');
    const b = mount(<PancakeSyncBadge order={order({ pancakeOrderId: '1', pancakePushStatus: 'SYNCED' })} />);
    expect(b.container.textContent).toBe('');
  });
});

describe('PancakeSyncPanel', () => {
  it('hiện lỗi gần nhất, số lần thử; "Đẩy lại Pancake" hỏi xác nhận rồi gọi API và báo kết quả', async () => {
    const { container } = mount(<PancakeSyncPanel order={order()} />);
    expect(container.textContent).toContain('Lỗi gần nhất: Pancake trả 422 khi tạo đơn: variation_id không hợp lệ');
    expect(container.textContent).toContain('5 lần thử');
    click(byText(container, 'button', 'Đẩy lại Pancake'));
    await flush();
    expect(mocks.retryPancakePush).not.toHaveBeenCalled();
    await act(async () => {
      confirmButton().click();
    });
    await flush();
    expect(mocks.retryPancakePush).toHaveBeenCalledWith('o1');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Đã xếp lệnh đẩy đơn TUBU1 sang Pancake.');
  });

  it('API từ chối (đơn vừa rời kho) → hiện lời API', async () => {
    mocks.retryPancakePush.mockRejectedValue(new Error('Đơn TUBU1 đã ở trạng thái SHIPPING — không đẩy để tránh kho giao lần hai.'));
    const { container } = mount(<PancakeSyncPanel order={order()} />);
    click(byText(container, 'button', 'Đẩy lại Pancake'));
    await flush();
    await act(async () => {
      confirmButton().click();
    });
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('tránh kho giao lần hai');
  });

  it('đơn đã lên Pancake → chỉ hiện mã đơn Pancake, không có nút đẩy lại', () => {
    const { container } = mount(<PancakeSyncPanel order={order({ pancakeOrderId: '98765', pancakePushStatus: 'SYNCED', pancakeSyncError: null })} />);
    expect(container.textContent).toContain('Mã đơn Pancake #98765');
    expect(container.querySelector('button')).toBeNull();
  });
});

describe('đơn gian hàng đối tác tự giao (D4 × P1) — không bao giờ lên Pancake', () => {
  const merchant = (o: Partial<AdminOrder> = {}) =>
    order({ fulfiller: 'MERCHANT', fulfillerStorefront: { title: 'Mật ong Linh' }, pancakePushStatus: null, pancakeSyncError: null, ...o });

  it('không badge "chưa lên Pancake", không nút "Đẩy lại Pancake", panel ghi rõ gian hàng tự giao', () => {
    expect(pancakeSyncState(merchant())).toBeNull();
    expect(pancakeSyncState(merchant({ pancakePushStatus: 'FAILED' }))).toBeNull();
    expect(canRetryPancakePush(merchant())).toBe(false);
    const badge = mount(<PancakeSyncBadge order={merchant({ pancakePushStatus: 'STALE' })} />);
    expect(badge.container.textContent).toBe('');
    const { container } = mount(<PancakeSyncPanel order={merchant()} />);
    expect(container.textContent).toContain('Không áp dụng — Mật ong Linh tự giao đơn này.');
    expect(container.querySelector('button')).toBeNull();
  });
});
