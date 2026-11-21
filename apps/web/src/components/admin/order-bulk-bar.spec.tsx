// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { BulkStatusResponse, BulkStatusTarget } from '@/lib/admin-bulk-ops-client';
import { OrderBulkBar, OrderSelectBox, useOrderBulkSelection, type BulkPick } from './order-bulk-bar';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const orders = (n: number, from = 1): BulkPick[] => Array.from({ length: n }, (_, i) => ({ id: `id-${from + i}`, code: `TB${String(from + i).padStart(4, '0')}` }));

function Harness({ list, targets, onRowClick }: { list: BulkPick[]; targets: BulkStatusTarget[]; onRowClick?: () => void }) {
  const [filter, setFilter] = useState('a');
  const sel = useOrderBulkSelection(filter);
  return (
    <div>
      <button type="button" data-test-filter onClick={() => setFilter('b')}>
        đổi lọc
      </button>
      <ul>
        {list.map((o) => (
          <li key={o.id} onClick={onRowClick} data-row={o.code}>
            <OrderSelectBox order={o} selection={sel} />
            {o.code}
          </li>
        ))}
      </ul>
      <OrderBulkBar selection={sel} targets={targets} pageOrders={list} />
    </div>
  );
}

const box = (c: ParentNode, code: string) => c.querySelector<HTMLInputElement>(`[data-bulk-select="${code}"] input`)!;
const bar = () => document.querySelector<HTMLElement>('[data-bulk-bar]');
const dialog = () => document.querySelector<HTMLElement>('[data-bulk-dialog]');
const button = (root: ParentNode | null, text: string | RegExp) => byText(root ?? document, 'button', text) as HTMLButtonElement | null;

function respond(body: { orderIds: string[]; targetStatus: BulkStatusTarget; dryRun: boolean }, blocked: Record<string, string>): BulkStatusResponse {
  const results = body.orderIds.map((id) => ({ id, code: id.replace('id-', 'TB').padEnd(6, '0'), from: 'CONFIRMED', ok: !blocked[id], reason: blocked[id] ?? null }));
  const okCount = results.filter((r) => r.ok).length;
  return { dryRun: body.dryRun, targetStatus: body.targetStatus, total: results.length, okCount, failedCount: results.length - okCount, results, auditLogId: body.dryRun ? null : 'log-1', auditError: null };
}

async function mount(list: BulkPick[], targets: BulkStatusTarget[], blocked: Record<string, string> = {}, onRowClick?: () => void) {
  const m = mockFetch({ '/admin/orders/bulk-status': (init) => ({ body: respond(JSON.parse(String(init?.body)), blocked) }) });
  vi.stubGlobal('fetch', m.fn);
  const r = render(<Harness list={list} targets={targets} onRowClick={onRowClick} />);
  mounted.push(r);
  await flush();
  const posts = () => m.calls.filter((x) => x.url.includes('/admin/orders/bulk-status')).map((x) => JSON.parse(String(x.init?.body)));
  return { c: r.container, posts };
}

describe('OrderBulkBar', () => {
  it('chưa chọn gì thì không có thanh; ô chọn có vùng bấm 44×44 và bấm không mở dòng', async () => {
    const onRow = vi.fn();
    const { c } = await mount(orders(3), ['PACKED'], {}, onRow);
    expect(bar()).toBeNull();
    const label = c.querySelector<HTMLElement>('[data-bulk-select="TB0001"]')!;
    expect(label.className).toContain('min-h-[44px]');
    expect(label.className).toContain('min-w-[44px]');
    click(box(c, 'TB0001'));
    await flush();
    expect(onRow).not.toHaveBeenCalled();
    expect(bar()!.textContent).toContain('Đã chọn 1/50 đơn');
    expect(bar()!.className).toContain('tabular-nums');
    for (const b of bar()!.querySelectorAll('button')) expect(b.className).toContain('min-h-[44px]');
  });

  it('trần 50 đơn: "Chọn cả trang" dừng ở 50, ô còn lại bị khoá, có câu nhắc', async () => {
    const { c } = await mount(orders(60), ['PACKED']);
    click(box(c, 'TB0001'));
    await flush();
    click(button(bar(), 'Chọn cả trang'));
    await flush();
    expect(bar()!.textContent).toContain('Đã chọn 50/50 đơn');
    expect(bar()!.textContent).toContain('Mỗi lượt tối đa 50 đơn');
    expect(box(c, 'TB0050').checked).toBe(true);
    expect(box(c, 'TB0051').checked).toBe(false);
    expect(box(c, 'TB0051').disabled).toBe(true);
    expect(button(bar(), 'Chọn cả trang')).toBeNull();
    click(box(c, 'TB0050'));
    await flush();
    expect(box(c, 'TB0051').disabled).toBe(false);
  });

  it('đổi bộ lọc thì bỏ chọn hết', async () => {
    const { c } = await mount(orders(3), ['PACKED']);
    click(box(c, 'TB0002'));
    await flush();
    expect(bar()).not.toBeNull();
    click(c.querySelector('[data-test-filter]'));
    await flush();
    expect(bar()).toBeNull();
    expect(box(c, 'TB0002').checked).toBe(false);
  });

  it('xem trước bằng dryRun: hiện đơn đổi được và đơn bị giữ lại kèm lý do; xác nhận chỉ gửi đơn hợp lệ, không dryRun', async () => {
    const { c, posts } = await mount(orders(3), ['PACKED'], { 'id-2': 'Đơn TB0002 chưa thanh toán: chưa đóng gói được.' });
    for (const code of ['TB0001', 'TB0002', 'TB0003']) click(box(c, code));
    await flush();
    click(button(bar(), /Xem trước/));
    await flush();
    expect(posts()).toEqual([{ orderIds: ['id-1', 'id-2', 'id-3'], targetStatus: 'PACKED', dryRun: true }]);
    const d = dialog()!;
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.className).toContain('tabular-nums');
    expect(d.querySelector('[data-bulk-summary]')!.textContent).toBe('2 đơn đổi được, 1 đơn bị giữ lại (không đổi).');
    expect(d.querySelector('[data-ok="false"]')!.textContent).toContain('chưa thanh toán');
    expect(d.querySelector<HTMLElement>('[data-bulk-results]')!.className).toContain('overflow-y-auto');
    for (const b of d.querySelectorAll('button')) expect(b.className).toContain('min-h-[44px]');

    click(d.querySelector('[data-bulk-confirm]'));
    await flush();
    expect(posts()[1]).toEqual({ orderIds: ['id-1', 'id-3'], targetStatus: 'PACKED', dryRun: false });
    expect(dialog()!.querySelector('[data-bulk-summary]')!.textContent).toBe('Đã đổi 2 đơn, 1 đơn không đổi được.');
    expect([...dialog()!.querySelectorAll('[data-bulk-results] li')].map((li) => li.getAttribute('data-ok'))).toEqual(['true', 'true', 'false']);
    click(button(dialog(), 'Xong'));
    await flush();
    expect(dialog()).toBeNull();
    expect(bar()).toBeNull();
  });

  it('huỷ hàng loạt: chọn đích trong danh sách, nút đỏ, gửi kèm lý do đã cắt khoảng trắng', async () => {
    const { c, posts } = await mount(orders(2), ['PACKED', 'CANCELLED']);
    click(box(c, 'TB0001'));
    await flush();
    const select = bar()!.querySelector('select')!;
    select.value = 'CANCELLED';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    click(button(bar(), 'Xem trước'));
    await flush();
    const confirm = dialog()!.querySelector<HTMLButtonElement>('[data-bulk-confirm]')!;
    expect(confirm.textContent).toBe('Huỷ 1 đơn');
    expect(confirm.className).toContain('bg-danger-fg');
    typeInto(dialog()!.querySelector('textarea'), '  Khách đổi ý  ');
    click(confirm);
    await flush();
    expect(posts()[1]).toEqual({ orderIds: ['id-1'], targetStatus: 'CANCELLED', dryRun: false, note: 'Khách đổi ý' });
  });

  it('mọi đơn đều bị giữ lại thì không có gì để xác nhận; Escape đóng hộp và giữ nguyên lựa chọn', async () => {
    const { c, posts } = await mount(orders(1), ['PACKED'], { 'id-1': 'Đơn TB0001 đã ở «Đã đóng gói», không cần đổi.' });
    click(box(c, 'TB0001'));
    await flush();
    click(button(bar(), /Xem trước/));
    await flush();
    expect(dialog()!.querySelector<HTMLButtonElement>('[data-bulk-confirm]')!.disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    expect(dialog()).toBeNull();
    expect(bar()!.textContent).toContain('Đã chọn 1/50 đơn');
    expect(posts()).toHaveLength(1);
  });
  it('lượt đổi thật gửi từng nhóm 10 đơn với hạn chờ dài, gộp kết quả; nút báo tiến độ', async () => {
    const { c, posts } = await mount(orders(23), ['PACKED']);
    click(box(c, 'TB0001'));
    await flush();
    click(button(bar(), 'Chọn cả trang'));
    await flush();
    click(button(bar(), /Xem trước/));
    await flush();
    click(dialog()!.querySelector('[data-bulk-confirm]'));
    await flush(12);
    expect(posts().slice(1).map((p) => [p.orderIds.length, p.dryRun])).toEqual([
      [10, false],
      [10, false],
      [3, false],
    ]);
    expect(dialog()!.querySelector('[data-bulk-summary]')!.textContent).toBe('Đã đổi 23 đơn.');
  });

  it('lỗi giữa chừng: giữ kết quả nhóm đã xong, báo đơn còn lại chưa chắc, đóng hộp thì bỏ chọn để tải lại danh sách', async () => {
    let n = 0;
    const m = mockFetch({
      '/admin/orders/bulk-status': (init) => {
        const body = JSON.parse(String(init?.body));
        if (!body.dryRun && ++n === 2) return { status: 504, body: { message: 'Gateway Timeout' } };
        return { body: respond(body, {}) };
      },
    });
    vi.stubGlobal('fetch', m.fn);
    const r = render(<Harness list={orders(15)} targets={['PACKED']} />);
    mounted.push(r);
    await flush();
    click(box(r.container, 'TB0001'));
    await flush();
    click(button(bar(), 'Chọn cả trang'));
    await flush();
    click(button(bar(), /Xem trước/));
    await flush();
    click(dialog()!.querySelector('[data-bulk-confirm]'));
    await flush(12);
    expect(dialog()!.querySelector('[data-bulk-summary]')!.textContent).toBe('Đã đổi 10 đơn.');
    expect(dialog()!.textContent).toContain('có thể đã đổi hoặc chưa');
    click(button(dialog(), 'Xong'));
    await flush();
    expect(bar()).toBeNull();
  });
});
