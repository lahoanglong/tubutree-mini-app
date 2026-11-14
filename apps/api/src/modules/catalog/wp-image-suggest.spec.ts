import { SUGGEST_MAX, buildWpMatcher, cleanWpName, nameTokens, parseWpCatalog, type WpCatalogItem } from './wp-image-suggest';

/** Tên và slug lấy từ kho WordPress thật (Store API, 14/11/2026), rút gọn. */
const CATALOG: WpCatalogItem[] = [
  { id: 8654, slug: 'ca-phe-muoi-csea', name: 'Cà Phê Muối C&Sea Đậm Đà Thơm Béo Chuẩn Gu Huế Hộp 16g x 10 gói' },
  { id: 8657, slug: 'ca-phe-sau-rieng-durica', name: 'Cà Phê Sầu Riêng Thơm Béo DURICA Le Plateau Hộp g x 10 Gói' },
  { id: 8655, slug: 'ca-phe-sua-dua-kafedua', name: 'Cà Phê Sữa Dừa Hòa Tan KAFEDUA Le Plateau Thơm Béo 16g x 10 Gói' },
  { id: 8656, slug: 'ca-phe-trung', name: 'CÀ PHÊ TRỨNG AHANO – Chuẩn vị Hà Nội, thơm ngậy khó cưỡng' },
  { id: 8927, slug: 'granola-mix-trai-cay-say-bh-nong', name: 'Granola mix trái cây sấy BH.NONG' },
  { id: 8916, slug: 'granola-sieu-hat-bh-nong', name: 'Ngũ Cốc Granola Siêu Hạt BH.NONG Ăn Sáng Dinh Dưỡng 250g' },
  { id: 8904, slug: 'banh-mam-gao-lut-bh-nong', name: 'Bánh Mầm Gạo Lứt BH.NONG Ít Ngọt 300g- tốt cho ăn kiêng thực dưỡng' },
  { id: 8949, slug: 'tra-gao-lut-ray-bh-nong', name: 'Trà Gạo Lứt Rẫy Đậu Đen BH.NONG 500g Rang Củi Tự Nhiên &#8211; thanh nhiệt' },
  { id: 8437, slug: 'mat-hoa-dua-tuoi-organic-sokfarm', name: 'Nước Uống Mật Hoa Dừa Tươi Hữu cơ SOKFARM nguyên chất 250ml, bù khoáng điện giải' },
  { id: 8454, slug: 'mat-hoa-dua-co-dac-organic-sokfarm', name: 'Mật Hoa Dừa Cô Đặc Hữu Cơ SOKFARM 250g vị ngọt thanh' },
  { id: 8482, slug: 'mat-hoa-dua-co-dac-organic-sokfarm-7kg', name: 'Mật Hoa Dừa Cô Đặc Hữu Cơ SOKFARM 7kg tiết kiệm' },
  { id: 8161, slug: 'son-duong-moi-co-mau-bo-tuoi-po-lang', name: 'Son dưỡng môi Pơ Lang có màu 3.5g an toàn cho mẹ bầu và trẻ nhỏ' },
  { id: 7022, slug: 'xit-ve-sinh-noi-that', name: 'Xịt vệ sinh nội thất ô tô đa năng hữu cơ FUWA3E 300ml' },
  { id: 7023, slug: 'tinh-dau-treo-xe-o-to-thien-nhienfuwa3e', name: 'Tinh dầu treo xe ô tô FUWA3E 10ml hương 4 mùa &#8211; khử mùi' },
];

const match = buildWpMatcher(CATALOG);
const ids = (name: string, brand: string) => match({ name, brand }).map((s) => s.source.id);

describe('nameTokens', () => {
  it('bỏ dấu, bỏ quy cách ở mọi cách viết và bỏ từ bao bì', () => {
    const base = ['mat', 'co', 'dac'];
    for (const spec of ['250g', '250 g', '250gr', '250 gram', '0,25kg', '1kg', '160ml', '10L', '50x16g', '20 x 20g', '12 gói', 'Hộp 12 gói']) {
      expect(nameTokens(`Mật cô đặc ${spec}`)).toEqual(base);
    }
    expect(nameTokens('Cà phê muối túi 50x16g')).toEqual(['ca', 'phe', 'muoi']);
    expect(nameTokens('Combo hộp thiếc lon refill thùng')).toEqual([]);
  });

  it('giữ chữ trong ngoặc vuông, bỏ trùng và số trần', () => {
    expect(nameTokens('[MIXED NUTS] Granola túi - Granola 2')).toEqual(['mixed', 'nuts', 'granola']);
  });

  it('giải mã ký tự đặc biệt của WordPress trước khi tách từ', () => {
    expect(nameTokens('Trà Gạo Lứt &#8211; thanh nhiệt &amp; ngon')).toEqual(['tra', 'gao', 'lut', 'thanh', 'nhiet', 'ngon']);
    expect(cleanWpName('Cà Phê C&amp;Sea &#8211; 16g&nbsp;x&bogus;10')).toBe('Cà Phê C&Sea – 16g x 10');
  });
});

describe('buildWpMatcher', () => {
  it('khớp dù khác quy cách và bao bì (túi 50x16g so với hộp 16g x 10 gói)', () => {
    expect(ids('Cà phê muối túi 50x16g', 'Tubu Tree')).toEqual([8654]);
    expect(ids('Cà phê muối hộp 10 gói 16g', 'Tubu Tree')).toEqual([8654]);
    expect(ids('Cà phê sầu riêng túi 20x20g', 'Tubu Tree')).toEqual([8657]);
    expect(ids('Cà phê trứng 250g', 'Tubu Tree')).toEqual([8656]);
  });

  it('hạng điểm: từ riêng nặng hơn từ chung, nên "Cà phê muối" không kéo cà phê sầu riêng lên đầu', () => {
    const [top, ...rest] = match({ name: 'Cà phê muối túi 50x16g', brand: 'Tubu Tree' });
    expect(top).toMatchObject({ source: { id: 8654, slug: 'ca-phe-muoi-csea' }, score: 1, shared: ['ca', 'phe', 'muoi'] });
    expect(rest).toEqual([]);
  });

  it('hãng ngoài bắt buộc khớp hãng trong tên hoặc slug WordPress; nhãn Tubu Tree không bị ràng hãng', () => {
    expect(ids('Granola mix nuts túi tiện lợi BH.NONG', 'BH.Nong')).toEqual([8927]);
    expect(ids('Granola mix nuts túi tiện lợi BH.NONG', 'Sokfarm')).toEqual([]);
    expect(ids('Granola mix trái cây sấy', 'Tubu Tree')).toEqual([8927]);
    expect(ids('Mật cô đặc Sokfarm - Hộp 12 gói', 'Sokfarm')).toEqual([8482, 8454]);
    expect(ids('Mật cô đặc Sokfarm - Hộp 12 gói', 'Pơ Lang')).toEqual([]);
  });

  it('chính tả hãng cũ (Sokfram) vẫn được ràng đúng hãng Sokfarm', () => {
    expect(ids('Nước uống mật hoa dừa tươi 330ml', 'Sokfram')).toEqual([8437]);
  });

  it('khoá hãng theo chữ liền không dấu: "Pơ Lang" khớp slug "po-lang" và chữ "Pơ Lang"', () => {
    expect(ids('Son dưỡng môi có màu', 'Pơ Lang')).toEqual([8161]);
    expect(ids('Son dưỡng môi có màu', 'Fuwa3e')).toEqual([]);
  });

  it('không gợi ý khi chỉ trùng một từ chung hoặc điểm dưới ngưỡng', () => {
    expect(ids('Xịt thơm hương Xuân Fuwa3e 300ml', 'Fuwa3e')).toEqual([]);
    expect(ids('Bánh mầm hạt rong biển', 'BH.Nong')).toEqual([]);
    expect(ids('Xoài sấy dẻo BH.NONG', 'BH.Nong')).toEqual([]);
  });

  it('tên toàn từ bao bì hoặc kho rỗng thì không gợi ý', () => {
    expect(ids('Combo hộp 12 gói', 'Tubu Tree')).toEqual([]);
    expect(buildWpMatcher([])({ name: 'Cà phê muối', brand: 'Tubu Tree' })).toEqual([]);
  });

  it('sản phẩm khác dòng nhưng cùng vài từ vẫn hiện để người duyệt tự loại, kèm điểm và từ khớp', () => {
    const [top] = match({ name: 'Xịt khử mùi ô tô Fuwa3e 150ml', brand: 'Fuwa3e' });
    expect(top).toMatchObject({ source: { id: 7023 }, shared: ['khu', 'mui', 'to'] });
    expect(top!.score).toBeGreaterThanOrEqual(0.5);
    expect(top!.score).toBeLessThan(1);
  });

  it('giữ tối đa SUGGEST_MAX ứng viên, sắp theo điểm giảm dần rồi tên ngắn trước', () => {
    const many: WpCatalogItem[] = Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, slug: `tra-gung-hop-${i}`, name: `Trà gừng mật ong${' thêm'.repeat(i)}` }));
    const out = buildWpMatcher(many)({ name: 'Trà gừng mật ong', brand: 'Tubu Tree' });
    expect(out).toHaveLength(SUGGEST_MAX);
    expect(out.map((s) => s.source.id)).toEqual([100, 101, 102]);
  });
});

describe('parseWpCatalog', () => {
  it('chỉ giữ sản phẩm có mã dương, slug an toàn, tên và ít nhất một ảnh; giải mã tên', () => {
    const img = [{ src: 'https://tubutree.com/wp-content/uploads/a.png' }];
    const out = parseWpCatalog([
      { id: 1, slug: 'ok-1', name: 'Tên &#8211; một', images: img },
      { id: 2, slug: 'khong-anh', name: 'Không ảnh', images: [] },
      { id: 3, slug: 'Slug Hoa', name: 'Slug lạ', images: img },
      { id: -4, slug: 'id-am', name: 'Mã âm', images: img },
      { id: 5.5, slug: 'id-le', name: 'Mã lẻ', images: img },
      { id: 6, slug: 'thieu-ten', name: '  ', images: img },
      { id: '7', slug: 'id-chuoi', name: 'Mã chuỗi', images: img },
      { id: 8, slug: 'thieu-anh', name: 'Thiếu trường ảnh' },
      null,
      'rác',
    ]);
    expect(out).toEqual([{ id: 1, slug: 'ok-1', name: 'Tên – một' }]);
    expect(parseWpCatalog({ not: 'array' })).toEqual([]);
  });
});
