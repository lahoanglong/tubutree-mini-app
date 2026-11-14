import {
  applyBackfill,
  extractIngredientsFromText,
  parseBackfillArgs,
  parseVerifiedIngredients,
  planBackfill,
  renderReport,
  summarizeBackfill,
  type BackfillPlan,
  type BackfillProductInput,
  type BackfillStore,
} from './seo-backfill.core';

const T0 = new Date('2026-11-14T10:00:00.000Z');
const row = (o: Partial<BackfillProductInput> = {}): BackfillProductInput => ({
  id: 'p1',
  slug: 'tra-gung-tubu-aaaaaa',
  name: 'Trà gừng',
  brand: null,
  shortDesc: null,
  description: null,
  metaTitle: null,
  metaDesc: null,
  variations: [{ name: 'Hộp 20 gói', isActive: true }],
  isActive: true,
  storefrontId: null,
  ingredients: [],
  thumbnail: 'https://cdn.example/tra-gung.png',
  updatedAt: T0,
  ...o,
});

const planOne = (rows: BackfillProductInput[], opts?: Parameters<typeof planBackfill>[1]): BackfillPlan => {
  const [plan] = planBackfill(rows, opts);
  if (!plan) throw new Error('planBackfill trả mảng rỗng');
  return plan;
};

describe('extractIngredientsFromText', () => {
  it('lấy danh sách sau nhãn "Thành phần:" và dừng ở hết câu', () => {
    expect(extractIngredientsFromText('Thành phần: Bột gạo, đường, muối. Hạn sử dụng 12 tháng.')).toEqual({ ok: true, names: ['Bột gạo', 'đường', 'muối'] });
  });

  it('đọc được nhãn "Nguyên liệu" và "Ingredients" trong mô tả HTML', () => {
    expect(extractIngredientsFromText('<p>Nguyên liệu: Gừng tươi; mật ong</p>')).toEqual({ ok: true, names: ['Gừng tươi', 'mật ong'] });
    expect(extractIngredientsFromText('Ingredients: rice, sugar')).toEqual({ ok: true, names: ['rice', 'sugar'] });
  });

  it('không có nhãn thì KHÔNG đoán: trả lý do', () => {
    const r = extractIngredientsFromText('Trà gừng thơm ấm, dùng được cả ngày.');
    expect(r.ok).toBe(false);
  });

  it('mô tả trống hoặc null thì không có nguồn', () => {
    expect(extractIngredientsFromText(null).ok).toBe(false);
    expect(extractIngredientsFromText('   ').ok).toBe(false);
  });

  it('từ chối danh sách có tuyên bố bị chặn hoặc phần trăm', () => {
    expect(extractIngredientsFromText('Thành phần: Gừng, mật ong (60%)').ok).toBe(false);
    expect(extractIngredientsFromText('Thành phần: Gừng hữu cơ, mật ong').ok).toBe(false);
  });

  it('từ chối danh sách quá 8 thành phần thay vì cắt lặng lẽ', () => {
    const r = extractIngredientsFromText('Thành phần: a1, b2, c3, d4, e5, f6, g7, h8, i9');
    expect(r.ok).toBe(false);
  });
});

describe('extractIngredientsFromText — dạng dễ ghi sai thành phần', () => {
  const bad = (text: string) => extractIngredientsFromText(text).ok;

  it('nhãn đứng riêng một dòng (danh sách ở dòng dưới) thì từ chối, không lấy mỗi dòng đầu', () => {
    expect(bad('<p><strong>Thành phần:</strong></p><ul><li>Bột mì</li><li>Đường</li><li>Đậu phộng</li></ul>')).toBe(false);
    expect(bad('Thành phần:\nBột mì\nĐường\nĐậu phộng')).toBe(false);
  });

  it('danh sách chưa hết (có "…" hoặc "...") thì từ chối', () => {
    expect(bad('Thành phần: Cà phê, muối, sữa... và nhiều hương vị khác')).toBe(false);
    expect(bad('Thành phần: Cà phê, muối, sữa…')).toBe(false);
  });

  it('câu phủ định đứng trước nhãn ("không chứa thành phần:") thì từ chối', () => {
    expect(bad('Sản phẩm không chứa thành phần: paraben, SLS, cồn.')).toBe(false);
    expect(bad('Không chứa nguyên liệu: đường, sữa, gluten.')).toBe(false);
    expect(bad('Free of ingredients: paraben, sls')).toBe(false);
  });

  it('chữ giữ chỗ hay câu văn không phải tên thành phần thì từ chối', () => {
    expect(bad('Thành phần: xem trên bao bì sản phẩm.')).toBe(false);
    expect(bad('Thành phần: Đang cập nhật')).toBe(false);
    expect(bad('Nguyên liệu: được tuyển chọn kỹ từ nông trại Đà Lạt, phơi khô và rang mộc.')).toBe(false);
  });

  it('dính chữ khác sau danh sách (có dấu ":" thứ hai) thì từ chối', () => {
    expect(bad('Thành phần: Gạo lứt, đậu đỏ Hạn sử dụng: 12 tháng')).toBe(false);
  });

  it('gạch đầu dòng dính trong một dòng thì từ chối', () => {
    expect(bad('Thành phần: - Bột mì - Đường - Muối')).toBe(false);
  });

  it('"Key ingredients" là thành phần nổi bật, không phải danh sách đầy đủ', () => {
    expect(bad('Key ingredients: aloe vera, vitamin E.')).toBe(false);
  });

  it('dấu phẩy trong ngoặc không cắt tên; ngoặc lệch thì từ chối', () => {
    expect(extractIngredientsFromText('Thành phần: Nước, chất tạo ngọt (sorbitol, stevia), muối.')).toEqual({ ok: true, names: ['Nước', 'chất tạo ngọt (sorbitol, stevia)', 'muối'] });
    expect(bad('Thành phần: Nước, chất (sorbitol, muối')).toBe(false);
  });
});

describe('parseVerifiedIngredients', () => {
  it('đọc bản đồ slug sang danh sách tên', () => {
    expect(parseVerifiedIngredients('{"a-1":["Bột gạo","Đường"]}')).toEqual({ ok: true, value: { 'a-1': ['Bột gạo', 'Đường'] } });
  });
  it('từ chối JSON hỏng, không phải đối tượng, hoặc giá trị không phải mảng chuỗi', () => {
    expect(parseVerifiedIngredients('{').ok).toBe(false);
    expect(parseVerifiedIngredients('[]').ok).toBe(false);
    expect(parseVerifiedIngredients('{"a":"Bột gạo"}').ok).toBe(false);
    expect(parseVerifiedIngredients('{"a":[1]}').ok).toBe(false);
  });
});

describe('parseBackfillArgs', () => {
  it('mặc định là dry-run', () => {
    expect(parseBackfillArgs([])).toEqual({ ok: true, value: { apply: false, verifiedFile: null } });
  });
  it('--apply bật ghi, --verified-file nhận đường dẫn', () => {
    expect(parseBackfillArgs(['--apply', '--verified-file=/tmp/v.json'])).toEqual({ ok: true, value: { apply: true, verifiedFile: '/tmp/v.json' } });
  });
  it('--dry-run cùng --apply là mâu thuẫn', () => {
    expect(parseBackfillArgs(['--dry-run', '--apply']).ok).toBe(false);
  });
  it('cờ lạ bị từ chối', () => {
    expect(parseBackfillArgs(['--force']).ok).toBe(false);
    expect(parseBackfillArgs(['--verified-file=']).ok).toBe(false);
  });
});

describe('planBackfill — SEO', () => {
  it('điền cả metaTitle và metaDesc khi cả hai trống, đúng trần 65/155', () => {
    const plan = planOne([row()]);
    expect(plan.seo?.metaTitle).toBe('Trà gừng | Tubu Tree');
    expect(plan.seo?.metaDesc).toContain('Trà gừng.');
    expect(plan.seo!.metaTitle!.length).toBeLessThanOrEqual(65);
    expect(plan.seo!.metaDesc!.length).toBeLessThanOrEqual(155);
  });

  it('chỉ điền ô đang trống, giữ nguyên ô người đã duyệt', () => {
    const plan = planOne([row({ metaTitle: 'Trà gừng Tubu | Tubu Tree' })]);
    expect(plan.seo?.metaTitle).toBeUndefined();
    expect(plan.seo?.metaDesc).toBeDefined();
  });

  it('không lập kế hoạch SEO khi cả hai ô đã có', () => {
    const plan = planOne([row({ metaTitle: 'A | Tubu Tree', metaDesc: 'Mô tả đã duyệt.' })]);
    expect(plan.seo).toBeNull();
    expect(plan.status).toBe('COMPLETE');
  });

  it('bỏ qua sản phẩm đang ẩn và sản phẩm của đối tác', () => {
    const plans = planBackfill([row({ id: 'h', isActive: false }), row({ id: 'x', storefrontId: 'sf-1' })]);
    expect(plans.map((p) => p.status)).toEqual(['EXCLUDED', 'EXCLUDED']);
    expect(plans.every((p) => p.seo === null && p.ingredients === null)).toBe(true);
  });

  it('mô tả ngắn có tuyên bố cấm thì bản nháp bỏ câu đó, không để lọt vào metaDesc', () => {
    const plan = planOne([row({ shortDesc: 'Giúp chữa bệnh dạ dày hiệu quả.', description: null })]);
    expect(plan.status).toBe('ENRICH');
    expect(plan.seo!.metaDesc).not.toMatch(/chữa|bệnh/i);
  });

  it('bản nháp không qua kiểm tra (tên chứa "[object Object]") thì CHẶN, không ghi, nêu lý do', () => {
    const plan = planOne([row({ name: '[object Object]' })]);
    expect(plan.status).toBe('BLOCKED');
    expect(plan.seo).toBeNull();
    expect(plan.problems.join(' ')).toContain('[object Object]');
  });

  it('chạy lại sau khi đã ghi thì mọi dòng COMPLETE (idempotent)', () => {
    const first = planOne([row()]);
    const written = row({ metaTitle: first.seo!.metaTitle!, metaDesc: first.seo!.metaDesc! });
    const second = planOne([written]);
    expect(second.seo).toBeNull();
    expect(second.status).toBe('COMPLETE');
  });
});

describe('planBackfill — thành phần', () => {
  const seoDone = { metaTitle: 'A | Tubu Tree', metaDesc: 'Mô tả đã có.' };

  it('SP đã có thành phần thật thì không đụng', () => {
    const plan = planOne([row({ ...seoDone, ingredients: [{ name: 'Gừng' }] })]);
    expect(plan.ingredients).toBeNull();
    expect(plan.ingredientState).toBe('HAS');
  });

  it('thành phần chỉ có "[object Object]" vẫn tính là trống', () => {
    const plan = planOne([row({ ...seoDone, ingredients: ['[object Object]'], description: 'Thành phần: Gừng, mật ong.' })]);
    expect(plan.ingredients).toBeNull();
    expect(plan.ingredientState).toBe('UNRESOLVED');
  });

  it('nhãn "Thành phần:" trong mô tả chỉ là GỢI Ý: không ghi, nêu danh sách gợi ý trong kế hoạch', () => {
    const plan = planOne([row({ ...seoDone, description: 'Trà dễ uống. Thành phần: Gừng, mật ong.' })]);
    expect(plan.ingredients).toBeNull();
    expect(plan.status).toBe('COMPLETE');
    expect(plan.ingredientState).toBe('UNRESOLVED');
    expect(plan.ingredientSuggestion).toEqual(['Gừng', 'mật ong']);
  });

  it('không có nguồn thật thì để TRỐNG và ghi UNRESOLVED kèm lý do', () => {
    const plan = planOne([row({ ...seoDone, description: 'Trà gừng thơm ấm.' })]);
    expect(plan.ingredients).toBeNull();
    expect(plan.ingredientState).toBe('UNRESOLVED');
    expect(plan.ingredientReason).not.toBe('');
  });

  it('danh sách đã xác minh bằng mắt thắng mô tả', () => {
    const plan = planOne([row({ ...seoDone, description: 'Thành phần: Sai, sai.' })], { verified: { 'tra-gung-tubu-aaaaaa': ['Gừng', 'Mật ong'] } });
    expect(plan.ingredients).toEqual({ names: ['Gừng', 'Mật ong'], source: 'VERIFIED_FILE' });
  });

  it('danh sách xác minh vi phạm bộ chặn thì KHÔNG ghi', () => {
    const plan = planOne([row({ ...seoDone })], { verified: { 'tra-gung-tubu-aaaaaa': ['Gừng hữu cơ'] } });
    expect(plan.ingredients).toBeNull();
    expect(plan.ingredientState).toBe('UNRESOLVED');
  });

  it('danh sách xác minh không áp cho SP đã có thành phần', () => {
    const plan = planOne([row({ ...seoDone, ingredients: [{ name: 'Gừng' }] })], { verified: { 'tra-gung-tubu-aaaaaa': ['Khác'] } });
    expect(plan.ingredients).toBeNull();
  });
});

describe('applyBackfill', () => {
  const makeStore = (count = 1) => {
    const updateMany = jest.fn().mockResolvedValue({ count });
    return { store: { product: { updateMany } } as unknown as BackfillStore, updateMany };
  };

  it('dry-run không gọi updateMany', async () => {
    const rows = [row()];
    const { store, updateMany } = makeStore();
    const out = await applyBackfill(store, rows, planBackfill(rows), { apply: false });
    expect(updateMany).not.toHaveBeenCalled();
    expect(out).toEqual([{ slug: 'tra-gung-tubu-aaaaaa', status: 'DRY_RUN' }]);
  });

  it('apply ghi có điều kiện updatedAt, storefrontId null, isActive và chỉ các trường trong kế hoạch', async () => {
    const rows = [row()];
    const plans = planBackfill(rows, { verified: { 'tra-gung-tubu-aaaaaa': ['Gừng', 'mật ong'] } });
    const { store, updateMany } = makeStore();
    const out = await applyBackfill(store, rows, plans, { apply: true });
    expect(out).toEqual([{ slug: 'tra-gung-tubu-aaaaaa', status: 'APPLIED' }]);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'p1', updatedAt: T0, storefrontId: null, isActive: true });
    expect(Object.keys(arg.data).sort()).toEqual(['ingredients', 'metaDesc', 'metaTitle']);
    expect(arg.data.ingredients).toEqual([{ name: 'Gừng' }, { name: 'mật ong' }]);
  });

  it('không đụng cột SEO đã có (data thiếu khoá metaTitle)', async () => {
    const rows = [row({ metaTitle: 'A | Tubu Tree' })];
    const { store, updateMany } = makeStore();
    await applyBackfill(store, rows, planBackfill(rows), { apply: true });
    expect(Object.keys(updateMany.mock.calls[0][0].data)).toEqual(['metaDesc']);
  });

  it('ai đó sửa xen giữa (count 0) thì SKIPPED_CHANGED, không ném lỗi', async () => {
    const rows = [row()];
    const { store } = makeStore(0);
    const out = await applyBackfill(store, rows, planBackfill(rows), { apply: true });
    expect(out).toEqual([{ slug: 'tra-gung-tubu-aaaaaa', status: 'SKIPPED_CHANGED' }]);
  });

  it('dòng COMPLETE, EXCLUDED, BLOCKED không bao giờ bị ghi', async () => {
    const rows = [row({ id: 'c', metaTitle: 'A | Tubu Tree', metaDesc: 'B.', ingredients: [{ name: 'Gừng' }] }), row({ id: 'e', isActive: false }), row({ id: 'b', name: '[object Object]', ingredients: [{ name: 'Gừng' }] })];
    const { store, updateMany } = makeStore();
    await applyBackfill(store, rows, planBackfill(rows), { apply: true });
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('summarizeBackfill / renderReport', () => {
  const rows = [
    row({ id: 'a', slug: 'a-1', name: 'A', description: 'Thành phần: Gừng, mật ong.' }),
    row({ id: 'b', slug: 'b-2', name: 'B', metaTitle: 'B | Tubu Tree', metaDesc: 'B.', description: 'Chỉ là banner.' }),
    row({ id: 'c', slug: 'c-3', name: 'C', metaTitle: 'C | Tubu Tree', metaDesc: 'C.', ingredients: [{ name: 'Muối' }] }),
    row({ id: 'd', slug: 'd-4', isActive: false }),
  ];

  it('đếm đúng và nêu SKU còn thiếu thành phần', () => {
    const s = summarizeBackfill(planBackfill(rows, { verified: { 'a-1': ['Gừng', 'mật ong'] } }));
    expect(s.activeTotal).toBe(3);
    expect(s.seoWrites).toBe(1);
    expect(s.ingredientWrites).toBe(1);
    expect(s.emptySeoAfter).toBe(0);
    expect(s.unresolved.map((u) => u.slug)).toEqual(['b-2']);
  });

  it('emptySeoAfter đếm SP vẫn trống SEO sau kế hoạch (vì bị chặn)', () => {
    const s = summarizeBackfill(planBackfill([row({ id: 'z', slug: 'z-9', name: '[object Object]' })]));
    expect(s.emptySeoAfter).toBe(1);
    expect(s.seoWrites).toBe(0);
    expect(s.blocked.map((b) => b.slug)).toEqual(['z-9']);
  });

  it('báo cáo liệt kê SKU thiếu thành phần kèm ảnh để chủ hỏi nhãn hàng', () => {
    const plans = planBackfill(rows, { verified: { 'a-1': ['Gừng', 'mật ong'] } });
    const text = renderReport(plans, summarizeBackfill(plans));
    expect(text).toContain('b-2');
    expect(text).toContain('https://cdn.example/tra-gung.png');
    expect(text).not.toContain('d-4');
  });

  it('báo cáo nêu gợi ý từ mô tả kèm đoạn chữ gốc để người duyệt đối chiếu, và ghi rõ chưa ghi', () => {
    const r = [row({ id: 's', slug: 's-5', name: 'S', metaTitle: 'S | Tubu Tree', metaDesc: 'S.', description: 'Trà dễ uống. Thành phần: Gừng, mật ong.' })];
    const plans = planBackfill(r);
    const text = renderReport(plans, summarizeBackfill(plans));
    expect(text).toContain('Gừng, mật ong');
    expect(text).toContain('Trà dễ uống. Thành phần: Gừng, mật ong.');
    expect(text).toMatch(/gợi ý/i);
  });
});
