// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { INBOX_LABELS, OpsInboxTab } from './ops-inbox-tab';
import { click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const stubInbox = (items: { key: string; count: number }[]) => {
  const api = mockFetch({ '/admin/ops/inbox': { body: { generatedAt: '2026-10-14T03:00:00.000Z', items } } });
  vi.stubGlobal('fetch', vi.fn(api.fn));
};

describe('OpsInboxTab — việc với đối tác (R4-ADMIN-7)', () => {
  it('có thẻ riêng cho liên kết ký gửi chờ xác nhận, khoản chờ lập phiếu và phiếu chờ chuyển/thu; bấm thẻ mở đúng khoá', async () => {
    stubInbox([
      { key: 'consignmentPending', count: 1 },
      { key: 'merchantToSettle', count: 2 },
      { key: 'merchantPayoutsPending', count: 3 },
      { key: 'merchantOverdue', count: 0 },
    ]);
    const onOpen = vi.fn();
    const r = render(<OpsInboxTab onOpen={onOpen} />);
    mounted.push(r);
    await flush();
    const root = r.container;

    const card = (k: string) => root.querySelector<HTMLButtonElement>(`[data-inbox="${k}"]`)!;
    expect(card('consignmentPending').textContent).toContain('Liên kết ký gửi chờ xác nhận');
    expect(card('consignmentPending').textContent).toContain('1');
    expect(card('merchantToSettle').textContent).toContain('Gian hàng có khoản chờ lập phiếu');
    expect(card('merchantToSettle').textContent).toContain('2');
    expect(card('merchantPayoutsPending').textContent).toContain('Phiếu đối soát chờ chuyển / thu');
    expect(card('merchantPayoutsPending').textContent).toContain('3');

    click(card('consignmentPending'));
    click(card('merchantToSettle'));
    click(card('merchantPayoutsPending'));
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual(['consignmentPending', 'merchantToSettle', 'merchantPayoutsPending']);
  });

  it('API trả khoá web chưa biết (triển khai lệch phiên bản) thì bỏ qua, các thẻ còn lại vẫn hiện', async () => {
    stubInbox([
      { key: 'khoaMoiChuaCoNhan', count: 4 },
      { key: 'merchantToSettle', count: 1 },
    ]);
    const r = render(<OpsInboxTab onOpen={vi.fn()} />);
    mounted.push(r);
    await flush();
    expect(r.container.querySelector('[data-inbox="merchantToSettle"]')).not.toBeNull();
    expect(r.container.querySelector('[data-inbox="khoaMoiChuaCoNhan"]')).toBeNull();
    expect(r.container.textContent).not.toContain('Không tải được');
  });

  it('mọi khoá của hộp việc có nhãn tiếng Việt có dấu và gợi ý', () => {
    for (const [key, l] of Object.entries(INBOX_LABELS)) {
      expect(l.title.length, key).toBeGreaterThan(5);
      expect(l.hint.length, key).toBeGreaterThan(5);
    }
  });
});
