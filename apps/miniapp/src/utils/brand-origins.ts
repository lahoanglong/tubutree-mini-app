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
  /** Vị trí pin trên bản đồ (% so với khung bản đồ). */
  pin: { top: string; left: string };
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
    pin: { top: '30%', left: '44%' },
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
    pin: { top: '48%', left: '62%' },
  },
  {
    id: 'polang',
    brand: 'Pơ Lang',
    catalogBrand: 'Pơ Lang',
    province: 'Đắc Lắk',
    emoji: '🥑',
    gradient: gradient('polang'),
    ingredient: 'Bơ ca cao & dầu gừng bazan',
    story: 'Pơ Lang khai thác nông sản bazan Đắk Lắk — bơ ca cao ép lạnh, dầu gừng, bồ kết — làm nên sản phẩm chăm sóc da và tóc thuần thực vật.',
    pin: { top: '61%', left: '55%' },
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
    pin: { top: '67%', left: '68%' },
  },
  {
    id: 'hector',
    brand: 'Hector',
    catalogBrand: 'Hector',
    province: 'Lâm Đồng',
    emoji: '🍄',
    gradient: gradient('hector'),
    ingredient: 'Đông trùng hạ thảo',
    story: 'Hector nghiên cứu và nuôi trồng đông trùng hạ thảo tại khí hậu ôn hòa Lâm Đồng, cung cấp dòng nước uống bổ dưỡng và chăm sóc sức khỏe toàn diện.',
    pin: { top: '73%', left: '58%' },
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
    pin: { top: '77%', left: '51%' },
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
    pin: { top: '83%', left: '46%' },
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
    pin: { top: '86%', left: '40%' },
  },
];
