/**
 * Dữ liệu "Hành trình nguyên liệu" (nhãn, tỉnh xuất xứ, vị trí ghim), giữ đúng như Mini App. Emoji là dữ liệu nhận diện từng nhãn
 * (hiện trong ô nhãn và ghim bản đồ), không phải icon chức năng.
 */
export interface BrandOrigin {
  /** Trùng id nhãn trong css/brand-theme.css (--color-brand-<id>-from/-to). */
  id: string;
  /** Tên hiển thị trong câu chuyện thương hiệu. */
  brand: string;
  /** Tên đúng như cột products.brand của catalog; dùng để lọc danh sách (xem brandBrowsePath). */
  catalogBrand: string;
  province: string;
  emoji: string;
  gradient: string;
  ingredient: string;
  story: string;
  /** Vị trí ghim trên bản đồ (% so với khung): đúng mảnh tỉnh xuất xứ trên bản đồ gỗ. */
  pin: { top: string; left: string };
  /** Tâm nhãn tên (% so với khung), đặt ở khoảng trống ngoài bản đồ; nối với ghim bằng một đường dẫn nên ghim sát nhau vẫn đọc được. */
  label: { top: string; left: string };
}

/** Đường kính vòng tròn ghim (px). */
export const PIN_CIRCLE = 22;
const PIN_LABEL_HEIGHT = 18;

export interface PinBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Hai hình chữ nhật (vòng tròn, nhãn tên) mà ghim chiếm trên khung bản đồ rộng `w`, cao `h` (px).
 * Nhãn chữ 9.5px đậm chiếm khoảng 6px mỗi ký tự cộng 16px đệm/viền; ước lượng thừa để test không hụt.
 */
export function pinBoxes(origin: BrandOrigin, frame: { w: number; h: number }): { circle: PinBox; label: PinBox } {
  const at = (p: { top: string; left: string }) => ({ x: (parseFloat(p.left) / 100) * frame.w, y: (parseFloat(p.top) / 100) * frame.h });
  const c = at(origin.pin);
  const l = at(origin.label);
  const r = PIN_CIRCLE / 2;
  const lw = origin.brand.length * 6 + 16;
  return {
    circle: { left: c.x - r, top: c.y - r, right: c.x + r, bottom: c.y + r },
    label: { left: l.x - lw / 2, right: l.x + lw / 2, top: l.y - PIN_LABEL_HEIGHT / 2, bottom: l.y + PIN_LABEL_HEIGHT / 2 },
  };
}

const gradient = (id: string) =>
  `linear-gradient(135deg, var(--color-brand-${id}-from), var(--color-brand-${id}-to))`;

export const BRAND_ORIGINS: BrandOrigin[] = [
  {
    id: 'fuwa3e',
    brand: 'Fuwa3e',
    catalogBrand: 'Fuwa3e',
    province: 'Thanh Hóa',
    emoji: '🍍',
    gradient: gradient('fuwa3e'),
    ingredient: 'Enzyme vỏ dứa & bồ hòn',
    story: 'Fuwa3e tận dụng nguồn vỏ dứa hữu cơ Thanh Hóa lên men sinh học cùng quả bồ hòn, làm nên dòng sản phẩm nước rửa chén, nước giặt lành tính cho cả gia đình và dòng nước.',
    pin: { top: '21.1%', left: '33.1%' },
    label: { top: '21.4%', left: '16.0%' },
  },
  {
    id: 'bhnong',
    brand: 'BH.Nong',
    catalogBrand: 'BH.Nong',
    province: 'Quảng Nam',
    emoji: '🍯',
    gradient: gradient('bhnong'),
    ingredient: 'Mật ong rừng & trà thảo mộc',
    story: 'BH.Nong sinh ra từ núi rừng Quảng Nam, mang đến mật ong rừng nguyên chất và các dòng trà thảo mộc thanh nhiệt đậm vị thiên nhiên.',
    pin: { top: '37.4%', left: '47.4%' },
    label: { top: '34.0%', left: '71.2%' },
  },
  {
    id: 'polang',
    brand: 'Pơ Lang',
    catalogBrand: 'Pơ Lang',
    province: 'Đắk Lắk',
    emoji: '🥑',
    gradient: gradient('polang'),
    ingredient: 'Bơ ca cao & dầu gừng bazan',
    story: 'Pơ Lang khai thác nông sản bazan Đắk Lắk — bơ ca cao ép lạnh, dầu gừng, bồ kết — làm nên sản phẩm chăm sóc da và tóc thuần thực vật.',
    pin: { top: '49.3%', left: '51.1%' },
    label: { top: '48.0%', left: '75.2%' },
  },
  {
    id: 'visante',
    brand: 'Visante',
    catalogBrand: 'Visante',
    province: 'Khánh Hòa (Nha Trang)',
    emoji: '🌊',
    gradient: gradient('visante'),
    ingredient: 'Muối khoáng & rong biển',
    story: 'Visante tận dụng tinh chất muối khoáng & rong biển Nha Trang (Khánh Hòa) phục hồi dịu nhẹ cho làn da nhạy cảm.',
    pin: { top: '58.3%', left: '63.2%' },
    label: { top: '60.3%', left: '77.8%' },
  },
  {
    id: 'hector',
    brand: 'Hector',
    catalogBrand: 'Hector',
    province: 'Lâm Đồng',
    emoji: '🍄',
    gradient: gradient('hector'),
    ingredient: 'Đông trùng hạ thảo',
    story: 'Hector nghiên cứu và nuôi trồng đông trùng hạ thảo tại khí hậu ôn hoà Lâm Đồng, cung cấp dòng nước uống bổ dưỡng và chăm sóc sức khoẻ toàn diện.',
    pin: { top: '56.9%', left: '48.5%' },
    label: { top: '55.7%', left: '29.2%' },
  },
  {
    id: 'leplateau',
    brand: 'Le Plateau',
    catalogBrand: 'Le Plateau Coffee',
    province: 'Lâm Đồng (Cầu Đất)',
    emoji: '☕',
    gradient: gradient('leplateau'),
    ingredient: 'Cà phê đặc sản Cầu Đất',
    story: 'Le Plateau Coffee tuyển chọn từng hạt cà phê Arabica Cầu Đất & Robusta Honey chưng cất hương vị đậm đà từ vùng cao nguyên mây phủ.',
    pin: { top: '56.3%', left: '55.9%' },
    label: { top: '53.1%', left: '76.3%' },
  },
  {
    id: 'cobote',
    brand: 'Cobote',
    catalogBrand: 'Cobote',
    province: 'Bến Tre',
    emoji: '🥥',
    gradient: gradient('cobote'),
    ingredient: 'Dầu dừa hữu cơ Bến Tre',
    story: 'Cobote tận dụng vương quốc dừa Bến Tre cho dòng dầu dừa ép lạnh và sản phẩm dưỡng da, dưỡng tóc lành tính cho mẹ và bé.',
    pin: { top: '70.3%', left: '42.3%' },
    label: { top: '67.1%', left: '21.5%' },
  },
  {
    id: 'sokfram',
    brand: 'Sokfarm',
    catalogBrand: 'Sokfram',
    province: 'Trà Vinh',
    emoji: '🌴',
    gradient: gradient('sokfram'),
    ingredient: 'Mật hoa dừa hữu cơ',
    story: 'Sokfarm Trà Vinh tiên phong thu hoạch mật hoa dừa thủ công từ hoa dừa, cô đặc thành mật hoa dừa chỉ số đường huyết thấp, giàu khoáng chất.',
    pin: { top: '75.0%', left: '38.4%' },
    label: { top: '75.4%', left: '18.7%' },
  },
];

/**
 * Danh sách sản phẩm của một nhãn. API `/products?brand=` so khớp CHÍNH XÁC chuỗi `products.brand`, nên truyền tên đúng như catalog:
 * "Le Plateau" hay "Sokfarm" cho danh sách rỗng vì catalog ghi "Le Plateau Coffee" và "Sokfram".
 */
export function brandBrowseHref(catalogBrand: string): string {
  const name = catalogBrand.trim();
  return name ? `/san-pham?brand=${encodeURIComponent(name)}` : '/san-pham';
}

/** Nhãn có trên bản đồ xuất xứ (khớp theo id/slug hoặc tên catalog); nhãn chưa có ghim thì null. */
export function findBrandOrigin(brand: { slug: string; name: string }): BrandOrigin | null {
  const name = brand.name.trim().toLowerCase();
  return BRAND_ORIGINS.find((o) => o.id === brand.slug || o.catalogBrand.toLowerCase() === name || o.brand.toLowerCase() === name) ?? null;
}
