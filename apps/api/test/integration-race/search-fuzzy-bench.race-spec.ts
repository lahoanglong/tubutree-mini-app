import { writeFileSync } from 'fs';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { SearchMatchService } from '../../src/modules/catalog/search-match.service';
import { SearchPopularService } from '../../src/modules/catalog/search-popular.service';
import { FUZZY_THRESHOLD, fuzzyMatchSql, fuzzySessionSql } from '../../src/modules/catalog/search-fuzzy';
import { foldVietnamese } from '../../src/modules/catalog/search-text';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { PROD_CATALOG_2026_11_12 } from '../../../../packages/app-core/src/commerce/prod-catalog-full.fixture';

/**
 * Chốt ngưỡng của bước chịu gõ sai trên Postgres THẬT (đề wave mục A.4, A.5): 60 truy vấn gõ sai sinh từ tên 111 món PROD (đổi chỗ 2 chữ
 * kề, thiếu 1 chữ, sai phím kề, thiếu dấu cách) phải tìm lại đúng món trong 5 kết quả đầu ≥ 85%; 20 truy vấn vô nghĩa phải rỗng ≥ 90%;
 * EXPLAIN ANALYZE bước hai dùng chỉ mục trigram một phần `products_active_approved_nameSearch_trgm_idx`; p95 < 80 ms trên 111 dòng và trên 5.550 dòng (111 món thật + 5.439 tên lạ: chữ của tên thật
 * dịch vòng 1–25 bước, cùng độ dài và cấu trúc từ, như một catalog lớn mà đa số món không liên quan tới từ khoá). Truy vấn vô nghĩa chỉ
 * đo trên 111 món thật: tên lạ dịch vòng cũng là chữ vô nghĩa nên khớp chúng không nói gì về catalog thật.
 *
 * Không sửa dòng của suite khác: món có sẵn trong DB (migration nạp 44 món mẫu, spec khác để lại, kể cả hàng nghìn dòng ẩn hay chờ duyệt)
 * vẫn nằm trong bảng lúc đo. Chỉ mục một phần chỉ chứa món đang bán + đã duyệt nên planner chọn nó bất kể bảng còn bao nhiêu dòng khác;
 * spec chèn thêm 3.000 dòng ẩn/chờ duyệt (đúng tình huống từng làm planner chọn chỉ mục btree) để chốt điều đó.
 * `SEARCH_BENCH_OUT=<file>` ghi bảng kết quả JSON cho báo cáo wave.
 */
const BENCH = 'bench';
/** Dòng mồi ẩn/chờ duyệt (tên giống catalog thật): chúng không được lọt vào kết quả hay làm planner đổi chỉ mục. */
const DECOY = 'benchdecoy';
const PARTIAL_INDEX = 'products_active_approved_nameSearch_trgm_idx';
const KEYBOARD: Record<string, string> = {
  a: 's', b: 'v', c: 'x', d: 's', e: 'r', g: 'h', h: 'g', i: 'o', k: 'l', l: 'k', m: 'n', n: 'm', o: 'i', p: 'o', r: 't', s: 'a', t: 'r', u: 'y', v: 'b', x: 'c', y: 'u',
};
const NONSENSE = [
  'qzxv', 'wkjh pqzx', 'xyzzy', 'bvcxz', 'zzqq lmnb', 'qwrtp', 'pkdjx', 'fghjk', 'zxcvb nm', 'qqqq',
  'jjjj kkkk', 'wxyz', 'hjkl', 'trpzw', 'mnbv cxz', 'plmqz', 'zkwq', 'xvqj', 'kqzt', 'vbnxq',
];

type Typo = 'swap' | 'drop' | 'neighbor' | 'nospace';
const TYPOS: Typo[] = ['swap', 'drop', 'neighbor', 'nospace'];
const isWord = (x: string | undefined) => !!x && /^[a-z]+$/.test(x);

/** Dãy từ ngắn nhất (2–4 từ liền nhau) của tên mà khớp chính xác ra ≤ 5 món kể cả món đích: khách gõ cụm đủ riêng để món đó lọt top 5. */
function distinctiveWindow(words: string[], folded: string[]): string[] {
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i + len <= words.length; i++) {
      const w = words.slice(i, i + len);
      if (w.some((x) => x.length < 2)) continue;
      if (folded.filter((n) => w.every((x) => n.includes(x))).length <= 5) return w;
    }
  }
  return words.slice(0, 4);
}

function applyTypo(window: string[], typo: Typo): string {
  const w = [...window];
  if (typo === 'nospace' && w.length >= 2) {
    const i = w.findIndex((x, k) => k < w.length - 1 && isWord(x) && isWord(w[k + 1]));
    const at = i >= 0 ? i : 0;
    w.splice(at, 2, w[at]! + w[at + 1]!);
    return w.join(' ');
  }
  let idx = 0;
  w.forEach((x, k) => {
    if (isWord(x) && x.length > (isWord(w[idx]) ? w[idx]!.length : 0)) idx = k;
  });
  const word = w[idx]!;
  const mid = Math.max(1, Math.floor(word.length / 2) - 1);
  if (typo === 'swap') w[idx] = word.slice(0, mid) + word[mid + 1] + word[mid] + word.slice(mid + 2);
  else if (typo === 'drop') w[idx] = word.slice(0, mid) + word.slice(mid + 1);
  else {
    const k = [...word].findIndex((c, j) => j > 0 && KEYBOARD[c]);
    w[idx] = k > 0 ? word.slice(0, k) + KEYBOARD[word[k]!]! + word.slice(k + 1) : `${word}j`;
  }
  return w.join(' ');
}

function buildQueries(): { q: string; slug: string; typo: Typo }[] {
  const rows = PROD_CATALOG_2026_11_12;
  const folded = rows.map((r) => foldVietnamese(r.name));
  const out: { q: string; slug: string; typo: Typo }[] = [];
  const stride = rows.length / 60;
  for (let n = 0; n < 60; n++) {
    const i = Math.floor(n * stride);
    const words = folded[i]!.split(' ').map((x) => x.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')).filter(Boolean);
    const typo = TYPOS[n % TYPOS.length]!;
    out.push({ q: applyTypo(distinctiveWindow(words, folded), typo), slug: rows[i]!.slug, typo });
  }
  return out;
}

const shiftLetters = (s: string, k: number) => s.replace(/[a-z]/g, (ch) => String.fromCharCode(97 + ((ch.charCodeAt(0) - 97 + k) % 26)));
const p95 = (ms: number[]) => [...ms].sort((a, b) => a - b)[Math.ceil(ms.length * 0.95) - 1]!;
const round1 = (n: number) => Math.round(n * 10) / 10;

describe('Bước chịu gõ sai — bộ 60 + 20 truy vấn, EXPLAIN, p95 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let fuzzyOn = false;
  let catalog: CatalogService;
  const report: Record<string, unknown> = { threshold: FUZZY_THRESHOLD };
  const warn = jest.spyOn(Logger.prototype, 'warn');
  const config = {
    get: async (key: string, fb: unknown) => (key === 'catalog.search_fuzzy_enabled' ? fuzzyOn : fb),
  } as unknown as SystemConfigService;

  const benchId = (c: number, i: number) => `${BENCH}${String(c).padStart(2, '0')}${String(i).padStart(3, '0')}`;

  async function seed(copies: number) {
    await prisma.variation.deleteMany({ where: { productId: { startsWith: BENCH } } });
    await prisma.product.deleteMany({ where: { id: { startsWith: BENCH } } });
    const rows0 = PROD_CATALOG_2026_11_12;
    // 3.000 dòng ẩn hoặc chờ duyệt: trước chỉ mục một phần, chừng này dòng isActive=false làm planner chọn products_isActive_isFeatured_idx
    // (đỏ khi chạy cả bộ race). 222 dòng đầu trùng đúng tên món thật (mỗi món một bản ẩn, một bản chờ duyệt): chúng chỉ lọt vào kết quả khi
    // cả bước gõ sai lẫn bước lọc cuối của CatalogService bỏ điều kiện isActive/approvalStatus; bỏ riêng ở bước gõ sai thì EXPLAIN mất chỉ mục
    // một phần (assert bên dưới đỏ). Phần còn lại dịch vòng 13 chữ để bước khớp chính xác không phải lọc bỏ hàng nghìn dòng trùng
    // tên: số đo p95 chỉ nói về catalog thật. Mã bắt đầu bằng BENCH nên afterAll xoá cùng.
    await prisma.product.createMany({
      data: Array.from({ length: 3_000 }, (_, k) => ({
        id: `${DECOY}${String(k).padStart(5, '0')}`,
        pancakeId: `${DECOY}-${k}`,
        brand: 'Bench',
        slug: `${DECOY}-${k}`,
        name: k < 2 * rows0.length ? rows0[k % rows0.length]!.name : `${shiftLetters(foldVietnamese(rows0[k % rows0.length]!.name), 13)} an ${k}`,
        description: 'bench',
        basePrice: 100_000,
        isActive: k % 2 === 0 ? false : true,
        approvalStatus: k % 2 === 0 ? ('APPROVED' as const) : ('PENDING_REVIEW' as const),
      })),
    });
    const rows = PROD_CATALOG_2026_11_12;
    for (let c = 0; c < copies; c++) {
      await prisma.product.createMany({
        data: rows.map((r, i) => ({
          id: benchId(c, i),
          pancakeId: `${BENCH}-${c}-${i}`,
          brand: 'Bench',
          slug: `${r.slug}-${BENCH}${c}`,
          name: c === 0 ? r.name : `${shiftLetters(foldVietnamese(r.name), 1 + ((c - 1) % 25))} ${c}`,
          description: 'bench',
          basePrice: 100_000,
          isActive: true,
          approvalStatus: 'APPROVED' as const,
          soldApp: (i * 7) % 13,
        })),
      });
      await prisma.variation.createMany({
        data: rows.map((r, i) => ({
          pancakeId: `${BENCH}-v-${c}-${i}`,
          productId: benchId(c, i),
          sku: `BENCH-${c}-${i}`,
          name: 'Mặc định',
          attributes: {},
          retailPrice: 100_000,
          stock: r.inStock ? 5 : 0,
          isActive: true,
        })),
      });
    }
    await prisma.$executeRawUnsafe('ANALYZE products');
  }

  async function measure(queries: { q: string; slug: string }[]) {
    let hit = 0;
    let decoys = 0;
    const ms: number[] = [];
    const misses: string[] = [];
    for (const { q, slug } of queries) {
      const t = performance.now();
      const res = await catalog.list({ page: 1, limit: 20, q });
      ms.push(performance.now() - t);
      decoys += res.data.filter((c: { id: string }) => c.id.startsWith(DECOY)).length;
      const top = res.data.slice(0, 5).map((c: { slug: string }) => c.slug);
      if (top.some((s: string) => s.startsWith(`${slug}-${BENCH}`))) hit++;
      else misses.push(q);
    }
    return { hit, total: queries.length, pct: round1((hit / queries.length) * 100), p95: round1(p95(ms)), misses, decoys };
  }

  // Chỉ chấm dòng của bench: chạy cả bộ race thì bảng còn sản phẩm của suite khác (tên ngẫu nhiên có thể gần từ vô nghĩa), không phải đối tượng đo.
  async function nonsense() {
    let emptyCount = 0;
    let foreign = 0;
    const ms: number[] = [];
    const leaks: string[] = [];
    for (const q of NONSENSE) {
      const t = performance.now();
      const res = await catalog.list({ page: 1, limit: 20, q });
      ms.push(performance.now() - t);
      const own = res.data.filter((c: { id: string }) => c.id.startsWith(BENCH)).length;
      foreign += res.data.length - own;
      if (own === 0) emptyCount++;
      else leaks.push(`${q} → ${own}`);
    }
    return { empty: emptyCount, total: NONSENSE.length, pct: round1((emptyCount / NONSENSE.length) * 100), p95: round1(p95(ms)), leaks, foreign };
  }

  async function explain(q: string, analyze = false): Promise<string> {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw(fuzzySessionSql());
      const head = analyze ? Prisma.sql`EXPLAIN (ANALYZE, COSTS OFF)` : Prisma.sql`EXPLAIN`;
      const rows = await tx.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`${head} ${fuzzyMatchSql(q)}`);
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    catalog = new CatalogService(prisma, undefined, undefined, undefined, new SearchMatchService(prisma, config));
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.variation.deleteMany({ where: { productId: { startsWith: BENCH } } });
      await prisma.product.deleteMany({ where: { id: { startsWith: BENCH } } });
    }
    if (process.env.SEARCH_BENCH_OUT) writeFileSync(process.env.SEARCH_BENCH_OUT, JSON.stringify(report, null, 2));
    warn.mockRestore();
    await moduleRef?.close();
  });

  const errors = () => warn.mock.calls.filter((c) => String(c[0]).includes('lỗi'));

  it('111 dòng: trước (cờ tắt) và sau (cờ bật); vô nghĩa rỗng; p95 < 80 ms', async () => {
    await seed(1);
    const queries = buildQueries();
    report.queries = queries;
    fuzzyOn = false;
    report.before = await measure(queries);
    report.nonsenseBefore = await nonsense();
    fuzzyOn = true;
    const after = await measure(queries);
    const junk = await nonsense();
    report.after111 = after;
    report.nonsense111 = junk;
    report.explain111 = await explain('dong trung ha thoa', true);
    expect(report.explain111).toContain(PARTIAL_INDEX);
    expect(after.pct).toBeGreaterThanOrEqual(85);
    expect(after.decoys).toBe(0);
    expect(junk.pct).toBeGreaterThanOrEqual(90);
    expect(after.p95).toBeLessThan(80);
    expect(errors()).toEqual([]);
  });

  it('cờ tắt: /products và suggest giống hệt đường cũ (CatalogService không có bước gõ sai) — so id, thứ tự, tổng, không thêm khoá', async () => {
    fuzzyOn = false;
    const legacy = new CatalogService(prisma);
    const exactNames = PROD_CATALOG_2026_11_12.filter((_, i) => i % 11 === 0).map((r) => foldVietnamese(r.name).split(' ').slice(0, 2).join(' '));
    const all = [...buildQueries().map((x) => x.q), ...NONSENSE, ...exactNames, 'nuoc gait', 'nuoc giat', 'tui vai'];
    const diffs: string[] = [];
    for (const q of all) {
      const [a, b] = await Promise.all([catalog.list({ page: 1, limit: 20, q }), legacy.list({ page: 1, limit: 20, q })]);
      const ids = (r: { data: { id: string }[] }) => r.data.map((c) => c.id).join(',');
      if (ids(a) !== ids(b) || a.meta.total !== b.meta.total || Object.keys(a).sort().join() !== Object.keys(b).sort().join()) diffs.push(`list ${q}`);
      const [sa, sb] = await Promise.all([catalog.suggest(q), legacy.suggest(q)]);
      if (JSON.stringify(sa) !== JSON.stringify(sb)) diffs.push(`suggest ${q}`);
    }
    report.flagOffParity = { queries: all.length, diffs };
    expect(diffs).toEqual([]);
  });

  it('5.550 dòng (111 thật + 5.439 tên lạ) cùng 3.000 dòng ẩn/chờ duyệt: EXPLAIN ANALYZE luôn dùng chỉ mục trigram một phần, p95 < 80 ms', async () => {
    await seed(50);
    fuzzyOn = true;
    const plan = await explain('dong trung ha thoa', true);
    report.explain5550 = plan;
    report.explain5550Common = await explain('nuoc gait', true);
    const queries = buildQueries();
    for (const q of queries.slice(0, 5)) await catalog.list({ page: 1, limit: 20, q: q.q });
    const after = await measure(queries);
    report.after5550 = { pct: after.pct, p95: after.p95 };
    expect(plan).toContain(PARTIAL_INDEX);
    expect(report.explain5550Common).toContain(PARTIAL_INDEX);
    expect(after.p95).toBeLessThan(80);
    expect(errors()).toEqual([]);
  });

  it('ký tự %, _, !, nháy đơn trong từ khoá: không lỗi SQL, không lùi về contains, bảng còn nguyên', async () => {
    await seed(1);
    fuzzyOn = true;
    for (const q of ["nuoc'giat", 'nuoc%giat', 'nuoc_giat!', "'; DROP TABLE products; --", '%%%%', '____', 'nuoc ! giat']) {
      await expect(catalog.list({ page: 1, limit: 20, q })).resolves.toBeDefined();
      await expect(catalog.suggest(q)).resolves.toBeDefined();
    }
    const pct = await catalog.list({ page: 1, limit: 20, q: '%%%%' });
    expect(pct.meta.total).toBe(0);
    expect(errors()).toEqual([]);
    expect(await prisma.product.count({ where: { id: { startsWith: BENCH }, NOT: { id: { startsWith: DECOY } } } })).toBe(111);
  });

  it('search/popular: ≥ 3 người khác nhau, có kết quả, khớp tên hàng; bỏ số điện thoại, email, cụm không phải tên hàng; bù dự phòng', async () => {
    const tag = `bench-pop-${Date.now()}`;
    const ev = (q: string, who: string, resultsCount: number, i: number) => ({
      eventId: `${tag}-${i}`,
      eventName: 'search_performed',
      occurredAt: new Date(),
      platform: 'miniapp',
      anonymousId: `${tag}-${who}`,
      props: { q, resultsCount },
    });
    const data = [
      ...['a', 'b', 'c'].map((w, i) => ev(i === 1 ? 'Nuoc giat' : 'nước giặt', w, 12, i)),
      ...['a', 'b', 'c', 'd'].map((w, i) => ev('0912 345 678', w, 1, 10 + i)),
      ...['a', 'b', 'c'].map((w, i) => ev('0912_345_678', w, 1, 50 + i)),
      ...['a', 'b', 'c'].map((w, i) => ev('cụm bơm vào không phải tên hàng', w, 5, 60 + i)),
      ...['a', 'b', 'c'].map((w, i) => ev('an@mail.com', w, 1, 20 + i)),
      ...['a', 'b'].map((w, i) => ev('cà phê', w, 3, 30 + i)),
      ...['a', 'b', 'c'].map((w, i) => ev('granola', w, 0, 40 + i)),
    ];
    await prisma.analyticsEvent.createMany({ data });
    try {
      const svc = new SearchPopularService(prisma, {
        get: async (k: string, fb: unknown) =>
          k === 'catalog.search_popular_enabled' ? true : k === 'catalog.search_popular_terms' ? ['rửa tay', 'Nước giặt'] : fb,
      } as unknown as SystemConfigService);
      const { terms } = await svc.popular();
      report.popular = terms;
      expect(terms).toEqual(['nước giặt', 'rửa tay']);
    } finally {
      await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: tag } } });
    }
  });
});
