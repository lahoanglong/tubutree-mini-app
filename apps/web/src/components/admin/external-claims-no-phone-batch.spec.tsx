// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import type { NoPhoneBatchResponse, NoPhoneBatchRow } from '@/lib/admin-external-no-phone-batch-client';
import { ExternalClaimsNoPhoneBatch, NO_PHONE_BATCH_BUTTON } from './external-claims-no-phone-batch';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

type Body = { dryRun: boolean; claimIds?: string[] };
const row = (id: string, o: Partial<NoPhoneBatchRow> = {}): NoPhoneBatchRow => ({
  id,
  maskedCode: `LZ***${id}`,
  userName: 'Chi Lan',
  userPhoneMasked: '090***4567',
  points: 12_500,
  deliveredAppOrders: 1,
  creditedClaims: 2,
  recipientNameMatch: 'MATCH',
  ok: true,
  outcome: 'READY',
  reason: null,
  ...o,
});
const resp = (results: NoPhoneBatchRow[], dryRun: boolean): NoPhoneBatchResponse => {
  const okCount = results.filter((r) => r.ok).length;
  const skippedCount = results.filter((r) => r.outcome === 'SKIPPED').length;
  return { dryRun, total: results.length, okCount, skippedCount, failedCount: results.length - okCount - skippedCount, truncated: false, results, auditLogId: dryRun ? null : 'log', auditError: null };
};

async function mount(preview: NoPhoneBatchRow[]) {
  const m = mockFetch({
    '/admin/external-claims/no-phone-batch': (init) => {
      const body = JSON.parse(String(init?.body)) as Body;
      return { body: body.dryRun ? resp(preview, true) : resp(body.claimIds!.map((id) => row(id, { outcome: 'APPROVED' })), false) };
    },
  });
  vi.stubGlobal('fetch', m.fn);
  const r = render(<ExternalClaimsNoPhoneBatch />);
  mounted.push(r);
  await flush();
  const posts = () => m.calls.filter((x) => x.url.includes('no-phone-batch')).map((x) => JSON.parse(String(x.init?.body)) as Body);
  return { c: r.container, posts, calls: m.calls };
}

const dialog = () => document.querySelector<HTMLElement>('[data-stale-batch-dialog][data-batch-kind="no-phone"]');
const summary = () => dialog()!.querySelector('[data-stale-batch-summary]')!.textContent;

describe('ExternalClaimsNoPhoneBatch (W45)', () => {
  it('xem trước gọi đúng route Lazada, mỗi dòng có đơn app, đơn sàn đã cộng và kết luận tên; dòng bị chặn hiện lý do', async () => {
    const { c, posts, calls } = await mount([
      row('c1'),
      row('c2', { ok: false, outcome: 'FAILED', recipientNameMatch: 'MISMATCH', reason: 'Tên người nhận trên đơn khác tên thành viên: gọi xác nhận rồi duyệt tay.' }),
    ]);
    expect(posts()).toEqual([]);
    click(byText(c, 'button', NO_PHONE_BATCH_BUTTON));
    await flush();
    expect(posts()).toEqual([{ dryRun: true }]);
    expect(calls.some((x) => x.url.includes('stale-phone-batch'))).toBe(false);
    const d = dialog()!;
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.querySelector('h2')!.textContent).toBe(NO_PHONE_BATCH_BUTTON);
    expect(summary()).toBe('1 claim duyệt nhanh được, 1 claim cần duyệt tay (xem lý do).');
    expect(d.textContent).toContain('Chỉ claim đơn Lazada');
    expect(d.querySelector('[data-ok="true"]')!.textContent).toContain('12.500 điểm · 1 đơn app đã giao · 2 đơn sàn đã cộng · Tên người nhận khớp tên thành viên');
    expect(d.querySelector('[data-ok="false"]')!.textContent).toContain('duyệt tay');
  });

  it('duyệt đúng các claim đã xem trước, từng nhóm 5', async () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
    const { c, posts } = await mount(ids.map((id) => row(id)));
    click(byText(c, 'button', NO_PHONE_BATCH_BUTTON));
    await flush();
    const confirm = dialog()!.querySelector<HTMLButtonElement>('[data-stale-batch-confirm]')!;
    expect(confirm.textContent).toBe('Duyệt 7 claim');
    click(confirm);
    await flush(10);
    expect(posts().slice(1)).toEqual([
      { dryRun: false, claimIds: ['c1', 'c2', 'c3', 'c4', 'c5'] },
      { dryRun: false, claimIds: ['c6', 'c7'] },
    ]);
    expect(summary()).toBe('Đã duyệt 7 claim.');
  });

  it('không có claim đủ điều kiện: nói rõ, không có nút duyệt', async () => {
    const { c } = await mount([]);
    click(byText(c, 'button', NO_PHONE_BATCH_BUTTON));
    await flush();
    expect(summary()).toBe('Không có claim đơn Lazada nào đang chờ duyệt chỉ vì đơn không có SĐT để đối chiếu.');
    expect(dialog()!.querySelector('[data-stale-batch-confirm]')).toBeNull();
  });
});
