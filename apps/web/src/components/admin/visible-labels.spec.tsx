// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletionPanel } from './account-deletion-panel';
import { DealerCreditPanel } from './dealer-credit-panel';
import { DealerPaymentPanel } from './dealer-payment-panel';
import { OrderInvoicePanel } from './order-detail-extras';
import { OrderStatusActions } from './order-status-actions';
import { PancakeAttentionPanel } from './pancake-attention';
import { PayoutRow } from './payout-admin-tab';
import { RecyclingPanel } from './recycling-panel';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import type { AdminOrder, AdminPayout } from '@/lib/admin-client';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

/** Ô nhập chỉ có placeholder/aria-label: gõ xong là mất gợi ý, mắt thường không biết ô này để làm gì (D7-25). */
function fieldsWithoutVisibleLabel(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input, textarea, select'))
    .filter((el) => !['hidden', 'checkbox', 'radio', 'file'].includes(el.type))
    .filter((el) => {
      const text = Array.from(el.labels ?? [])
        .map((l) => (l.textContent ?? '').trim())
        .join('');
      return text.length === 0;
    })
    .map((el) => el.getAttribute('aria-label') ?? el.getAttribute('name') ?? el.outerHTML.slice(0, 80));
}

const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 'o1',
  code: 'TB-300',
  type: 'RETAIL',
  status: 'PENDING_PAYMENT',
  total: 450_000,
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'UNPAID',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const payout = (over: Partial<AdminPayout> = {}): AdminPayout => ({
  id: 'p1',
  userId: 'u1',
  amount: 1_500_000,
  fee: 3_000,
  method: 'BANK',
  bankInfo: { bankName: 'VCB', accountNumber: '0123456789', accountName: 'NGUYEN A' },
  status: 'REQUESTED',
  requestedAt: '2026-10-01T00:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  paidBy: null,
  paidAt: null,
  bankRef: null,
  adminNote: null,
  user: { id: 'u1', fullName: 'Nguyễn A', phone: '0900000001', referralCode: 'AAAA1111' },
  ...over,
});

const CASES: [string, () => ReactElement, (c: HTMLElement) => Promise<void>][] = [
  ['Đơn đại lý: xác nhận đã nhận chuyển khoản', () => <DealerPaymentPanel order={order({ type: 'DEALER', dealerOnCredit: false })} />, async () => undefined],
  [
    'Đơn đại lý: công nợ',
    () => <DealerCreditPanel order={order({ type: 'DEALER', status: 'CONFIRMED', user: { id: 'd1', phone: '0900000000', fullName: 'Đại lý A' } })} />,
    async (c) => {
      click(byText(c, 'button', 'Công nợ đại lý'));
      await flush();
    },
  ],
  ['Đơn: Đã nhận tiền', () => <OrderStatusActions order={order({ allowedTransitions: ['CONFIRMED'], canConfirmPayment: true })} />, async () => undefined],
  ['Đơn: Cần xử lý Pancake', () => <PancakeAttentionPanel order={order({ pancakeAttention: 'Pancake báo việc cần xử lý', pancakeAttentionAt: '2026-10-14T02:00:00.000Z' })} />, async () => undefined],
  [
    'Đơn: hoá đơn VAT',
    () => (
      <OrderInvoicePanel
        order={order({ invoiceStatus: 'REQUESTED', invoiceRequest: { taxCode: '0312345678', companyName: 'Công ty ABC', address: '1 Lê Lợi', email: 'a@abc.vn' } })}
      />
    ),
    async () => undefined,
  ],
  ['Đơn: thu gom tái chế xử lý tay', () => <RecyclingPanel order={order({ hasRecyclingPickup: true, status: 'PACKED', paymentStatus: 'PAID', gomdonStatus: 'FAILED' })} />, async () => undefined],
  ['Rút tiền: chờ duyệt', () => <PayoutRow payout={payout()} />, async () => undefined],
  ['Rút tiền: chờ chi', () => <PayoutRow payout={payout({ status: 'APPROVED' })} />, async () => undefined],
  ['Yêu cầu xoá tài khoản', () => <AccountDeletionPanel />, async () => flush()],
];

describe('ô nhập trong tab quản trị có nhãn hiện (D7-25)', () => {
  it.each(CASES)('%s', async (_name, ui, prepare) => {
    const api = mockFetch({
      '/admin/account-deletion-requests': {
        body: [
          {
            id: 'd1',
            userId: 'u1',
            reason: 'Không dùng nữa',
            status: 'PENDING',
            createdAt: '2026-10-01T03:00:00.000Z',
            reviewedBy: null,
            reviewedAt: null,
            user: { id: 'u1', fullName: 'Nguyễn Văn A', phone: '0912345678', role: 'CUSTOMER', walletBalance: 0, pointsConvertedBalance: 0, cashbackPending: 0, createdAt: '2026-01-01T00:00:00.000Z' },
            blockers: [],
          },
        ],
      },
      '/credit-ledger': { body: { balance: 0, entries: [] } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(ui());
    mounted.push(r);
    await prepare(r.container);
    await flush();
    const total = r.container.querySelectorAll('input, textarea').length;
    expect(total, 'không dựng ra ô nhập nào để kiểm').toBeGreaterThan(0);
    expect(fieldsWithoutVisibleLabel(r.container)).toEqual([]);
  });
});
