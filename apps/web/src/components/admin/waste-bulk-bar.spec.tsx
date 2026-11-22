// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { WasteBulkAction, WasteBulkResponse } from '@/lib/admin-waste-bulk-client';
import { useWasteBulkSelection, WasteBulkBar, wasteBulkSelectable, WasteSelectBox, type WastePick } from './waste-bulk-bar';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const reqs = (n: number): WastePick[] => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, code: `TR-A${String(i + 1).padStart(4, '0')}` }));

function Harness({ list, actions }: { list: WastePick[]; actions: WasteBulkAction[] }) {
  const [filter, setFilter] = useState('a');
  const sel = useWasteBulkSelection(filter);
  return (
    <div>
      <button type="button" data-test-filter onClick={() => setFilter('b')}>
        đổi lọc
      </button>
      <ul>
        {list.map((r) => (
          <li key={r.id}>
            <WasteSelectBox row={r} selection={sel} />
            {r.code}
          </li>
        ))}
      </ul>
      <WasteBulkBar selection={sel} actions={actions} pageRows={list} />
    </div>
  );
}

type Body = { action: WasteBulkAction; requestIds: string[]; dryRun: boolean; phoneMatchConfirmed?: boolean; reason?: string };

/** `pickup`: túi kèm đơn (không cần tick SĐT); `blocked`: id → lý do giữ lại. */
function respond(body: Body, o: { pickup?: string[]; blocked?: Record<string, string> } = {}): WasteBulkResponse {
  const results = body.requestIds.map((id) => {
    const code = `TR-A${id.slice(1).padStart(4, '0')}`;
    const pickup = o.pickup?.includes(id) ?? false;
    const base = { id, code, method: pickup ? ('PICKUP' as const) : ('MAIL_IN' as const), from: 'IN_TRANSIT' as const, needsPhoneConfirm: !pickup && body.action === 'MARK_RECEIVED' };
    const reason = o.blocked?.[id];
    if (reason) return { ...base, ok: false, outcome: 'FAILED' as const, reason, needsPhoneConfirm: false };
    return { ...base, ok: true, outcome: body.dryRun ? ('READY' as const) : ('UPDATED' as const), reason: null };
  });
  const okCount = results.filter((r) => r.ok).length;
  return { dryRun: body.dryRun, action: body.action, total: results.length, okCount, skippedCount: 0, failedCount: results.length - okCount, results, auditLogId: body.dryRun ? null : 'log', auditError: null };
}

async function mount(list: WastePick[], actions: WasteBulkAction[], o: Parameters<typeof respond>[1] = {}) {
  const m = mockFetch({ '/admin/waste/requests/bulk-action': (init) => ({ body: respond(JSON.parse(String(init?.body)) as Body, o) }) });
  vi.stubGlobal('fetch', m.fn);
  const r = render(<Harness list={list} actions={actions} />);
  mounted.push(r);
  await flush();
  const posts = () => m.calls.filter((x) => x.url.includes('/admin/waste/requests/bulk-action')).map((x) => JSON.parse(String(x.init?.body)) as Body);
  return { c: r.container, posts };
}

const box = (c: ParentNode, code: string) => c.querySelector<HTMLInputElement>(`[data-waste-bulk-select="${code}"] input`)!;
const bar = () => document.querySelector<HTMLElement>('[data-waste-bulk-bar]');
const dialog = () => document.querySelector<HTMLElement>('[data-waste-bulk-dialog]');
const confirmBtn = () => dialog()!.querySelector<HTMLButtonElement>('[data-waste-bulk-confirm]')!;

describe('wasteBulkSelectable', () => {
  it('only open / in-transit requests that do not go to a drop-off point', () => {
    expect(wasteBulkSelectable({ status: 'OPEN', method: 'MAIL_IN' })).toBe(true);
    expect(wasteBulkSelectable({ status: 'IN_TRANSIT', method: 'PICKUP' })).toBe(true);
    expect(wasteBulkSelectable({ status: 'OPEN', method: 'DROP_OFF' })).toBe(false);
    expect(wasteBulkSelectable({ status: 'RECEIVED', method: 'MAIL_IN' })).toBe(false);
  });
});

describe('WasteBulkBar', () => {
  it('no bar until something is picked; the select box is a 44×44 target; the count is announced', async () => {
    const { c } = await mount(reqs(3), ['MARK_RECEIVED']);
    expect(bar()).toBeNull();
    const label = c.querySelector<HTMLElement>('[data-waste-bulk-select="TR-A0001"]')!;
    expect(label.className).toContain('min-h-[44px]');
    expect(label.className).toContain('min-w-[44px]');
    expect(box(c, 'TR-A0001').getAttribute('aria-label')).toBe('Chọn yêu cầu TR-A0001');
    click(box(c, 'TR-A0001'));
    await flush();
    expect(bar()!.getAttribute('role')).toBe('region');
    const count = bar()!.querySelector('[aria-live="polite"]')!;
    expect(count.textContent).toContain('Đã chọn 1/50 yêu cầu');
    for (const b of bar()!.querySelectorAll('button')) expect(b.className).toContain('min-h-[44px]');
  });

  it('cap of 50 and a filter change clears the selection', async () => {
    const { c } = await mount(reqs(55), ['MARK_RECEIVED']);
    click(box(c, 'TR-A0001'));
    await flush();
    click(byText(bar()!, 'button', 'Chọn cả trang'));
    await flush();
    expect(bar()!.textContent).toContain('Đã chọn 50/50 yêu cầu');
    expect(box(c, 'TR-A0051').disabled).toBe(true);
    click(c.querySelector('[data-test-filter]'));
    await flush();
    expect(bar()).toBeNull();
  });

  it('MAIL_IN parcels need the phone tick before the run; the run goes in chunks of 5 with phoneMatchConfirmed', async () => {
    const { c, posts } = await mount(reqs(7), ['MARK_RECEIVED'], { blocked: { r7: 'Chưa có mã vận đơn để đối chiếu.' } });
    click(box(c, 'TR-A0001'));
    await flush();
    click(byText(bar()!, 'button', 'Chọn cả trang'));
    await flush();
    click(byText(bar()!, 'button', /Xem trước/));
    await flush();
    expect(posts()).toEqual([{ action: 'MARK_RECEIVED', requestIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'], dryRun: true }]);
    const d = dialog()!;
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.querySelector('[data-waste-bulk-summary]')!.textContent).toBe('6 yêu cầu làm được, 1 yêu cầu bị giữ lại (làm từng yêu cầu).');
    expect(d.querySelector('[data-ok="false"]')!.textContent).toContain('Chưa có mã vận đơn');
    expect(confirmBtn().disabled).toBe(true);
    click(d.querySelector('[data-waste-bulk-phone] input'));
    await flush();
    expect(confirmBtn().disabled).toBe(false);
    expect(confirmBtn().textContent).toBe('Nhận 6 yêu cầu');
    click(confirmBtn());
    await flush(10);
    expect(posts().slice(1)).toEqual([
      { action: 'MARK_RECEIVED', requestIds: ['r1', 'r2', 'r3', 'r4', 'r5'], dryRun: false, phoneMatchConfirmed: true },
      { action: 'MARK_RECEIVED', requestIds: ['r6'], dryRun: false, phoneMatchConfirmed: true },
    ]);
    expect(dialog()!.querySelector('[data-waste-bulk-summary]')!.textContent).toBe('Đã nhận 6 yêu cầu, 1 yêu cầu không đổi được.');
    click(byText(dialog()!, 'button', 'Xong'));
    await flush();
    expect(dialog()).toBeNull();
    expect(bar()).toBeNull();
  });

  it('PICKUP bags alone need no phone tick', async () => {
    const { c, posts } = await mount(reqs(2), ['MARK_RECEIVED'], { pickup: ['r1', 'r2'] });
    click(box(c, 'TR-A0001'));
    click(box(c, 'TR-A0002'));
    await flush();
    click(byText(bar()!, 'button', /Xem trước/));
    await flush();
    expect(dialog()!.querySelector('[data-waste-bulk-phone]')).toBeNull();
    click(confirmBtn());
    await flush(10);
    expect(posts()[1]).toEqual({ action: 'MARK_RECEIVED', requestIds: ['r1', 'r2'], dryRun: false });
  });

  it('close-lost: picked from the action list, red button, needs a reason that is sent trimmed', async () => {
    const { c, posts } = await mount(reqs(1), ['MARK_RECEIVED', 'CLOSE_LOST']);
    click(box(c, 'TR-A0001'));
    await flush();
    const select = bar()!.querySelector('select')!;
    select.value = 'CLOSE_LOST';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    click(byText(bar()!, 'button', 'Xem trước'));
    await flush();
    expect(posts()[0]).toEqual({ action: 'CLOSE_LOST', requestIds: ['r1'], dryRun: true });
    expect(confirmBtn().className).toContain('bg-danger-fg');
    expect(confirmBtn().disabled).toBe(true);
    typeInto(dialog()!.querySelector('textarea'), '  Hãng báo thất lạc  ');
    await flush();
    click(confirmBtn());
    await flush(10);
    expect(posts()[1]).toEqual({ action: 'CLOSE_LOST', requestIds: ['r1'], dryRun: false, reason: 'Hãng báo thất lạc' });
  });

  it('keyboard: focus starts on Đóng, Tab stays inside the dialog, Escape closes and keeps the selection', async () => {
    const { c } = await mount(reqs(2), ['MARK_RECEIVED']);
    click(box(c, 'TR-A0001'));
    await flush();
    const opener = byText(bar()!, 'button', /Xem trước/)!;
    opener.focus();
    click(opener);
    await flush();
    const d = dialog()!;
    expect(document.activeElement).toBe(d.querySelector('[data-waste-bulk-close]'));
    const focusables = [...d.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea, [tabindex="0"]')];
    focusables[focusables.length - 1]!.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(d.contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(dialog()).toBeNull();
    expect(bar()!.textContent).toContain('Đã chọn 1/50 yêu cầu');
  });

  it('a chunk that fails mid-run keeps the earlier results and says to reload', async () => {
    let n = 0;
    const m = mockFetch({
      '/admin/waste/requests/bulk-action': (init) => {
        const body = JSON.parse(String(init?.body)) as Body;
        if (!body.dryRun && ++n === 2) return { status: 500, body: { message: 'boom' } };
        return { body: respond(body, { pickup: body.requestIds }) };
      },
    });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<Harness list={reqs(6)} actions={['MARK_RECEIVED']} />);
    mounted.push(r);
    await flush();
    click(box(r.container, 'TR-A0001'));
    await flush();
    click(byText(bar()!, 'button', 'Chọn cả trang'));
    await flush();
    click(byText(bar()!, 'button', /Xem trước/));
    await flush();
    click(confirmBtn());
    await flush(10);
    const d = dialog()!;
    expect(d.querySelector('[role="alert"]')!.textContent).toContain('đóng hộp để tải lại');
    expect(d.querySelector('[data-waste-bulk-summary]')!.textContent).toBe('Đã nhận 5 yêu cầu.');
  });
});
