import { FALLBACK_DESCRIPTION_MIN_CHARS, claimsIn, findProductCopyFallback, listProductCopyFallbackSlugs } from '@tubutree/shared-types';
import {
  MIN_DESCRIPTION_CHARS,
  NOT_WRITTEN,
  RICH_DESCRIPTION_MIN_CHARS,
  applyPlans,
  classifyFamily,
  copyViolations,
  descriptionState,
  hasIngredients,
  keepExistingDescription,
  loadHouseProducts,
  parseCliArgs,
  planEnrichment,
  planProduct,
  renderTable,
  summarize,
  type EnrichProductInput,
  type EnrichStore,
} from './catalog-copy-enrichment.core';

const T0 = new Date('2026-11-13T10:00:00.000Z');
const row = (o: Partial<EnrichProductInput> = {}): EnrichProductInput => ({
  id: 'p1',
  slug: 'xoai-say-deo-bh-nong-a1b2c3',
  name: 'Xoài sấy dẻo BH.Nong',
  isActive: true,
  approvalStatus: 'APPROVED',
  storefrontId: null,
  description: '',
  ingredients: null,
  storyConfig: null,
  updatedAt: T0,
  ...o,
});

/** Fuwa3e bậc 2: bảng dự phòng có cả mô tả lẫn thành phần (enzyme vỏ dứa). */
const FUWA = { slug: 'nuoc-giat-huong-cam-fuwa3e-500ml-9a8b7c', name: 'Nước giặt hương Cam Fuwa3e 500ml' };

function fakeStore(initial: EnrichProductInput[]) {
  const data = initial.map((r) => ({ ...r }));
  const calls = { updateMany: 0, findWheres: [] as unknown[], writeWheres: [] as unknown[] };
  const store = {
    product: {
      // Cố ý trả MỌI dòng, kể cả SKU đối tác, để spec chứng minh lõi tự loại chúng chứ không dựa vào bộ lọc của kho giả.
      findMany: async ({ where }: { where?: unknown } = {}) => {
        calls.findWheres.push(where);
        return data.map((r) => ({ ...r }));
      },
      updateMany: async ({ where, data: patch }: { where: { id: string; updatedAt: Date; storefrontId: null }; data: Record<string, unknown> }) => {
        calls.updateMany += 1;
        calls.writeWheres.push(where);
        const r = data.find((x) => x.id === where.id && x.updatedAt.getTime() === where.updatedAt.getTime() && x.storefrontId === where.storefrontId);
        if (!r) return { count: 0 };
        Object.assign(r, patch, { updatedAt: new Date(r.updatedAt.getTime() + 1000) });
        return { count: 1 };
      },
    },
  } as unknown as EnrichStore;
  return { store, data, calls };
}

describe('classifyFamily', () => {
  it.each([
    ['Trà gạo lứt rẫy đậu đen BH.Nong 500g', 'tra-thao-moc'],
    ['Mật ong rừng BH.Nong 500ml', 'mat-ong'],
    ['Bột rau má Sokfarm 150g', 'bot-rau-cu'],
    ['Xoài sấy dẻo BH.Nong', 'trai-cay-say'],
    ['Granola mix nuts túi tiện lợi', 'hat-dinh-duong'],
    ['Nước tương mật hoa dừa Sokfarm 200ml', 'gia-vi'],
    ['Nước giặt hương Cam Fuwa3e 500ml', 'san-pham-xanh'],
    ['Nước tẩy trang Pơ Lang 300ml', 'khac'],
  ])('%s -> %s', (name, family) => expect(classifyFamily(name)).toBe(family));

  it('"Bột rửa tay cho bé Pineboo" không bị nhận nhầm là bột rau củ', () => expect(classifyFamily('Bột rửa tay cho bé Pineboo 300ml')).toBe('san-pham-xanh'));
});

describe('descriptionState', () => {
  const name = 'Xoài sấy dẻo BH.Nong';
  it('trống, thẻ trống, khoảng trắng lạ là EMPTY', () => {
    for (const d of ['', '   ', '<p></p>', '<p>&nbsp;</p>', null, undefined]) expect(descriptionState(d, name)).toBe('EMPTY');
  });
  it('ngắn hơn 40 ký tự mà đúng bằng tên (bỏ dấu, hoa thường, dấu câu) là PLACEHOLDER', () => {
    expect(descriptionState('Xoài sấy dẻo BH.Nong', name)).toBe('PLACEHOLDER');
    expect(descriptionState('XOAI SAY DEO BH NONG.', name)).toBe('PLACEHOLDER');
    expect(descriptionState('<p>Xoài sấy dẻo BH.Nong</p>', name)).toBe('PLACEHOLDER');
  });
  it('ngắn hơn 40 ký tự mà có nội dung ngoài tên là SHORT_EDIT (người đã viết), kể cả tên kèm vài chữ, một phần tên, chữ không phải Latin', () => {
    for (const d of ['Hàng mới về, ngọt dịu', 'Xoài sấy dẻo BH.Nong 100g', 'Xoài sấy dẻo BH.Nong hương chanh', 'Xoài sấy', '★★★★★', 'Ngon tuyệt 美味']) expect(descriptionState(d, name)).toBe('SHORT_EDIT');
  });
  it('mô tả chỉ có ảnh/video/nhúng không có chữ nhưng không phải trống: giữ (SHORT_EDIT)', () => {
    for (const d of ['<p><img src="https://cdn.example/x.jpg"></p>', '<iframe src="https://example.com/v"></iframe>', '<video src="x.mp4"></video>']) expect(descriptionState(d, name)).toBe('SHORT_EDIT');
  });
  it(`từ ${MIN_DESCRIPTION_CHARS} ký tự trở lên là OK, đếm theo chữ người đọc chứ không đếm thẻ HTML`, () => {
    expect(descriptionState('x'.repeat(MIN_DESCRIPTION_CHARS), name)).toBe('OK');
    expect(descriptionState(`<p>${'x'.repeat(MIN_DESCRIPTION_CHARS - 1)}</p>`, name)).toBe('SHORT_EDIT');
  });
});

describe('hasIngredients', () => {
  it('nhận danh sách có tên, chuỗi có chữ; không nhận null, [], tên trống', () => {
    expect(hasIngredients([{ name: 'Rau má' }])).toBe(true);
    expect(hasIngredients(['Rau má'])).toBe(true);
    expect(hasIngredients('Rau má, lô hội')).toBe(true);
    for (const v of [null, undefined, [], [{ name: '' }], [{ name: ' ' }], '', {}, 3]) expect(hasIngredients(v)).toBe(false);
  });
  it('khớp màn Kiểm tra catalog: "[object Object]" Pancake từng ghi không phải thành phần thật', () => {
    expect(hasIngredients('[object Object]')).toBe(false);
    expect(hasIngredients([{ name: '[object Object]' }])).toBe(false);
  });
});

describe('copyViolations (Q13 và bộ chặn tuyên bố)', () => {
  it('bắt chính tả cũ, bỏ qua chính tả mới và địa danh hành chính', () => {
    for (const bad of ['hóa đơn', 'hòa tan', 'khỏe', 'thủy tinh', 'tùy chọn']) expect(copyViolations(bad)).toContain('chính tả Q13 kiểu cũ');
    for (const ok of ['hoá đơn', 'hoà tan', 'khoẻ', 'thuỷ tinh', 'tuỳ chọn', 'Thanh Hóa']) expect(copyViolations(ok)).toEqual([]);
  });
  it('bắt cả chữ hoa và dạng NFD (dấu tách rời), không để lọt qua regex', () => {
    expect(copyViolations('HŨ THỦY TINH')).toContain('chính tả Q13 kiểu cũ');
    expect(copyViolations('thủy tinh')).toContain('chính tả Q13 kiểu cũ');
    expect(copyViolations('THANH HÓA')).toEqual([]);
  });
  it('bắt tuyên bố cần giấy tờ hoặc công dụng y tế', () => {
    for (const bad of ['Sản phẩm hữu cơ', 'Xuất xứ Thanh Hoá', 'Giảm 30% mỡ', 'Chữa mất ngủ', 'Hoàn toàn tự nhiên']) expect(copyViolations(bad).length).toBeGreaterThan(0);
  });
});

describe('planProduct: chọn SKU', () => {
  it('SKU đối tác, đang ẩn, chưa duyệt bị loại (EXCLUDED), không bao giờ ghi', () => {
    expect(planProduct(row({ storefrontId: 'sf1' })).status).toBe('EXCLUDED');
    expect(planProduct(row({ isActive: false })).status).toBe('EXCLUDED');
    expect(planProduct(row({ approvalStatus: 'PENDING' })).status).toBe('EXCLUDED');
  });

  it('slug lạ chưa có nguồn: NO_SOURCE, không bịa chữ', () => {
    const plan = planProduct(row({ slug: 'mat-ong-rung-chua-co-nguon-123456', name: 'Mật ong rừng' }));
    expect(plan.status).toBe('NO_SOURCE');
    expect(plan.description).toBeUndefined();
    expect(plan.ingredients).toBeUndefined();
  });

  it('khớp theo slug gốc: có hay không có hậu tố băm Pancake đều nhận', () => {
    expect(planProduct(row({ slug: 'xoai-say-deo-bh-nong' })).status).toBe('ENRICH');
    expect(planProduct(row({ slug: 'xoai-say-deo-bh-nong-a1b2c3' })).status).toBe('ENRICH');
    expect(planProduct(row({ slug: 'XOAI-SAY-DEO-BH-NONG-A1B2C3' })).status).toBe('ENRICH');
  });

  it('chữ ghi ra đúng bằng chữ dự phòng có nguồn của shared-types', () => {
    const plan = planProduct(row());
    expect(plan.description).toEqual({ mode: 'FILL', before: 'EMPTY', value: findProductCopyFallback('xoai-say-deo-bh-nong')!.description });
  });

  it('thành phần dự phòng giữ cờ fromFallback để kịch bản tự sinh bỏ qua chúng', () => {
    const plan = planProduct(row(FUWA));
    expect(plan.ingredients?.mode).toBe('FILL');
    expect(plan.ingredients!.value.length).toBeGreaterThan(0);
    for (const i of plan.ingredients!.value) expect(i.fromFallback).toBe(true);
  });
});

describe('planProduct: không đè chữ người đã sửa', () => {
  const human = 'Xoài sấy dẻo loại một, vị ngọt dịu, đóng gói tay tại xưởng nhỏ.';

  it('mô tả dài do người viết được giữ, không có gì để ghi', () => {
    const plan = planProduct(row({ description: human, ingredients: [{ name: 'Xoài' }] }));
    expect(plan.status).toBe('COMPLETE');
    expect(plan.kept).toContain('description');
    expect(plan.description).toBeUndefined();
  });

  it('mô tả ngắn có nội dung riêng (SHORT_EDIT) cũng được giữ', () => {
    const plan = planProduct(row({ description: 'Hàng mới về, ngọt dịu' }));
    expect(plan.description).toBeUndefined();
    expect(plan.kept).toContain('description');
  });

  it('mô tả chỉ lặp tên (PLACEHOLDER) được bù như trống, không cần --force và không đánh dấu FORCE', () => {
    const body = row({ description: 'Xoài sấy dẻo BH.Nong', ingredients: [{ name: 'Xoài' }] });
    const plan = planProduct(body);
    expect(plan.status).toBe('ENRICH');
    expect(plan.description).toMatchObject({ mode: 'FILL', before: 'PLACEHOLDER' });
    expect(plan.kept).not.toContain('description');
    expect(planProduct(body, { force: true }).description?.mode).toBe('FILL');
  });

  it('PLACEHOLDER có hậu tố quy cách trong tên ("… 400g") vẫn được bù; chữ người viết thêm sau tên thì giữ', () => {
    const sized = row({ slug: 'bot-hat-cu-qua-bh-nong-lon-400g-9495bf', name: 'Bột hạt củ quả BH.NONG - Lon 400g', description: 'Bột hạt củ quả BH.NONG - Lon 400g' });
    expect(planProduct(sized).description?.mode).toBe('FILL');
    const edited = row({ description: 'Xoài sấy dẻo BH.Nong hết hàng' });
    expect(planProduct(edited).description).toBeUndefined();
  });

  it('keepExistingDescription: giữ mô tả đã có từ 40 ký tự khi Pancake chỉ gửi chữ ngắn hơn 40', () => {
    const rich = 'Xoài sấy dẻo BH.NONG. Xoài được sấy theo kiểu dẻo như tên gọi, dùng làm món ăn vặt hoặc ăn nhẹ.';
    expect(keepExistingDescription(rich, 'Xoài sấy dẻo')).toBe(true);
    expect(keepExistingDescription(rich, '<p>Xoài sấy dẻo BH.NONG</p>')).toBe(true);
    expect(keepExistingDescription(`<p>${rich}</p>`, 'Xoài sấy dẻo')).toBe(true);
  });

  it('keepExistingDescription: mô tả đang có chưa đạt chuẩn giàu (40..79) mà Pancake có chữ từ 40 ký tự, mô tả cũ ngắn, hoặc một bên trống thì không giữ', () => {
    const mid = 'Xoài sấy dẻo BH.NONG, dùng làm món ăn vặt hoặc ăn nhẹ.';
    expect(mid.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_CHARS);
    expect(mid.length).toBeLessThan(RICH_DESCRIPTION_MIN_CHARS);
    const longIncoming = 'Mô tả mới từ Pancake có đủ bốn mươi ký tự trở lên.';
    expect(longIncoming.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_CHARS);
    expect(keepExistingDescription(mid, longIncoming)).toBe(false);
    expect(keepExistingDescription('Xoài sấy dẻo', 'Xoài sấy dẻo BH.NONG')).toBe(false);
    expect(keepExistingDescription('', 'Xoài sấy dẻo')).toBe(false);
    expect(keepExistingDescription(mid, '')).toBe(false);
    expect(keepExistingDescription(mid, null)).toBe(false);
    expect(keepExistingDescription(null, 'Xoài sấy dẻo')).toBe(false);
    expect(keepExistingDescription('<p><br></p>', 'Xoài sấy dẻo')).toBe(false);
  });

  it('keepExistingDescription: Pancake gửi chữ ngắn kèm ảnh/video thì không giữ mô tả chưa đạt chuẩn giàu (ảnh là nội dung thật)', () => {
    const mid = 'Xoài sấy dẻo BH.NONG, dùng làm món ăn vặt hoặc ăn nhẹ.';
    expect(keepExistingDescription(mid, '<p>Thông tin sản phẩm</p><img src="https://cdn.example/a.jpg">')).toBe(false);
    expect(keepExistingDescription(mid, '<iframe src="https://cdn.example/v"></iframe>Xem')).toBe(false);
  });

  it('keepExistingDescription: Pancake chép tên dài từ 40 ký tự thì giữ khi có truyền tên; không truyền tên thì không giữ (mô tả đang có 40..79)', () => {
    const name = 'Cà Phê Muối C&Sea Đậm Đà Thơm Béo Chuẩn Gu Huế Hộp 16g x 10 Gói';
    const mid = 'Cà phê muối C&Sea, hộp 10 gói, mỗi gói 16g, dùng làm thức uống.';
    expect(name.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_CHARS);
    expect(mid.length).toBeLessThan(RICH_DESCRIPTION_MIN_CHARS);
    expect(keepExistingDescription(mid, name, name)).toBe(true);
    expect(keepExistingDescription(mid, name)).toBe(false);
    expect(keepExistingDescription(name, name, name)).toBe(false);
  });

  describe('keepExistingDescription: TubuTree là nguồn chuẩn của mô tả giàu từ 80 ký tự (W149A)', () => {
    const name = 'Xoài sấy dẻo BH.NONG';
    const rich = 'Xoài sấy dẻo BH.NONG. Xoài được sấy theo kiểu dẻo như tên gọi, dùng làm món ăn vặt hoặc ăn nhẹ.';
    const pancake120 = 'Mô tả mới do nhân viên gõ bên Pancake POS, dài đủ một trăm hai mươi ký tự để chắc chắn vượt xa mọi ngưỡng ngắn mà lớp bảo vệ cũ từng dùng.';

    it('ngưỡng giàu là đúng FALLBACK_DESCRIPTION_MIN_CHARS = 80', () => {
      expect(RICH_DESCRIPTION_MIN_CHARS).toBe(FALLBACK_DESCRIPTION_MIN_CHARS);
      expect(RICH_DESCRIPTION_MIN_CHARS).toBe(80);
      expect(rich.length).toBeGreaterThanOrEqual(80);
      expect(pancake120.length).toBeGreaterThanOrEqual(120);
    });

    it.each([
      ['rỗng', ''],
      ['null', null],
      ['chỉ HTML trống', '<p><br></p>'],
      ['ngắn dưới 40', 'Xoài sấy dẻo'],
      ['chép đúng tên', name],
      ['chữ dài 120 ký tự từ Pancake', pancake120],
      ['chữ dài bọc HTML', `<p>${pancake120}</p>`],
      ['chữ dài kèm ảnh', `<p>${pancake120}</p><img src="https://cdn.example/a.jpg">`],
      ['chỉ có video, không chữ', '<iframe src="https://cdn.example/v"></iframe>'],
    ])('mô tả TubuTree từ 80 ký tự đứng vững trước payload Pancake %s: không bao giờ ghi đè (có hay không truyền tên)', (_label, incoming) => {
      const isBlank = incoming === null || incoming === '' || incoming === '<p><br></p>' || incoming.startsWith('<iframe');
      // Pancake không có chữ (kể cả chỉ có video) không phải ca ghi đè: upsertProduct tự dùng lại mô tả đang có, nên hàm trả false là đúng.
      expect(keepExistingDescription(rich, incoming, name)).toBe(!isBlank);
      expect(keepExistingDescription(rich, incoming)).toBe(!isBlank);
    });

    it('mô tả TubuTree bọc HTML mà chữ nhìn thấy từ 80 ký tự cũng là giàu; chữ nhìn thấy dưới 80 thì chưa dù cả chuỗi HTML dài hơn 80', () => {
      expect(keepExistingDescription(`<p>${rich}</p>`, pancake120, name)).toBe(true);
      const htmlLong79 = `<p><strong>${'a'.repeat(79)}</strong></p>`;
      expect(htmlLong79.length).toBeGreaterThan(80);
      expect(keepExistingDescription(htmlLong79, pancake120, name)).toBe(false);
    });

    it('biên 79 / 80 ký tự: 80 giữ mọi chữ Pancake; 79 vẫn để chữ Pancake từ 40 ký tự ghi đè', () => {
      const t79 = 'a'.repeat(79);
      const t80 = 'a'.repeat(80);
      expect(keepExistingDescription(t80, pancake120, name)).toBe(true);
      expect(keepExistingDescription(t79, pancake120, name)).toBe(false);
      expect(keepExistingDescription(t79, 'ngắn', name)).toBe(true);
    });

    it.each([[''], [null], ['Xoài'], ['a'.repeat(39)], ['<p></p>']])(
      'mô tả TubuTree rỗng hoặc dưới 80 ký tự (%j) vẫn nhận mô tả thật từ Pancake (từ 40 ký tự, khác tên)',
      (existing) => {
        expect(keepExistingDescription(existing, pancake120, name)).toBe(false);
      },
    );

    it('mô tả 40..79 ký tự vẫn giữ lớp bảo vệ cũ: Pancake ngắn hoặc chép tên không đè, Pancake chữ thật thì đè', () => {
      const mid = 'Xoài sấy dẻo BH.NONG, dùng làm món ăn vặt hoặc ăn nhẹ.';
      expect(mid.length).toBeGreaterThanOrEqual(40);
      expect(mid.length).toBeLessThan(80);
      expect(keepExistingDescription(mid, 'Xoài sấy dẻo', name)).toBe(true);
      expect(keepExistingDescription(mid, name, name)).toBe(true);
      expect(keepExistingDescription(mid, pancake120, name)).toBe(false);
    });

    it('bản chép tên sản phẩm dài từ 80 ký tự KHÔNG bị nhầm là mô tả giàu: Pancake chữ thật vẫn thay được, tên đã chép thì không tự đè lên chính nó', () => {
      const longName = 'Cà Phê Muối C&Sea Đậm Đà Thơm Béo Chuẩn Gu Huế Hộp 16g x 10 Gói Thơm Ngon Đặc Biệt Nhập Khẩu Chính Hãng';
      expect(longName.length).toBeGreaterThanOrEqual(80);
      for (const copy of [longName, longName.toUpperCase(), `<p>${longName}</p>`, `${longName}.`]) {
        expect(keepExistingDescription(copy, pancake120, longName)).toBe(false);
        expect(descriptionState(copy, longName)).toBe('PLACEHOLDER');
      }
      expect(keepExistingDescription(longName, longName, longName)).toBe(false);
    });
  });

  it('descriptionState: bản chép tên từ 40 ký tự trở lên cũng là PLACEHOLDER; chữ dài có thêm nội dung vẫn là OK', () => {
    const name = 'Cà Phê Muối C&Sea Đậm Đà Thơm Béo Chuẩn Gu Huế Hộp 16g x 10 Gói';
    expect(descriptionState(name, name)).toBe('PLACEHOLDER');
    expect(descriptionState(`${name} hàng mới về kho miền Nam`, name)).toBe('OK');
  });

  it('copyViolations chặn mùi vị chưa có nguồn nhưng không chặn "Hương dứa" in trên bao bì', () => {
    expect(copyViolations('Tên sản phẩm nêu hương đậm đà thơm béo.')).toContain('mùi vị chưa có nguồn');
    expect(copyViolations('Bánh giòn tan.')).toContain('mùi vị chưa có nguồn');
    expect(copyViolations('Hương dứa. Quy cách 500ml.')).toEqual([]);
  });

  it('đủ 39 ký tự chữ thì chưa phải mô tả giàu hơn; đủ 40 thì giữ', () => {
    const t39 = 'a'.repeat(39);
    const t40 = 'a'.repeat(40);
    expect(keepExistingDescription(t39, 'ngắn')).toBe(false);
    expect(keepExistingDescription(t40, 'ngắn')).toBe(true);
    expect(keepExistingDescription(t40, t39)).toBe(true);
    expect(keepExistingDescription(t40, t40)).toBe(false);
  });

  it('mô tả chỉ có ảnh được giữ, không bị coi là trống', () => {
    const plan = planProduct(row({ description: '<p><img src="https://cdn.example/x.jpg"></p>', ingredients: [{ name: 'Xoài' }] }));
    expect(plan.description).toBeUndefined();
    expect(plan.kept).toContain('description');
  });

  it('mô tả tên kèm chữ của người ("… hương chanh") được giữ', () => {
    const plan = planProduct(row({ description: 'Xoài sấy dẻo BH.Nong hương chanh', ingredients: [{ name: 'Xoài' }] }));
    expect(plan.description).toBeUndefined();
  });

  it('thành phần đã có được giữ; trường còn trống vẫn được bù độc lập', () => {
    const plan = planProduct(row({ ...FUWA, ingredients: [{ name: 'Dịch chiết riêng' }] }));
    expect(plan.ingredients).toBeUndefined();
    expect(plan.kept).toContain('ingredients');
    expect(plan.description?.mode).toBe('FILL');
  });

  it('--force đè cả mô tả dài lẫn thành phần đã có, và đánh dấu FORCE', () => {
    const plan = planProduct(row({ ...FUWA, description: human, ingredients: [{ name: 'Dịch chiết riêng' }] }), { force: true });
    expect(plan.description?.mode).toBe('FORCE');
    expect(plan.ingredients?.mode).toBe('FORCE');
    expect(plan.status).toBe('ENRICH');
  });

  it('--force không ghi lại khi mô tả và thành phần đã đúng bằng chữ dự phòng (không chạy đi chạy lại)', () => {
    const fb = findProductCopyFallback(FUWA.slug)!;
    const plan = planProduct(row({ ...FUWA, description: fb.description, ingredients: fb.ingredients }), { force: true });
    expect(plan.description).toBeUndefined();
    expect(plan.ingredients).toBeUndefined();
    expect(plan.status).toBe('COMPLETE');
  });

  it('--force không bao giờ chạm SKU đối tác hay SKU thiếu nguồn', () => {
    expect(planProduct(row({ storefrontId: 'sf1', description: 'x' }), { force: true }).status).toBe('EXCLUDED');
    expect(planProduct(row({ slug: 'khong-co-nguon-123456' }), { force: true }).status).toBe('NO_SOURCE');
  });
});

describe('chữ dự phòng của cả catalog', () => {
  const slugs = listProductCopyFallbackSlugs();

  it('có chữ cho ít nhất 100 SKU (catalog PROD 111)', () => expect(slugs.length).toBeGreaterThanOrEqual(100));

  const allText = (slug: string): string => {
    const fb = findProductCopyFallback(slug)!;
    return [fb.description, ...fb.ingredients.flatMap((i) => [i.name, i.benefit ?? ''])].join('\n');
  };
  // Đối chứng độc lập với `copyViolations`: dùng thẳng bộ chặn của shared-types và bản regex Q13 chép lại từ diacritics-style.spec.ts.
  const OLD_TONE = /(?:[òóỏõọ][ae]|[ùúủũụ]y)(?![\p{L}])/iu;
  const dirty = (slug: string): boolean => claimsIn(allText(slug), 'strict').length > 0 || OLD_TONE.test(allText(slug).replace(/Thanh Hóa|Khánh Hòa/g, ''));

  it('SKU trống mà chữ dự phòng vi phạm thì BLOCKED_BY_GUARD, còn lại ghi được và sạch', () => {
    for (const slug of slugs) {
      const plan = planProduct(row({ id: slug, slug, name: slug }));
      if (dirty(slug)) {
        expect(plan.status).toBe('BLOCKED_BY_GUARD');
        expect(plan.description).toBeUndefined();
        expect(plan.ingredients).toBeUndefined();
      } else {
        expect(plan.status).toBe('ENRICH');
        expect(claimsIn(plan.description!.value, 'strict')).toEqual([]);
      }
    }
  });

  it('không chữ dự phòng nào của catalog vi phạm bộ chặn hay Q13 (apps/api không quét shared-types nên spec này là cổng duy nhất)', () => {
    expect(slugs.filter(dirty)).toEqual([]);
  });

  it('ghi xong rồi lập kế hoạch lại thì không còn gì để ghi, kể cả chữ dự phòng ngắn hơn 40 ký tự (không ghi đi ghi lại)', async () => {
    const usable = slugs.filter((s) => !dirty(s));
    const { store } = fakeStore(usable.map((slug) => row({ id: slug, slug, name: slug })));
    const first = await loadHouseProducts(store);
    await applyPlans(store, first, planEnrichment(first), { apply: true });
    const second = await loadHouseProducts(store);
    expect(planEnrichment(second).filter((p) => p.status === 'ENRICH').map((p) => p.slug)).toEqual([]);
    expect(planEnrichment(second, { force: true }).filter((p) => p.status === 'ENRICH').map((p) => p.slug)).toEqual([]);
  });
});

describe('planProduct: đường bị chặn (nguồn giả)', () => {
  const source = (description: string) => () => ({ description, ingredients: [] });

  it('chữ có chính tả Q13 cũ bị chặn, không ghi', () => {
    const plan = planProduct(row(), { source: source('Chai thủy tinh khối lượng tịnh 250 g của Sokfarm trong hộp giấy.') });
    expect(plan.status).toBe('BLOCKED_BY_GUARD');
    expect(plan.reason).toContain('Q13');
    expect(plan.description).toBeUndefined();
  });

  it('chữ có tuyên bố cần giấy tờ hoặc công dụng y tế bị chặn, kể cả khi dùng --force', () => {
    for (const text of ['Sản phẩm hữu cơ đạt chuẩn của Sokfarm trong hộp giấy.', 'Giúp chữa mất ngủ cho cả nhà dùng mỗi ngày trong hộp giấy.']) {
      expect(planProduct(row(), { source: source(text) }).status).toBe('BLOCKED_BY_GUARD');
      expect(planProduct(row({ description: 'Mô tả chủ hàng viết tay đủ dài, không nên bị đè bởi chữ vi phạm.' }), { force: true, source: source(text) }).status).toBe('BLOCKED_BY_GUARD');
    }
  });

  it('SKU đã đủ chữ không bị đánh dấu BLOCKED chỉ vì bảng dự phòng của nó có lỗi (bộ chặn chỉ xét chữ sắp ghi)', () => {
    const dirtySource = () => ({ description: 'Chai thủy tinh khối lượng tịnh 250 g của Sokfarm trong hộp giấy.', ingredients: [{ name: 'Xoài' }] });
    const plan = planProduct(row({ description: 'Mô tả chủ hàng viết tay đủ dài để không bị coi là sơ sài.', ingredients: [{ name: 'Xoài' }] }), { source: dirtySource });
    expect(plan.status).toBe('COMPLETE');
  });

  it('thành phần cũng bị chặn: ghi chú có tuyên bố, hoặc có phần trăm', () => {
    const withIngredient = (i: { name: string; benefit?: string; percentage?: number | string }) => () => ({ description: 'Xoài sấy dẻo BH.Nong, gói 100g, bao bì ghi rõ khối lượng tịnh.', ingredients: [i] });
    expect(planProduct(row(), { source: withIngredient({ name: 'Xoài', benefit: 'Hữu cơ' }) }).status).toBe('BLOCKED_BY_GUARD');
    expect(planProduct(row(), { source: withIngredient({ name: 'Xoài', percentage: 100 }) }).status).toBe('BLOCKED_BY_GUARD');
    expect(planProduct(row(), { source: withIngredient({ name: 'Xoài', benefit: 'Theo tên sản phẩm' }) }).status).toBe('ENRICH');
  });

  it('chữ sạch từ nguồn giả vẫn ghi được (chứng tỏ nguồn tiêm vào có tác dụng)', () => {
    expect(planProduct(row(), { source: source('Xoài sấy dẻo BH.Nong, gói 100g, bao bì ghi rõ khối lượng tịnh.') }).status).toBe('ENRICH');
  });
});

describe('applyPlans: dry-run và apply', () => {
  const HUMAN = 'Mô tả do chủ hàng viết tay, đủ dài để không bị coi là sơ sài.';
  const rows = () => [
    row({ id: 'a', slug: 'xoai-say-deo-bh-nong-a1b2c3' }),
    row({ id: 'b', ...FUWA, description: HUMAN }),
    row({ id: 'c', slug: 'xoai-say-deo-bh-nong-ffffff', storefrontId: 'sf1' }),
    row({ id: 'd', slug: 'khong-co-nguon-123456', name: 'Sản phẩm lạ' }),
  ];

  it('dry-run (mặc định) không gọi ghi và không đổi dữ liệu', async () => {
    const { store, data, calls } = fakeStore(rows());
    const loaded = await loadHouseProducts(store);
    const out = await applyPlans(store, loaded, planEnrichment(loaded), { apply: false });
    expect(calls.updateMany).toBe(0);
    expect(out.every((r) => r.status === 'DRY_RUN')).toBe(true);
    expect(data.find((r) => r.id === 'a')!.description).toBe('');
  });

  it('apply ghi đúng trường trống, giữ nguyên mô tả của chủ hàng, không đụng SKU đối tác hay thiếu nguồn', async () => {
    const { store, data } = fakeStore(rows());
    const loaded = await loadHouseProducts(store);
    const out = await applyPlans(store, loaded, planEnrichment(loaded), { apply: true });

    expect(out.map((r) => [r.slug, r.status])).toEqual([
      ['xoai-say-deo-bh-nong-a1b2c3', 'APPLIED'],
      [FUWA.slug, 'APPLIED'],
    ]);
    expect(data.find((r) => r.id === 'a')!.description).toBe(findProductCopyFallback('xoai-say-deo-bh-nong')!.description);
    const b = data.find((r) => r.id === 'b')!;
    expect(b.description).toBe(HUMAN);
    expect(hasIngredients(b.ingredients)).toBe(true);
    expect(data.find((r) => r.id === 'c')!.description).toBe('');
    expect(data.find((r) => r.id === 'd')!.description).toBe('');
  });

  it('chỉ đọc SKU nhà (where storefrontId null) và mọi lệnh ghi đều kèm storefrontId null cùng updatedAt đã đọc', async () => {
    const { store, calls } = fakeStore(rows());
    const loaded = await loadHouseProducts(store);
    expect(calls.findWheres).toEqual([{ storefrontId: null }]);
    await applyPlans(store, loaded, planEnrichment(loaded), { apply: true });
    expect(calls.writeWheres.length).toBeGreaterThan(0);
    for (const w of calls.writeWheres as { storefrontId: unknown; updatedAt: unknown }[]) {
      expect(w.storefrontId).toBeNull();
      expect(w.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('idempotent: chạy apply lần hai không còn gì để ghi và không gọi ghi nữa', async () => {
    const { store, calls } = fakeStore(rows());
    const first = await loadHouseProducts(store);
    await applyPlans(store, first, planEnrichment(first), { apply: true });
    const writesAfterFirst = calls.updateMany;

    const second = await loadHouseProducts(store);
    const plans = planEnrichment(second);
    expect(plans.filter((p) => p.status === 'ENRICH')).toEqual([]);
    expect(await applyPlans(store, second, plans, { apply: true })).toEqual([]);
    expect(calls.updateMany).toBe(writesAfterFirst);
  });

  it('người sửa xen giữa lúc đọc và lúc ghi thì dòng đó bị bỏ qua, không bị đè', async () => {
    const { store, data } = fakeStore([row({ id: 'a' })]);
    const loaded = await loadHouseProducts(store);
    const plans = planEnrichment(loaded);
    data[0]!.description = 'Admin vừa viết mô tả mới ngay lúc script đang chạy đây.';
    data[0]!.updatedAt = new Date(T0.getTime() + 500);
    const out = await applyPlans(store, loaded, plans, { apply: true });
    expect(out).toEqual([{ slug: 'xoai-say-deo-bh-nong-a1b2c3', status: 'SKIPPED_CHANGED' }]);
    expect(data[0]!.description).toBe('Admin vừa viết mô tả mới ngay lúc script đang chạy đây.');
  });

  it('--force + apply mới đè chữ đã có', async () => {
    const { store, data } = fakeStore([row({ id: 'b', ...FUWA, description: HUMAN })]);
    const loaded = await loadHouseProducts(store);
    await applyPlans(store, loaded, planEnrichment(loaded, { force: true }), { apply: true });
    expect(data[0]!.description).toBe(findProductCopyFallback(FUWA.slug)!.description);
  });
});

describe('summarize và renderTable', () => {
  it('đếm theo trạng thái, nhóm và số trường sẽ ghi; storyConfig NULL chỉ để báo cáo', () => {
    const plans = planEnrichment([
      row({ id: 'a' }),
      row({ id: 'b', ...FUWA, storyConfig: { version: 1 } }),
      row({ id: 'c', storefrontId: 'sf1' }),
      row({ id: 'd', slug: 'khong-co-nguon-123456', name: 'Sản phẩm lạ' }),
    ]);
    const s = summarize(plans);
    expect(s.total).toBe(4);
    expect(s.byStatus).toEqual({ ENRICH: 2, COMPLETE: 0, NO_SOURCE: 1, BLOCKED_BY_GUARD: 0, EXCLUDED: 1 });
    expect(s.descriptionWrites).toBe(2);
    expect(s.ingredientWrites).toBe(2);
    expect(s.storyConfigNull).toBe(2);
    expect(s.byFamily['trai-cay-say']).toBe(1);
  });

  it('bảng không in SKU đối tác và không in nội dung mô tả', () => {
    const plans = planEnrichment([row({ id: 'a' }), row({ id: 'c', slug: 'doi-tac-123456', storefrontId: 'sf1' })]);
    const table = renderTable(plans);
    expect(table).toContain('xoai-say-deo-bh-nong-a1b2c3');
    expect(table).not.toContain('doi-tac-123456');
    expect(table).not.toContain(findProductCopyFallback('xoai-say-deo-bh-nong')!.description);
  });

  it('NOT_WRITTEN nêu lý do cho 4 thứ không ghi (xuất xứ, cách dùng, bảo quản, storyConfig)', () => {
    expect(Object.keys(NOT_WRITTEN).sort()).toEqual(['origin', 'storageInstructions', 'storyConfig', 'usageInstructions']);
    for (const why of Object.values(NOT_WRITTEN)) expect(why.length).toBeGreaterThan(20);
  });
});

describe('parseCliArgs', () => {
  it('mặc định là dry-run, không force', () => expect(parseCliArgs([])).toEqual({ ok: true, value: { apply: false, force: false } }));
  it('--dry-run tường minh vẫn là dry-run', () => expect(parseCliArgs(['--dry-run'])).toEqual({ ok: true, value: { apply: false, force: false } }));
  it('--apply mới ghi; --force đi kèm được nhận', () => {
    expect(parseCliArgs(['--apply'])).toEqual({ ok: true, value: { apply: true, force: false } });
    expect(parseCliArgs(['--apply', '--force'])).toEqual({ ok: true, value: { apply: true, force: true } });
    expect(parseCliArgs(['--force'])).toEqual({ ok: true, value: { apply: false, force: true } });
  });
  it('--apply cùng --dry-run, hoặc cờ lạ, là lỗi', () => {
    expect(parseCliArgs(['--apply', '--dry-run']).ok).toBe(false);
    expect(parseCliArgs(['--aply']).ok).toBe(false);
  });
});
