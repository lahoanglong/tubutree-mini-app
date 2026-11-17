// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MssCatalogOpsCard as Card } from '@/lib/admin-client';
import { MssCatalogCard } from './mss-catalog-card';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const mount = () => {
  const r = render(<MssCatalogCard />);
  mounted.push(r);
  return r;
};

const URL_PART = '/admin/mss/catalog';
const offCard = (): Card => ({
  enabled: false,
  effective: false,
  lastRunAt: null,
  lastFinishedAt: null,
  lastFullAt: null,
  watermark: null,
  lastStatus: null,
  lastTrigger: null,
  lastError: null,
  lastStats: null,
  published: 0,
  unpublished: 0,
  removed: 0,
  pending: 0,
});
const runningCard = (): Card => ({
  ...offCard(),
  enabled: true,
  effective: true,
  lastRunAt: '2026-11-17T02:30:00.000Z',
  lastFinishedAt: '2026-11-17T02:31:00.000Z',
  lastFullAt: '2026-11-16T19:40:00.000Z',
  watermark: '2026-11-17T02:29:00.000Z',
  lastStatus: 'partial',
  lastTrigger: 'cron',
  lastError: 'GET catalog/products trang 3: timeout_after_10000ms_without_any_response_from_mss_host',
  lastStats: {
    kind: 'incremental',
    pages: 3,
    received: 120,
    applied: 40,
    unchanged: 70,
    skipped: { unknown_product: 6, stale_version: 2, invalid_doc: 0 },
    trimmed: { media_rejected: 3, html_emptied: 1 },
  },
  published: 111,
  unpublished: 2,
  removed: 1,
  pending: 4,
});
const stub = (card: Card | null, pull?: () => { status?: number; body: unknown }) => {
  const m = mockFetch({
    [`${URL_PART}/pull`]: pull ?? (() => ({ status: 202, body: { queued: true } })),
    [URL_PART]: card ? { body: card } : { status: 500, body: { message: 'boom' } },
  });
  vi.stubGlobal('fetch', m.fn);
  return m;
};
const stats = (r: Rendered) => Array.from(r.container.querySelectorAll('dl[aria-label="Số sản phẩm có nội dung MSS"] > div')).map((d) => d.textContent);
const reasons = (r: Rendered, label: string) => Array.from(r.container.querySelectorAll(`ul[aria-label="${label}"] > li`)).map((li) => li.textContent);

describe('MssCatalogCard', () => {
  it('mặc định PROD (cờ tắt, chưa kéo lần nào): nhãn Tắt, nói rõ PDP dùng nội dung Tubu, 4 ô số 0, chưa kéo, không danh sách lý do', async () => {
    stub(offCard());
    const r = mount();
    await flush(10);
    const text = r.container.textContent!;
    expect(text).toContain('Nội dung từ MSS');
    expect(text).toContain('Tắt');
    expect(text).toContain('trang sản phẩm dùng nội dung của Tubu');
    expect(stats(r)).toEqual(['Đang có nội dung bổ sung0', 'MSS đã gỡ xuất bản0', 'MSS đã xoá0', 'Mã chờ kéo0']);
    expect(text).toContain('Chưa kéo lần nào.');
    expect(r.container.querySelector('ul')).toBeNull();
    expect(byText(r.container, 'button', 'Kéo lại ngay')).not.toBeNull();
  });

  it('đang chạy: lần kéo gần nhất theo giờ Việt Nam, nguồn kích, trạng thái, số đếm, bỏ qua và cắt theo lý do bằng tiếng Việt, lỗi gần nhất', async () => {
    stub(runningCard());
    const r = mount();
    await flush(10);
    const text = r.container.textContent!;
    expect(text).toContain('Đang chạy');
    expect(stats(r)).toEqual(['Đang có nội dung bổ sung111', 'MSS đã gỡ xuất bản2', 'MSS đã xoá1', 'Mã chờ kéo4']);
    const last = r.container.querySelector('[data-testid="mss-catalog-last-run"]')!.textContent!;
    expect(last).toContain('Lần kéo gần nhất: 09:30 17/11/2026 (theo lịch 30 phút)');
    expect(last).toContain('Xong một phần');
    expect(last).toContain('Nhận 120, ghép 40, không đổi 70 (theo mốc, 3 trang)');
    expect(last).toContain('Kéo toàn bộ gần nhất: 02:40 17/11/2026');
    expect(reasons(r, 'Bị bỏ qua ở lần kéo gần nhất')).toEqual(['Sản phẩm chưa có trên Tubu6', 'Bản cũ hơn bản đã có2']);
    expect(reasons(r, 'Bị cắt hoặc lọc bớt')).toEqual(['Ảnh/video ngoài host cho phép3', 'Mô tả HTML rỗng sau khi lọc1']);
    expect(text).not.toMatch(/unknown_product|stale_version|media_rejected|invalid_doc/);
    expect(text).toContain('Lỗi gần nhất: GET catalog/products trang 3');
  });

  it('cờ bật mà chưa có hiệu lực: nhãn và câu riêng; lần kéo lỗi: nhãn Lần kéo lỗi; lý do lạ hiện mã gốc; hàng đợi không đọc được thì "—"', async () => {
    stub({ ...offCard(), enabled: true });
    const r = mount();
    await flush(10);
    expect(r.container.textContent).toContain('Chưa có hiệu lực');
    expect(r.container.textContent).toContain('chưa công bố năng lực catalog.enrichment');
    r.unmount();
    mounted = [];
    const failed = { ...runningCard(), lastStatus: 'failed' as const, pending: null };
    failed.lastStats = { ...failed.lastStats!, skipped: { brand_new_reason: 2 } as never, trimmed: {} };
    stub(failed);
    const r2 = mount();
    await flush(10);
    expect(r2.container.textContent).toContain('Lần kéo lỗi');
    expect(reasons(r2, 'Bị bỏ qua ở lần kéo gần nhất')).toEqual(['brand_new_reason2']);
    expect(stats(r2)[3]).toBe('Mã chờ kéo—');
  });

  it('Kéo lại ngay: POST /admin/mss/catalog/pull một lần, báo đã xếp lượt và tải lại thẻ', async () => {
    const m = stub(runningCard());
    const r = mount();
    await flush(10);
    const before = m.calls.filter((c) => c.url.endsWith(URL_PART)).length;
    click(byText(r.container, 'button', 'Kéo lại ngay'));
    await flush(10);
    const posts = m.calls.filter((c) => c.url.includes('/pull'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.init?.method).toBe('POST');
    expect(r.container.querySelector('[role="status"]')!.textContent).toContain('Đã xếp một lượt kéo toàn bộ');
    expect(m.calls.filter((c) => c.url.endsWith(URL_PART)).length).toBeGreaterThan(before);
  });

  it('409 (cờ chưa có hiệu lực): hiện đúng lý do tiếng Việt của máy chủ', async () => {
    const message = 'Cờ mss.catalog_enrichment_enabled chưa có hiệu lực (chưa bật, thiếu biến MSS hoặc MSS chưa công bố năng lực catalog.enrichment).';
    stub(offCard(), () => ({ status: 409, body: { statusCode: 409, message, error: 'Conflict' } }));
    const r = mount();
    await flush(10);
    click(byText(r.container, 'button', 'Kéo lại ngay'));
    await flush(10);
    expect(r.container.querySelector('[role="alert"]')!.textContent).toBe(message);
  });

  it('API lỗi: báo riêng trong thẻ, không ném', async () => {
    stub(null);
    const r = mount();
    await flush(10);
    expect(r.container.textContent).toContain('Không đọc được trạng thái nội dung từ MSS');
  });

  it('lỗi dài không tràn ngang ở 360px: lỗi break-all, nhãn lý do co được (min-w-0)', async () => {
    stub(runningCard());
    const r = mount();
    await flush(10);
    expect(r.container.querySelector('.break-all')!.textContent).toContain('timeout_after_10000ms');
    expect(r.container.querySelector('ul[aria-label="Bị bỏ qua ở lần kéo gần nhất"] li .min-w-0')).not.toBeNull();
  });
});
