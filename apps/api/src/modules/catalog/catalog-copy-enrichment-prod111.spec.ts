import { FALLBACK_DESCRIPTION_MAX_CHARS, FALLBACK_DESCRIPTION_MIN_CHARS, baseSlug, findProductCopyFallback, listProductCopyFallbackSlugs } from '@tubutree/shared-types';
import { applyPlans, copyViolations, planEnrichment, summarize, type EnrichProductInput, type EnrichStore } from './catalog-copy-enrichment.core';
import { PROD_HOUSE_SKUS_2026_11_13 as PROD } from './prod-house-skus.fixtures';

const T0 = new Date('2026-11-13T10:00:00.000Z');

/** Dòng đúng như PROD đọc 13/11/2026: mô tả rỗng, thành phần rỗng, storyConfig NULL. */
const prodRows = (o: Partial<EnrichProductInput> = {}): EnrichProductInput[] =>
  PROD.map((p, i) => ({
    id: `p${i}`,
    slug: p.slug,
    name: p.name,
    isActive: true,
    approvalStatus: 'APPROVED',
    storefrontId: null,
    description: '',
    ingredients: null,
    storyConfig: null,
    updatedAt: T0,
    ...o,
  }));

function fakeStore(initial: EnrichProductInput[]) {
  const data = initial.map((r) => ({ ...r }));
  const patches: Record<string, unknown>[] = [];
  const store = {
    product: {
      updateMany: async ({ where, data: patch }: { where: { id: string; updatedAt: Date; storefrontId: null }; data: Record<string, unknown> }) => {
        patches.push(patch);
        const r = data.find((x) => x.id === where.id && x.updatedAt.getTime() === where.updatedAt.getTime() && x.storefrontId === where.storefrontId);
        if (!r) return { count: 0 };
        Object.assign(r, patch, { updatedAt: new Date(r.updatedAt.getTime() + 1000) });
        return { count: 1 };
      },
    },
  } as unknown as EnrichStore;
  return { store, data, patches };
}

const fallbackOf = (slug: string) => findProductCopyFallback(slug)!;
const textsOf = (slug: string): string[] => {
  const fb = fallbackOf(slug);
  return [fb.description, ...fb.ingredients.flatMap((i) => Object.values(i).filter((v): v is string => typeof v === 'string'))];
};

describe('111 SKU nhà đang bán trên PROD (đọc 13/11/2026)', () => {
  it('fixture: 111 slug không trùng, mỗi slug đều có chữ dự phòng khớp theo slug gốc', () => {
    expect(PROD).toHaveLength(111);
    expect(new Set(PROD.map((p) => p.slug)).size).toBe(111);
    expect(PROD.filter((p) => !findProductCopyFallback(p.slug)).map((p) => p.slug)).toEqual([]);
  });

  it('bảng chữ dự phòng không có slug thừa so với 111 SKU PROD', () => {
    const prodBases = new Set(PROD.map((p) => baseSlug(p.slug)));
    const extra = listProductCopyFallbackSlugs().filter((s) => !prodBases.has(s));
    expect(extra).toEqual([]);
  });

  it('kế hoạch trên dữ liệu PROD: ENRICH 111, COMPLETE 0, NO_SOURCE 0, BLOCKED_BY_GUARD 0, EXCLUDED 0', () => {
    const s = summarize(planEnrichment(prodRows()));
    expect(s.byStatus).toEqual({ ENRICH: 111, COMPLETE: 0, NO_SOURCE: 0, BLOCKED_BY_GUARD: 0, EXCLUDED: 0 });
    expect(s.descriptionWrites).toBe(111);
    expect(s.ingredientWrites).toBe(98);
    expect(s.forced).toBe(0);
  });

  it('mọi mô tả sẽ ghi dài từ 80 đến 180 ký tự', () => {
    const outOfRange = planEnrichment(prodRows())
      .filter((plan) => plan.description!.value.length < FALLBACK_DESCRIPTION_MIN_CHARS || plan.description!.value.length > FALLBACK_DESCRIPTION_MAX_CHARS)
      .map((plan) => `${plan.slug}: ${plan.description!.value.length}`);
    expect(outOfRange).toEqual([]);
  });

  it('0 vi phạm bộ chặn tuyên bố và chính tả Q13 ở mô tả, tên thành phần và ghi chú thành phần của từng SKU', () => {
    const bad: string[] = [];
    for (const p of PROD) {
      for (const t of textsOf(p.slug)) {
        const v = copyViolations(t);
        if (v.length > 0) bad.push(`${p.slug}: "${t}" -> ${v.join(', ')}`);
      }
      for (const i of fallbackOf(p.slug).ingredients) if (i.percentage !== undefined) bad.push(`${p.slug}: ${i.name} có percentage`);
    }
    expect(bad).toEqual([]);
  });

  it('13 SKU không có nguồn thành phần để trống, không bịa; 98 SKU còn lại có ít nhất một thành phần', () => {
    const plans = planEnrichment(prodRows());
    expect(plans.filter((p) => !p.ingredients)).toHaveLength(13);
    expect(plans.filter((p) => p.ingredients && p.ingredients.value.length > 0)).toHaveLength(98);
  });

  it('mô tả Pancake chép tên (mọi độ dài, kể cả 29 tên từ 40 ký tự trở lên): cả 111 dòng được bù bằng FILL chứ không phải FORCE', () => {
    const stubs = prodRows().map((r) => ({ ...r, description: r.name }));
    expect(stubs.filter((r) => r.name.length >= 40)).toHaveLength(29);
    const plans = planEnrichment(stubs);
    expect(plans.filter((p) => !(p.description?.mode === 'FILL' && p.description.before === 'PLACEHOLDER')).map((p) => p.slug)).toEqual([]);
    const s = summarize(plans);
    expect(s.byStatus.ENRICH).toBe(111);
    expect(s.forced).toBe(0);
  });

  it('mô tả đã có từ 40 ký tự do người viết: giữ nguyên, chỉ bù thành phần còn trống', () => {
    const human = 'Mô tả do chủ hàng viết tay, dài hơn bốn mươi ký tự để được giữ nguyên.';
    const plans = planEnrichment(prodRows({ description: human }));
    expect(plans.filter((p) => p.description !== undefined || !p.kept.includes('description'))).toEqual([]);
    expect(plans.filter((p) => p.status === 'ENRICH')).toHaveLength(98);
    expect(plans.filter((p) => p.status === 'COMPLETE')).toHaveLength(13);
  });

  it('apply: ghi 111 dòng, chỉ có mô tả và thành phần, KHÔNG BAO GIỜ ghi storyConfig; chạy lại thì 111 dòng đều COMPLETE', async () => {
    const rows = prodRows();
    const { store, data, patches } = fakeStore(rows);
    const first = await applyPlans(store, rows, planEnrichment(rows), { apply: true });
    expect(first.filter((r) => r.status === 'APPLIED')).toHaveLength(111);
    for (const patch of patches) expect(Object.keys(patch).every((k) => k === 'description' || k === 'ingredients')).toBe(true);
    expect(data.filter((r) => r.storyConfig !== null)).toEqual([]);
    expect(data.filter((r) => r.description.length < FALLBACK_DESCRIPTION_MIN_CHARS)).toEqual([]);

    const again = planEnrichment(data);
    expect(summarize(again).byStatus).toEqual({ ENRICH: 0, COMPLETE: 111, NO_SOURCE: 0, BLOCKED_BY_GUARD: 0, EXCLUDED: 0 });
    expect(again.every((p) => !p.description && !p.ingredients)).toBe(true);
  });

  it('storyConfig đã có (khác NULL) không bị đụng ở bất kỳ nhánh nào, kể cả --force', async () => {
    const story = { version: 1, enabled: true, scenes: [] };
    const rows = prodRows({ storyConfig: story });
    const { store, data, patches } = fakeStore(rows);
    for (const force of [false, true]) await applyPlans(store, rows, planEnrichment(rows, { force }), { apply: true });
    expect(patches.length).toBeGreaterThan(0);
    for (const patch of patches) expect(patch).not.toHaveProperty('storyConfig');
    expect(data.filter((r) => r.storyConfig !== story)).toEqual([]);
  });
});
