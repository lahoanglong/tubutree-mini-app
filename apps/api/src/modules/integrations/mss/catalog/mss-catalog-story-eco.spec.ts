import { Prisma } from '@prisma/client';
import type { ModuleRef } from '@nestjs/core';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { ImageRegistryStale } from '../../../catalog/image-registry-stale';
import { EMPTY_MSS_PAYLOAD, type MssEcoFactProposal, type MssEnrichmentPayload } from '../../../catalog/mss-enrichment';
import type { MssClient } from '../mss.client';
import type { MssHealthService } from '../mss-health.service';
import { MSS_DOC_LIMITS, parseMssProductDoc, payloadSha256 } from './mss-catalog-doc';
import { enrichmentColumns, MssCatalogService, withTubuStoryVariations } from './mss-catalog.service';
import { mssEcoSourceNote, proposeMssEcoFacts } from './mss-eco-proposals';

const HOST = 'mss.example.test';
const img = (h: string) => `https://${HOST}/api/pub/media/${h}.webp`;

const story = (over: Record<string, unknown> = {}) => ({
  version: 1,
  enabled: true,
  cutoutUrl: img('cutout0001'),
  scenes: [
    {
      kind: 'variant_arc',
      items: [
        { variationId: 'pv1', label: '2L', ambient: 'leaf' },
        { variationId: 'pv9', label: '5L', ambient: 'sky' },
        { label: 'Túi', ambient: 'sand' },
      ],
    },
    {
      kind: 'ingredient_assembly',
      steps: [{ title: 'Bồ hòn', body: 'Ngâm qua đêm', layers: [{ id: 'l1', label: 'Bồ hòn', from: 'top', xPct: 50, yPct: 40, scale: 1, rotateDeg: 0, imageUrl: img('layer00001') }] }],
    },
  ],
  ...over,
});

const eco = (over: Record<string, unknown> = {}) => ({
  kind: 'PLASTIC_AVOIDED',
  variation_id: null,
  value_grams: 38,
  baseline_text: 'so với chai nhựa 2L mới',
  label: 'Bớt 38 g nhựa',
  co2_grams: null,
  source_url: 'https://fuwa3e.vn/bao-cao-2026',
  source_note: 'Cân vỏ túi refill',
  ...over,
});

function doc(enrichment: Record<string, unknown> = {}, pid = 'a1') {
  return {
    pancake_product_id: pid,
    mss_product_id: `m-${pid}`,
    state: 'published',
    published_version: 3,
    updated_at: '2026-11-18T01:00:00Z',
    enrichment: { title: `Tựa ${pid}`, ...enrichment },
  };
}

function parse(raw: unknown) {
  const r = parseMssProductDoc(raw, { mediaHosts: [HOST] });
  if (!r.ok) throw new Error(`không phân tích được: ${r.reason}`);
  return r.doc;
}

describe('tài liệu MSS: câu chuyện xanh (story_config)', () => {
  it('đúng khung ProductStoryConfig, ảnh là media MSS: giữ nguyên (mã biến thể Pancake đổi lúc ghép)', () => {
    const d = parse(doc({ story_config: story() }));
    expect(d.payload.storyConfig).toMatchObject({ version: 1, enabled: true, cutoutUrl: img('cutout0001') });
    expect(d.payload.storyConfig!.scenes[0]).toEqual({
      kind: 'variant_arc',
      items: [
        { variationId: 'pv1', label: '2L', ambient: 'leaf' },
        { variationId: 'pv9', label: '5L', ambient: 'sky' },
        { label: 'Túi', ambient: 'sand' },
      ],
    });
    expect(d.issues).toEqual({});
  });

  it.each([
    ['ảnh tách nền ngoài host', { cutoutUrl: 'https://evil.test/api/pub/media/cutout0001.webp' }],
    [
      'ảnh lớp nguyên liệu ngoài host',
      {
        scenes: [
          {
            kind: 'ingredient_assembly',
            steps: [{ title: 'A', body: '', layers: [{ id: 'l1', label: 'A', from: 'top', xPct: 1, yPct: 1, scale: 1, rotateDeg: 0, imageUrl: 'https://cdn.other.test/x.webp' }] }],
          },
        ],
      },
    ],
    ['sai khung (phiên bản lạ)', { version: 2 }],
    ['sai khung (cảnh lạ)', { scenes: [{ kind: 'fireworks' }] }],
  ])('%s: bỏ cả câu chuyện, đếm story_rejected, phần còn lại của tài liệu vẫn nhận', (_label, over) => {
    const d = parse(doc({ story_config: story(over) }));
    expect(d.payload.storyConfig).toBeUndefined();
    expect(d.issues).toEqual({ story_rejected: 1 });
    expect(d.payload.title).toBe('Tựa a1');
  });

  it('không gửi (hoặc gửi null) story_config / eco_facts: payload không có khoá mới, băm giống tài liệu trước wave (không ghi lại hàng loạt)', () => {
    const d = parse(doc());
    expect('storyConfig' in d.payload).toBe(false);
    expect('ecoFacts' in d.payload).toBe(false);
    expect(payloadSha256('published', parse(doc({ story_config: null, eco_facts: null })).payload)).toBe(payloadSha256('published', d.payload));
  });

  it('ảnh câu chuyện vào danh sách nguồn /img chịu đổi cỡ (chỉ khi đã xuất bản)', () => {
    const d = parse(doc({ story_config: story() }));
    expect(enrichmentColumns('published', d.payload).mediaUrls).toEqual([img('cutout0001'), img('layer00001')]);
    expect(enrichmentColumns('unpublished', d.payload).mediaUrls).toEqual([]);
  });
});

describe('tài liệu MSS: nhãn xanh đề xuất (eco_facts)', () => {
  it('đúng luật nhập Sự thật xanh: đọc thành đề xuất; thiếu link https hoặc sai luật thì bỏ và đếm; trùng (loại, biến thể) giữ dòng đầu', () => {
    const d = parse(
      doc({
        eco_facts: [
          eco(),
          eco({ kind: 'CERTIFICATION', value_grams: null, label: 'Ecocert', source_url: 'http://khong-an-toan.vn' }),
          eco({ kind: 'REFILL_PACK', value_grams: 10 }),
          eco({ kind: 'KHONG_CO' }),
          eco({ label: 'Bản trùng' }),
          eco({ kind: 'RETURNABLE_PACKAGING', value_grams: null, variation_id: 'pv1', label: 'Chai trả lại' }),
        ],
      }),
    );
    expect(d.payload.ecoFacts).toEqual([
      {
        kind: 'PLASTIC_AVOIDED',
        variationId: null,
        valueGrams: 38,
        baselineText: 'so với chai nhựa 2L mới',
        label: 'Bớt 38 g nhựa',
        co2Grams: null,
        sourceUrl: 'https://fuwa3e.vn/bao-cao-2026',
        sourceNote: 'Cân vỏ túi refill',
      },
      expect.objectContaining({ kind: 'RETURNABLE_PACKAGING', variationId: 'pv1', label: 'Chai trả lại' }),
    ]);
    expect(d.issues).toEqual({ eco_fact_rejected: 3 });
  });

  it(`quá ${MSS_DOC_LIMITS.ecoFacts} dòng: cắt và đếm; mục không phải object hoặc mã biến thể sai dạng: bỏ cả tài liệu (sai lược đồ)`, () => {
    const many = Array.from({ length: MSS_DOC_LIMITS.ecoFacts + 2 }, (_, i) => eco({ variation_id: `pv${i}` }));
    expect(parse(doc({ eco_facts: many })).issues).toEqual({ array_truncated: 1 });
    expect(parseMssProductDoc(doc({ eco_facts: ['rác'] }), { mediaHosts: [HOST] })).toEqual({ ok: false, reason: 'invalid_doc' });
    expect(parseMssProductDoc(doc({ eco_facts: [eco({ variation_id: 'có dấu cách' })] }), { mediaHosts: [HOST] })).toEqual({ ok: false, reason: 'invalid_doc' });
  });
});

describe('withTubuStoryVariations', () => {
  it('mã Pancake có ở Tubu thì đổi sang id Tubu; mã lạ thì bỏ variationId (mục vẫn hiện); không có vòng cung thì trả nguyên', () => {
    const p = parse(doc({ story_config: story() })).payload;
    const out = withTubuStoryVariations(p, new Map([['pv1', 'tubu-v1']]));
    expect(out.storyConfig!.scenes[0]).toEqual({
      kind: 'variant_arc',
      items: [
        { variationId: 'tubu-v1', label: '2L', ambient: 'leaf' },
        { label: '5L', ambient: 'sky' },
        { label: 'Túi', ambient: 'sand' },
      ],
    });
    expect(p.storyConfig!.scenes[0]).toMatchObject({ items: [{ variationId: 'pv1' }, { variationId: 'pv9' }, { label: 'Túi' }] });
    const plain: MssEnrichmentPayload = { ...EMPTY_MSS_PAYLOAD, title: 'x' };
    expect(withTubuStoryVariations(plain, new Map())).toBe(plain);
  });
});

describe('proposeMssEcoFacts', () => {
  const fact = (over: Partial<MssEcoFactProposal> = {}): MssEcoFactProposal => ({
    kind: 'PLASTIC_AVOIDED',
    variationId: null,
    valueGrams: 38,
    baselineText: null,
    label: 'Bớt 38 g nhựa',
    co2Grams: null,
    sourceUrl: 'https://fuwa3e.vn/bao-cao-2026',
    sourceNote: 'Cân vỏ túi',
    ...over,
  });

  function db(existing: Array<{ variationId: string | null; kind: string }> = []) {
    const findMany = jest.fn(async (_args: unknown) => existing);
    const create = jest.fn(async (_args: unknown) => ({}));
    return { productEcoFact: { findMany, create }, findMany, create };
  }

  it('chỉ tạo dòng NHÁP cho loại sản phẩm chưa có (mọi trạng thái); biến thể lạ không gắn nhầm lên cả sản phẩm', async () => {
    const d = db([{ variationId: null, kind: 'CERTIFICATION' }]);
    const res = await proposeMssEcoFacts(d as never, {
      productId: 'p1',
      pancakeProductId: 'a1',
      version: 3,
      facts: [
        fact(),
        fact({ kind: 'CERTIFICATION', valueGrams: null }),
        fact({ kind: 'REFILL_PACK', variationId: 'pv-la' }),
        fact({ kind: 'RETURNABLE_PACKAGING', variationId: 'pv1', valueGrams: null }),
      ],
      variations: new Map([['pv1', 'tubu-v1']]),
    });
    expect(res).toEqual({ proposed: 2, kept: 2 });
    expect(d.findMany).toHaveBeenCalledTimes(1);
    expect(d.create).toHaveBeenCalledTimes(2);
    expect(d.create.mock.calls[0]![0]).toEqual({
      data: expect.objectContaining({
        productId: 'p1',
        variationId: null,
        kind: 'PLASTIC_AVOIDED',
        status: 'DRAFT',
        sourceNote: 'Đề xuất từ MSS (sản phẩm Pancake a1, bản 3): Cân vỏ túi',
      }),
    });
    expect(d.create.mock.calls[1]![0]).toEqual({ data: expect.objectContaining({ variationId: 'tubu-v1', kind: 'RETURNABLE_PACKAGING', status: 'DRAFT' }) });
  });

  it('hai lượt chạy chồng: chỉ mục duy nhất chặn dòng thứ hai (P2002) thì đếm là giữ, lỗi khác thì ném', async () => {
    const d = db();
    const input = { productId: 'p1', pancakeProductId: 'a1', version: 3, facts: [fact()], variations: new Map<string, string>() };
    d.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    expect(await proposeMssEcoFacts(d as never, input)).toEqual({ proposed: 0, kept: 1 });
    d.create.mockRejectedValueOnce(new Error('db down'));
    await expect(proposeMssEcoFacts(d as never, input)).rejects.toThrow('db down');
  });

  it('ghi chú nguồn cắt theo trần cột', () => {
    expect(mssEcoSourceNote('a1', 3, 'x'.repeat(400))).toHaveLength(300);
    expect(mssEcoSourceNote('a1', 3, '')).toBe('Đề xuất từ MSS (sản phẩm Pancake a1, bản 3)');
  });
});

describe('MssCatalogService.applyPushed (MSS đẩy tài liệu)', () => {
  const OLD_ENV = process.env.MSS_BASE_URL;
  beforeAll(() => {
    process.env.MSS_BASE_URL = `https://${HOST}`;
  });
  afterAll(() => {
    process.env.MSS_BASE_URL = OLD_ENV;
  });

  function setup() {
    const exec = jest.fn().mockResolvedValue(1);
    const stateUpsert = jest.fn();
    const ecoCreate = jest.fn(async (_args: unknown) => ({}));
    const prisma = {
      mssCatalogSyncState: { upsert: stateUpsert },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'p-a', pancakeId: 'a1' }]) },
      variation: { findMany: jest.fn().mockResolvedValue([{ id: 'tubu-v1', productId: 'p-a', pancakeId: 'pv1' }]) },
      productMssEnrichment: { findMany: jest.fn().mockResolvedValue([]) },
      productEcoFact: { findMany: jest.fn().mockResolvedValue([]), create: ecoCreate },
      $executeRaw: exec,
    } as unknown as PrismaService;
    const request = jest.fn();
    const markStale = jest.fn();
    const invalidateCategoryCache = jest.fn();
    const moduleRef = { get: jest.fn(() => ({ invalidateCategoryCache })) } as unknown as ModuleRef;
    const health = { assertCapability: jest.fn(async () => true) } as unknown as MssHealthService;
    const svc = new MssCatalogService(prisma, { request } as unknown as MssClient, health, { markStale } as unknown as ImageRegistryStale, moduleRef);
    return { svc, prisma, exec, stateUpsert, ecoCreate, request, markStale, invalidateCategoryCache };
  }

  it('ghép như lượt kéo (kind push), không gọi MSS, không ghi dòng trạng thái kéo; câu chuyện mang id biến thể Tubu; nhãn xanh thành nháp', async () => {
    const f = setup();
    const stats = await f.svc.applyPushed([doc({ story_config: story(), eco_facts: [eco()] }), 'rác']);
    expect(stats).toMatchObject({ kind: 'push', received: 2, applied: 1, skipped: { invalid_doc: 1 }, ecoProposed: 1, ecoKept: 0 });
    expect(f.request).not.toHaveBeenCalled();
    expect(f.stateUpsert).not.toHaveBeenCalled();
    const payload = JSON.parse((f.exec.mock.calls[0] as unknown[])[5] as string) as MssEnrichmentPayload;
    expect(payload.storyConfig!.scenes[0]).toMatchObject({ items: [{ variationId: 'tubu-v1' }, { label: '5L' }, { label: 'Túi' }] });
    expect(f.ecoCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ productId: 'p-a', status: 'DRAFT' }) });
    expect(f.markStale).toHaveBeenCalled();
    expect(f.invalidateCategoryCache).toHaveBeenCalled();
  });

  it('tài liệu không đổi: vẫn thử lại nhãn xanh nháp (lần trước lỗi DB / biến thể mới có), không đếm lại nhãn giữ', async () => {
    const first = setup();
    first.ecoCreate.mockRejectedValueOnce(new Error('db down'));
    const raw = doc({ eco_facts: [eco()] });
    const firstStats = await first.svc.applyPushed([raw]);
    expect(firstStats.applied).toBe(1);
    expect(firstStats.ecoProposed).toBeUndefined();
    const sha = (first.exec.mock.calls[0] as unknown[]).find((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v));
    const again = setup();
    (again.prisma.productMssEnrichment.findMany as jest.Mock).mockResolvedValue([
      { productId: 'p-a', contentVersion: 3, mssUpdatedAt: new Date('2026-11-18T01:00:00Z'), sha256: sha },
    ]);
    const stats = await again.svc.applyPushed([raw]);
    expect(stats).toMatchObject({ applied: 0, unchanged: 1, ecoProposed: 1 });
    expect(stats.ecoKept).toBeUndefined();
    expect(again.exec).not.toHaveBeenCalled();
    expect(again.ecoCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ productId: 'p-a', kind: 'PLASTIC_AVOIDED', status: 'DRAFT' }) });
  });

  it('không gì được ghép: không xoá bộ đệm', async () => {
    const f = setup();
    f.exec.mockResolvedValue(0);
    const stats = await f.svc.applyPushed([doc()]);
    expect(stats.applied).toBe(0);
    expect(f.invalidateCategoryCache).not.toHaveBeenCalled();
  });
});
