// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import type { OrderOpsCounts } from '@/lib/admin-client';
import { OrderOpsStrip } from './order-ops';

const OFF = { guest: false, bankPending: false, overdueCancelled: false };
const COUNTS: OrderOpsCounts = { guestWeb: 5, guestWebUnmerged: 2, bankTransferPending: 3, bankTransferOverdue: 0, overdueCancelled: 20_000, ttlHours: 24 };

let view: Rendered | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const tileValue = (counts: OrderOpsCounts) => {
  view = render(<OrderOpsStrip counts={counts} active={OFF} onToggle={() => undefined} />);
  return view.container.querySelector('[data-ops-tile="overdueCancelled"] .font-display')?.textContent;
};

describe('OrderOpsStrip — ô "Tự huỷ quá hạn CK" (w7-04 M5)', () => {
  it('tập id bị cắt ở trần: số kèm dấu "+" để không đọc 20.000 là số thật', () => {
    expect(tileValue({ ...COUNTS, overdueCancelledCapped: true })).toBe('20.000+');
  });

  it('không bị cắt, hoặc API cũ chưa trả cờ: số trần như cũ', () => {
    expect(tileValue({ ...COUNTS, overdueCancelledCapped: false })).toBe('20.000');
    view?.unmount();
    expect(tileValue(COUNTS)).toBe('20.000');
  });
});
