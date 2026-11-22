// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import type { StaleBatchResponse, StaleBatchRow } from '@/lib/admin-external-stale-batch-client';
import { ExternalClaimsStaleBatch, STALE_BATCH_BUTTON } from './external-claims-stale-batch';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

type Body = { dryRun: boolean; claimIds?: string[] };
const row = (id: string, o: Partial<StaleBatchRow> = {}): StaleBatchRow => ({
  id,
  maskedCode: `GHN***${id}`,
  userName: 'Chi Lan',
  userPhoneMasked: '090***4567',
  points: 10_000,
  deliveredAppOrders: 2,
  ok: true,
  outcome: 'READY',
  reason: null,
  ...o,
});
const resp = (results: StaleBatchRow[], dryRun: boolean, truncated = false): StaleBatchResponse => {
  const okCount = results.filter((r) => r.ok).length;
  const skippedCount = results.filter((r) => r.outcome === 'SKIPPED').length;
  return { dryRun, total: results.length, okCount, skippedCount, failedCount: results.length - okCount - skippedCount, truncated, results, auditLogId: dryRun ? null : 'log', auditError: null };
};

async function mount(preview: StaleBatchRow[], runRow: (id: string) => StaleBatchRow = (id) => row(id, { outcome: 'APPROVED' }), truncated = false) {
  const m = mockFetch({
    '/admin/external-claims/stale-phone-batch': (init) => {
      const body = JSON.parse(String(init?.body)) as Body;
      return { body: body.dryRun ? resp(preview, true, truncated) : resp(body.claimIds!.map(runRow), false) };
    },
  });
  vi.stubGlobal('fetch', m.fn);
  const r = render(<ExternalClaimsStaleBatch />);
  mounted.push(r);
  await flush();
  const posts = () => m.calls.filter((x) => x.url.includes('stale-phone-batch')).map((x) => JSON.parse(String(x.init?.body)) as Body);
  return { c: r.container, posts };
}

const dialog = () => document.querySelector<HTMLElement>('[data-stale-batch-dialog]');
const summary = () => dialog()!.querySelector('[data-stale-batch-summary]')!.textContent;

describe('ExternalClaimsStaleBatch', () => {
  it('nothing is sent until the button is clicked; the preview asks the server to scan (dryRun, no ids)', async () => {
    const { c, posts } = await mount([row('c1'), row('c2', { ok: false, outcome: 'FAILED', reason: 'Thành viên chưa nhận đơn app nào: cần gọi xác nhận người nhận rồi duyệt tay.', deliveredAppOrders: 0 })]);
    expect(posts()).toEqual([]);
    click(byText(c, 'button', STALE_BATCH_BUTTON));
    await flush();
    expect(posts()).toEqual([{ dryRun: true }]);
    const d = dialog()!;
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(summary()).toBe('1 claim duyệt nhanh được, 1 claim cần duyệt tay (xem lý do).');
    expect(d.querySelector('[data-ok="false"]')!.textContent).toContain('chưa nhận đơn app');
    expect(d.querySelector('[data-ok="true"]')!.textContent).toContain('090***4567');
    expect(document.activeElement).toBe(d.querySelector('[data-stale-batch-close]'));
  });

  it('approves exactly the previewed claims, in chunks of 5, and reports per claim', async () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    const { c, posts } = await mount(ids.map((id) => row(id)), (id) => (id === 'c2' ? row(id, { ok: false, outcome: 'SKIPPED', reason: 'Claim vừa được xử lý.' }) : row(id, { outcome: 'APPROVED' })));
    click(byText(c, 'button', STALE_BATCH_BUTTON));
    await flush();
    const confirm = dialog()!.querySelector<HTMLButtonElement>('[data-stale-batch-confirm]')!;
    expect(confirm.textContent).toBe('Duyệt 6 claim');
    expect(confirm.className).toContain('min-h-[44px]');
    click(confirm);
    await flush(10);
    expect(posts().slice(1)).toEqual([
      { dryRun: false, claimIds: ['c1', 'c2', 'c3', 'c4', 'c5'] },
      { dryRun: false, claimIds: ['c6'] },
    ]);
    expect(summary()).toBe('Đã duyệt 5 claim, 1 claim người khác vừa xử lý.');
    expect(dialog()!.querySelector('[data-stale-batch-confirm]')).toBeNull();
    click(byText(dialog()!, 'button', 'Xong'));
    await flush();
    expect(dialog()).toBeNull();
  });

  it('no eligible claim: says so and offers no approve button; Escape closes', async () => {
    const { c, posts } = await mount([]);
    click(byText(c, 'button', STALE_BATCH_BUTTON));
    await flush();
    expect(summary()).toBe('Không có claim nào đang chờ duyệt chỉ vì SĐT xác minh đã cũ.');
    expect(dialog()!.querySelector('[data-stale-batch-confirm]')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(dialog()).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it('warns when the server cut the list at 50', async () => {
    const { c } = await mount([row('c1')], undefined, true);
    click(byText(c, 'button', STALE_BATCH_BUTTON));
    await flush();
    expect(dialog()!.textContent).toContain('mỗi lượt tối đa 50');
  });
});
