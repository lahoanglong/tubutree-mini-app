import { CATEGORY_RULES, CATEGORY_SUGGEST_AUTO_MIN, suggestCategories } from './category-suggest';

/** Bảy danh mục seed (apps/api/prisma/seed.ts), cũng là bảy danh mục đang có trên PROD. */
const SEED_CATEGORIES = new Set(['cat-skincare', 'cat-cleaning', 'cat-baby', 'cat-mom', 'cat-personal', 'cat-coffee', 'cat-food']);

const CLEAN = ['cat-cleaning'];
const SKIN = ['cat-skincare'];
const PERSONAL = ['cat-personal'];
const FOOD = ['cat-food'];
const DRINK = ['cat-coffee'];

/**
 * 111 sản phẩm đang bán trên PROD (`GET /api/products`, 16/11/2026): tên và nhãn như thẻ sản phẩm. Danh mục kỳ vọng do người viết wave
 * gán tay theo loại hàng thật, không chép từ kết quả của hàm. `review` = cần người xem (độ tin cậy dưới ngưỡng chọn hàng loạt).
 */
const PROD_TABLE: Array<[name: string, brand: string, expected: string[], review?: 'review']> = [
  ['Xịt tràm cho bé Pineboo 150ml', 'Pineboo', ['cat-baby', 'cat-personal']],
  ['Bọt rửa tay cho bé Pineboo 300ml', 'Pineboo', ['cat-baby', 'cat-personal'], 'review'],
  ['Bọt tắm gội cho bé Pineboo 500ml', 'Pineboo', ['cat-baby', 'cat-personal']],
  ['Nước giặt cho bé Pineboo 2,1L', 'Pineboo', ['cat-baby', 'cat-cleaning']],
  ['Nước giặt cho bé Pineboo 500ml', 'Pineboo', ['cat-baby', 'cat-cleaning']],
  ['Bọt rửa bình sữa cho bé Pineboo 500ml', 'Pineboo', ['cat-baby', 'cat-cleaning']],
  ['Refill Nước rửa tay dạng Bọt Fuwa3e 10L', 'Fuwa3e', CLEAN],
  ['Lau nội thất ô tô Fuwa3e 300ml', 'Fuwa3e', CLEAN],
  ['Xịt khử mùi ô tô Fuwa3e 150ml', 'Fuwa3e', CLEAN],
  ['Xịt thơm hương Xuân Fuwa3e 300ml', 'Fuwa3e', CLEAN],
  ['Refill Nước lau sàn Quế Fuwa3e 10L', 'Fuwa3e', CLEAN],
  ['Nước lau sàn Sả chanh Fuwa3e 100ml', 'Fuwa3e', CLEAN],
  ['Nước ngâm rửa thực phẩm Fuwa3e 100ml', 'Fuwa3e', CLEAN],
  ['Vệ sinh nhà tắm và toilet Fuwa3e 100ml', 'Fuwa3e', CLEAN],
  ['Refill nước giặt Bạc hà Fuwa3e 10L', 'Fuwa3e', CLEAN],
  ['Nước giặt hương Bạc hà Fuwa3e 3,5L', 'Fuwa3e', CLEAN],
  ['Nước giặt hương Bạc hà Fuwa3e 500ml', 'Fuwa3e', CLEAN],
  ['Nước giặt hương Bạc hà Fuwa3e 100ml', 'Fuwa3e', CLEAN],
  ['Nước giặt hương Cam Fuwa3e 500ml', 'Fuwa3e', CLEAN],
  ['Nước giặt hương Cam Fuwa3e 100ml', 'Fuwa3e', CLEAN],
  ['Nước rửa tay dạng Bọt Fuwa3e 3,8L', 'Fuwa3e', CLEAN],
  ['Nước rửa tay dạng Bọt Fuwa3e 300ml', 'Fuwa3e', CLEAN],
  ['Refill Nước rửa tay dạng Gel Fuwa3e 10L', 'Fuwa3e', CLEAN],
  ['Gel rửa chén cho máy Fuwa3e 500ml', 'Fuwa3e', CLEAN],
  ['Gel rửa chén cho máy Fuwa3e 100ml', 'Fuwa3e', CLEAN],
  ['Nước rửa chén Fuwa3e 100ml', 'Fuwa3e', CLEAN],
  ['Nước mùi già PƠ LANG 160ml', 'Pơ Lang', PERSONAL, 'review'],
  ['Dầu gội - Dầu xả quả bơ PƠ LANG 300g', 'Pơ Lang', PERSONAL],
  ['Combo son dưỡng PƠ LANG (1 thỏi có màu & 1 thỏi không màu)', 'Pơ Lang', SKIN],
  ['Combo sạch dịu nhẹ PƠ LANG (SRM & TT)', 'Pơ Lang', SKIN, 'review'],
  ['Sữa hạt gạo lứt nảy mầm BH.NONG - Lon 400g', 'BH.Nong', FOOD],
  ['Granola mix nuts túi tiện lợi BH.NONG', 'BH.Nong', FOOD],
  ['Bột hạt củ quả BH.NONG - Lon 400g', 'BH.Nong', FOOD],
  ['Bánh mầm hạt rong biển BH.NONG', 'BH.Nong', FOOD],
  ['Đường hoa dừa Sokfarm - Hủ thủy tinh 150g', 'Sokfarm', FOOD],
  ['Mật cô đặc Sokfarm - Hộp 12 gói', 'Sokfarm', FOOD],
  ['Lau đa năng Fuwa3e 2L', 'Fuwa3e', CLEAN],
  ['Vệ sinh nhà tắm và toilet Fuwa3e 2L', 'Fuwa3e', CLEAN],
  ['Nước rửa tay dạng Gel Fuwa3e 300ml', 'Fuwa3e', CLEAN],
  ['Xoài sấy dẻo BH.NONG', 'BH.Nong', FOOD],
  ['Thanh gạo lứt chà bông BH.NONG 240g', 'BH.Nong', FOOD],
  ['[MIXED NUTS] Granola túi tiện lợi - Hạt dinh dưỡng nướng mộc', 'Tubu Tree', FOOD],
  ['[HỘP THIẾC] Bánh mầm hạt rong biển 225g', 'Tubu Tree', FOOD],
  ['[HỘP THIẾC] Bánh mầm hạt yến mạch 225g', 'Tubu Tree', FOOD],
  ['Cà phê sầu riêng túi 20x20g', 'Tubu Tree', DRINK],
  ['Cà phê muối túi 50x16g', 'Tubu Tree', DRINK],
  ['[CHO BÉ] Đường hoa dừa Sokfarm - Hủ thủy tinh 150g', 'Sokfarm', ['cat-baby', 'cat-food']],
  ['[CHO BÉ] Nước tương mật hoa dừa Sokfarm 200ml', 'Sokfarm', ['cat-baby', 'cat-food']],
  ['[CHO BÉ] Mật cô đặc Sokfarm 250g', 'Sokfarm', ['cat-baby', 'cat-food']],
  ['Nước uống mật hoa dừa tươi Sokfarm 330ml', 'Sokfarm', DRINK],
  ['Nước lau bàn thờ Fuwa3e 500ml', 'Fuwa3e', CLEAN],
  ['Nước giặt đồ lót Fuwa3e 500ml', 'Fuwa3e', CLEAN],
  ['Refill Nước ngâm rửa thực phẩm Fuwa3e 10L', 'Fuwa3e', CLEAN],
  ['Refill Nước lau sàn Sả chanh Fuwa3e 10L', 'Fuwa3e', CLEAN],
  ['Refill nước giặt Cam Fuwa3e 10L', 'Fuwa3e', CLEAN],
  ['Refill Nước rửa chén Fuwa3e 10L', 'Fuwa3e', CLEAN],
  ['Nước rửa chén Fuwa3e 500ml', 'Fuwa3e', CLEAN],
  ['Nước ngâm rửa thực phẩm Fuwa3e 1L', 'Fuwa3e', CLEAN],
  ['Nước lau đa năng FUWA3E 500ml', 'Fuwa3e', CLEAN],
  ['Nước lau sàn Sả chanh Fuwa3e 1L', 'Fuwa3e', CLEAN],
  ['Gel rửa chén cho máy Fuwa3e 2000ml', 'Fuwa3e', CLEAN],
  ['Muối rửa chén cho máy Fuwa3e 2kg', 'Fuwa3e', CLEAN],
  ['Nước rửa tay dạng Gel Fuwa3e 3,8L', 'Fuwa3e', CLEAN],
  ['Nước ngâm rửa thực phẩm Fuwa3e 3,8L', 'Fuwa3e', CLEAN],
  ['Nước hỗ trợ xả & làm bóng Fuwa3e 500ml', 'Fuwa3e', CLEAN],
  ['Refill Vệ sinh bồn cầu Fuwa3e 10L', 'Fuwa3e', CLEAN],
  ['Refill Gel rửa chén cho máy Fuwa3e 10L', 'Fuwa3e', CLEAN],
  ['Refill Lau đa năng Fuwa3e 10L', 'Fuwa3e', CLEAN],
  ['Vệ sinh nhà tắm và toilet Fuwa3e 500ml', 'Fuwa3e', CLEAN],
  ['Nước giặt hương Cam Fuwa3e 3,5L', 'Fuwa3e', CLEAN],
  ['Nước rửa chén Fuwa3e 3,8L', 'Fuwa3e', CLEAN],
  ['Dầu bơ tươi PƠ LANG 30ml/10ml', 'Pơ Lang', SKIN, 'review'],
  ['Nước tẩy trang PƠ LANG 300ml', 'Pơ Lang', SKIN],
  ['Dầu gội thảo dược PƠ LANG 300g', 'Pơ Lang', PERSONAL],
  ['Dầu rửa mặt PƠ LANG 100ml/55ml', 'Pơ Lang', SKIN],
  ['Sửa rửa mặt tạo bọt PƠ LANG 150ml', 'Pơ Lang', SKIN],
  ['Dầu ủ tóc PƠ LANG 50ml', 'Pơ Lang', PERSONAL],
  ['Mặt nạ bơ tươi PƠ LANG', 'Pơ Lang', SKIN],
  ['Mặt nạ ngủ PƠ LANG 30g', 'Pơ Lang', SKIN],
  ['Son dưỡng có màu PƠ LANG (A01, A03, A04, A05)', 'Pơ Lang', SKIN],
  ['Son dưỡng bơ tươi PƠ LANG A08', 'Pơ Lang', SKIN],
  ['Son dưỡng gấc tươi A07', 'Tubu Tree', SKIN],
  ['Dầu Gội Thảo Dược Sâm Visante Giảm Gãy Rụng 500ml – Cho Tóc Yếu Gãy Rụng, Chiết Xuất Sâm Việt Nam', 'Visante', PERSONAL],
  ['Dầu Xả Thảo Dược VISANTE Chiết Xuất Sâm Dưỡng Tóc Mềm Mượt 500ml', 'Visante', PERSONAL],
  ['Xịt Dưỡng Tóc VISANTE Thảo Dược Chiết Xuất Sâm Ngăn Rụng Tóc 100ml', 'Visante', PERSONAL],
  ['Tẩy Tế Bào Chết Da Đầu Thảo Dược VISANTE Làm Sạch Nhẹ Nhàng 150g', 'Visante', PERSONAL],
  ['Sữa Rửa Mặt Tạo Bọt VISANTE Chiết Xuát Sâm Làm Sạch Dịu Nhẹ 150ml', 'Visante', SKIN],
  ['Nước Tẩy Trang VISANTE Chiết Xuất Sâm Thiên Nhiên Dịu Nhẹ 250ml', 'Visante', SKIN],
  ['Nước tương mật hoa dừa SOKFARM (chấm)', 'Sokfarm', FOOD],
  ['Nước tương mật hoa dừa Sokfarm (nấu)', 'Sokfarm', FOOD],
  ['Mật hoa dừa cô đặc Sokfarm', 'Sokfarm', FOOD],
  ['Đường hoa dừa SOKFARM', 'Sokfarm', FOOD],
  ['Cà Phê Muối C&Sea Đậm Đà Thơm Béo Chuẩn Gu Huế Hộp 16g x 10 gói', 'Tubu Tree', DRINK],
  ['Cà Phê Sữa Dừa Hòa Tan KAFEDUA Le Plateau Thơm Béo 16g x 10 Gói', 'Le Plateau Coffee', DRINK],
  ['CÀ PHÊ TRỨNG AHANO – Chuẩn vị Hà Nội, thơm ngậy khó cưỡng', 'Tubu Tree', DRINK],
  ['Cà Phê Sầu Riêng Thơm Béo DURICA Le Plateau Hộp g x 10 Gói', 'Le Plateau Coffee', DRINK],
  ['Nước Nấm Đông Trùng Hạ Thảo Hector Collagen 50ml x 10 bổ sung collagen hỗ trợ đẹp da', 'Hector', DRINK, 'review'],
  ['Nước Đông Trùng Hạ Thảo HECTOR Collagen Plus Đẹp Da Chống Lão Hóa 70ml x 10 Chai', 'Hector', DRINK, 'review'],
  ['Nước Đông Trùng Hạ Thảo HECTOR Sâm Tăng Cường Sức Khỏe 70ml x 10 Chai', 'Hector', DRINK, 'review'],
  ['Nước Đông Trùng Hạ Thảo HECTOR Lite Thanh Lọc Cơ Thể 70ml x 10 Chai - điều hòa đường huyết', 'Hector', DRINK, 'review'],
  ['Nước Uống Sáng Da HECTOR White Collagen Đông Trùng Hạ Thảo 50ml x 10 Lọ', 'Hector', DRINK],
  ['Nước Nấm Đông Trùng Hạ Thảo HECTOR BASIC Dạng Túi 25ml x 10 Gói', 'Hector', DRINK, 'review'],
  ['Socola Hòa Tan Uống liền CHOCO-OKE', 'Tubu Tree', DRINK],
  ['Bánh mầm hạt yến mạch BH.NONG', 'BH.Nong', FOOD],
  ['Túi tím Granola BH.NONG 250g', 'BH.Nong', FOOD],
  ['Granola mix trái cây sấy BH.NONG - Lon 450g', 'BH.Nong', FOOD],
  ['Sữa Hạt Gạo Lứt Nảy Mầm BH.NONG Không Đường 400g gồm 18 loại hạt, thuần chay', 'BH.Nong', FOOD],
  ['Trà gạo lứt rẫy đậu đen BH.NONG 500g', 'BH.Nong', DRINK],
  ['Thanh gạo lứt rong biển BH.NONG 180g', 'BH.Nong', FOOD],
  ['Dầu Gội Thảo Dược Sâm Visante Trị Gàu Giảm Bết Dầu 500ml – Cho Tóc Gàu Bết Dầu, Chiết Xuất Sâm', 'Visante', PERSONAL],
  ['Nước Uống Đông Trùng Hạ Thảo Hector Thảo Mộc 25ml x 10 gói – Bồi Bổ Cơ Thể, Tăng Sức Đề Kháng', 'Hector', DRINK],
];

const sorted = (ids: readonly string[]) => [...ids].sort();

describe('suggestCategories — bảng 111 sản phẩm PROD', () => {
  it('bảng đủ 111 dòng, không trùng tên', () => {
    expect(PROD_TABLE).toHaveLength(111);
    expect(new Set(PROD_TABLE.map(([n]) => n)).size).toBe(111);
  });

  // Hàng đủ 4 cột: jest truyền hàm `done` vào tham số thừa khi hàng ngắn hơn số tham số của hàm test.
  it.each(PROD_TABLE.map(([name, brand, expected, review]) => [name, brand, expected, review === 'review'] as const))('%s', (name, brand, expected, review) => {
    const s = suggestCategories({ name, brand }, SEED_CATEGORIES);
    expect(sorted(s.categoryIds)).toEqual(sorted(expected));
    if (review) expect(s.confidence).toBeLessThan(CATEGORY_SUGGEST_AUTO_MIN);
    else expect(s.confidence).toBeGreaterThanOrEqual(CATEGORY_SUGGEST_AUTO_MIN);
  });

  it('đếm: 102 sản phẩm chọn hàng loạt được, 9 cần người xem, không sản phẩm nào trống gợi ý', () => {
    const all = PROD_TABLE.map(([name, brand]) => suggestCategories({ name, brand }, SEED_CATEGORIES));
    expect(all.filter((s) => s.confidence >= CATEGORY_SUGGEST_AUTO_MIN)).toHaveLength(102);
    expect(all.filter((s) => s.confidence < CATEGORY_SUGGEST_AUTO_MIN)).toHaveLength(9);
    expect(all.filter((s) => s.categoryIds.length === 0)).toHaveLength(0);
  });

  it('nhãn trong cột brand là "Tubu Tree" (đồng bộ Pancake) thì đọc nhãn từ tên như thẻ sản phẩm', () => {
    expect(suggestCategories({ name: 'Dầu bơ tươi PƠ LANG 30ml/10ml', brand: 'Tubu Tree' }, SEED_CATEGORIES).categoryIds).toEqual(SKIN);
    expect(suggestCategories({ name: 'Bọt tắm gội cho bé Pineboo 500ml', brand: 'Tubu Tree' }, SEED_CATEGORIES).categoryIds.sort()).toEqual(['cat-baby', 'cat-personal']);
    expect(suggestCategories({ name: 'Xịt khử mùi ô tô Fuwa3e 150ml', brand: '' }, SEED_CATEGORIES).categoryIds).toEqual(CLEAN);
  });
});

describe('suggestCategories — luật', () => {
  it('mọi luật trỏ tới một trong bảy danh mục seed', () => {
    for (const r of CATEGORY_RULES) expect(SEED_CATEGORIES.has(r.categoryId)).toBe(true);
  });

  it('không bao giờ gợi ý danh mục không có trong DB (đã xoá hoặc đã có mục con)', () => {
    const withoutFood = new Set([...SEED_CATEGORIES].filter((id) => id !== 'cat-food'));
    const all = PROD_TABLE.map(([name, brand]) => suggestCategories({ name, brand }, withoutFood));
    expect(all.flatMap((s) => s.categoryIds).every((id) => withoutFood.has(id))).toBe(true);
    // Hàng chỉ có danh mục Thực phẩm thì không còn gợi ý gì.
    expect(suggestCategories({ name: 'Xoài sấy dẻo BH.NONG', brand: 'BH.Nong' }, withoutFood)).toEqual({ categoryIds: [], confidence: 0, matches: [] });
    expect(suggestCategories({ name: 'Nước rửa chén Fuwa3e 100ml', brand: 'Fuwa3e' }, new Set())).toEqual({ categoryIds: [], confidence: 0, matches: [] });
  });

  it('khớp trọn từ và giữ dấu: "trà" không khớp "tràm"/"tẩy trang", "đường" không khớp "dưỡng", "son" không khớp "sơn"', () => {
    expect(suggestCategories({ name: 'Tinh dầu tràm nguyên chất', brand: 'Tubu Tree' }, SEED_CATEGORIES).categoryIds).toEqual(PERSONAL);
    expect(suggestCategories({ name: 'Nước tẩy trang dịu nhẹ', brand: 'Tubu Tree' }, SEED_CATEGORIES).categoryIds).toEqual(SKIN);
    expect(suggestCategories({ name: 'Kem dưỡng thể hoa cúc', brand: 'Tubu Tree' }, SEED_CATEGORIES).categoryIds.includes('cat-food')).toBe(false);
    expect(suggestCategories({ name: 'Sơn móng hữu cơ', brand: 'Tubu Tree' }, SEED_CATEGORIES).categoryIds).toEqual([]);
  });

  it('dấu thanh kiểu cũ và kiểu mới ("hòa"/"hoà", "thủy"/"thuỷ") khớp như nhau', () => {
    const DRINK_ONLY = { name: 'Cà phê hoà tan Le Plateau', brand: 'Le Plateau' };
    expect(suggestCategories({ ...DRINK_ONLY, name: 'Cà phê hòa tan Le Plateau' }, SEED_CATEGORIES)).toEqual(suggestCategories(DRINK_ONLY, SEED_CATEGORIES));
    // "hoà tan" chặn luật Thực phẩm ở cả hai kiểu viết.
    expect(suggestCategories({ name: 'Bột ngũ cốc hòa tan BH.NONG', brand: 'BH.Nong' }, SEED_CATEGORIES).categoryIds.includes('cat-food')).toBe(false);
    expect(suggestCategories({ name: 'Bột ngũ cốc hoà tan BH.NONG', brand: 'BH.Nong' }, SEED_CATEGORIES).categoryIds.includes('cat-food')).toBe(false);
    const uy = [{ id: 'uy', label: 'thuỷ tinh', categoryId: 'cat-food', confidence: 0.95, terms: ['hũ thuỷ tinh'] }];
    expect(suggestCategories({ name: 'Mứt dâu - Hũ thủy tinh', brand: null }, SEED_CATEGORIES, uy).categoryIds).toEqual(FOOD);
  });

  it('hai loại hàng cùng khớp thì hạ dưới ngưỡng chọn hàng loạt; cho bé + một loại hàng thì không', () => {
    const mixed = suggestCategories({ name: 'Sữa tắm cà phê và mặt nạ bùn', brand: 'Tubu Tree' }, SEED_CATEGORIES);
    expect(mixed.categoryIds.length).toBeGreaterThan(1);
    expect(mixed.confidence).toBeLessThan(CATEGORY_SUGGEST_AUTO_MIN);
    const baby = suggestCategories({ name: 'Bọt tắm gội cho bé Pineboo 500ml', brand: 'Pineboo' }, SEED_CATEGORIES);
    expect(baby.confidence).toBeGreaterThanOrEqual(CATEGORY_SUGGEST_AUTO_MIN);
  });

  it('luật chỉ dựa vào nhãn chỉ dùng khi tên không có từ khoá nào; mỗi gợi ý kèm luật đã khớp', () => {
    const s = suggestCategories({ name: 'Dầu bơ tươi PƠ LANG 30ml/10ml', brand: 'Pơ Lang' }, SEED_CATEGORIES);
    expect(s.matches).toEqual([{ categoryId: 'cat-skincare', confidence: 0.7, ruleId: 'my-pham-nhan-chung', rule: 'Nhãn Pơ Lang/Visante (chưa rõ loại)' }]);
    const t = suggestCategories({ name: 'Trà gạo lứt rẫy đậu đen BH.NONG 500g', brand: 'BH.Nong' }, SEED_CATEGORIES);
    expect(t.matches.map((m) => m.ruleId)).toEqual(['do-uong']);
  });

  it('mẹ bầu', () => {
    expect(suggestCategories({ name: 'Kem ngừa rạn cho mẹ bầu 100ml', brand: 'Tubu Tree' }, SEED_CATEGORIES).categoryIds).toEqual(['cat-mom']);
  });

  it('tên không có từ khoá và nhãn không có luật thì không gợi ý', () => {
    expect(suggestCategories({ name: 'Quà tặng bí ẩn', brand: 'Tubu Tree' }, SEED_CATEGORIES)).toEqual({ categoryIds: [], confidence: 0, matches: [] });
  });
});
