import { describe, expect, it } from 'vitest';
import { isAbortError, loadCatalogForAudit, type CatalogAuditSource, type CatalogListRow } from './catalog-audit-loader';

const row = (n: number): CatalogListRow => ({ slug: `sp-${n}`, name: `Sản phẩm ${n}`, thumbnail: n % 2 ? null : `https://x/${n}.png`, inStock: n % 3 !== 0 });
const makeSource = (total: number, over: Partial<CatalogAuditSource> = {}): CatalogAuditSource & { listCalls: [number, number][]; detailCalls: string[] } => {
  const listCalls: [number, number][] = [];
  const detailCalls: string[] = [];
  return {
    listCalls,
    detailCalls,
    async listPage(page, limit) {
      listCalls.push([page, limit]);
      const from = (page - 1) * limit + 1;
      const rows = Array.from({ length: Math.max(0, Math.min(limit, total - from + 1)) }, (_, i) => row(from + i));
      return { rows, total };
    },
    async readDescription(slug) {
      detailCalls.push(slug);
      return slug === 'sp-2' ? '' : `Mô tả ${slug}`;
    },
    ...over,
  };
};

describe('loadCatalogForAudit', () => {
  it('đọc hết các trang theo meta.total rồi đọc mô tả từng sản phẩm, giữ nguyên thứ tự danh sách', async () => {
    const src = makeSource(5);
    const out = await loadCatalogForAudit(src, { pageSize: 2 });
    expect(src.listCalls).toEqual([[1, 2], [2, 2], [3, 2]]);
    expect(out.products.map((p) => p.slug)).toEqual(['sp-1', 'sp-2', 'sp-3', 'sp-4', 'sp-5']);
    expect(out.products[1]).toMatchObject({ name: 'Sản phẩm 2', thumbnail: 'https://x/2.png', inStock: true, description: '' });
    expect(out.products[2]).toMatchObject({ inStock: false, description: 'Mô tả sp-3' });
    expect(out.unreadable).toEqual([]);
    expect(src.detailCalls.sort()).toEqual(['sp-1', 'sp-2', 'sp-3', 'sp-4', 'sp-5']);
  });

  it('khớp lượt đọc thật của PROD: 111 sản phẩm, trang 100 rồi trang 2 còn 11, 111 lượt đọc chi tiết', async () => {
    const src = makeSource(111);
    const out = await loadCatalogForAudit(src);
    expect(src.listCalls).toEqual([[1, 100], [2, 100]]);
    expect(out.products).toHaveLength(111);
    expect(src.detailCalls).toHaveLength(111);
  });

  it('trang trả trùng slug chỉ giữ một; trang rỗng sớm thì dừng, không lặp vô hạn', async () => {
    const dup = makeSource(4, {
      async listPage(page) {
        return { rows: page === 1 ? [row(1), row(2), row(2)] : [], total: 99 };
      },
    });
    const out = await loadCatalogForAudit(dup, { pageSize: 3 });
    expect(out.products.map((p) => p.slug)).toEqual(['sp-1', 'sp-2']);
    const wrongTotal = makeSource(0, { async listPage(page) { return { rows: [row(page)], total: 1_000_000 }; } });
    const capped = await loadCatalogForAudit(wrongTotal, { maxPages: 3 });
    expect(capped.products).toHaveLength(3);
  });

  it('giới hạn số lần đọc chi tiết chạy cùng lúc', async () => {
    let inFlight = 0;
    let peak = 0;
    const src = makeSource(20, {
      async readDescription() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight -= 1;
        return 'ok';
      },
    });
    await loadCatalogForAudit(src, { concurrency: 4 });
    expect(peak).toBe(4);
  });

  it('một sản phẩm đọc chi tiết lỗi: mô tả của nó không được đoán (undefined), slug vào unreadable, các sản phẩm khác vẫn đọc', async () => {
    const src = makeSource(4, {
      async readDescription(slug) {
        if (slug === 'sp-3') throw new Error('boom');
        return '';
      },
    });
    const out = await loadCatalogForAudit(src);
    expect(out.unreadable).toEqual(['sp-3']);
    expect(out.products.find((p) => p.slug === 'sp-3')!.description).toBeUndefined();
    expect(out.products.find((p) => p.slug === 'sp-4')!.description).toBe('');
  });

  it('lỗi đọc danh sách làm hỏng cả lượt (không có dữ liệu nửa vời)', async () => {
    const src = makeSource(3, { async listPage() { throw new Error('mạng'); } });
    await expect(loadCatalogForAudit(src)).rejects.toThrow('mạng');
  });

  it('báo tiến độ: danh sách rồi từng lượt chi tiết tới đủ tổng', async () => {
    const seen: string[] = [];
    await loadCatalogForAudit(makeSource(3), { pageSize: 2, concurrency: 1, onProgress: (p) => seen.push(`${p.stage}:${p.done}/${p.total}`) });
    expect(seen).toEqual(['list:2/3', 'list:3/3', 'detail:1/3', 'detail:2/3', 'detail:3/3']);
  });

  it('hủy giữa chừng: ném lỗi hủy và không đọc thêm', async () => {
    const ctrl = new AbortController();
    const src = makeSource(30, {
      async readDescription(slug) {
        if (slug === 'sp-2') ctrl.abort();
        return 'ok';
      },
    });
    const err = await loadCatalogForAudit(src, { concurrency: 1, signal: ctrl.signal }).catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(src.detailCalls.length).toBeLessThan(30);
    const pre = new AbortController();
    pre.abort();
    const src2 = makeSource(3);
    expect(isAbortError(await loadCatalogForAudit(src2, { signal: pre.signal }).catch((e: unknown) => e))).toBe(true);
    expect(src2.listCalls).toEqual([]);
  });
});
