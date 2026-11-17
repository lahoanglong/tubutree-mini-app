/**
 * Bản đồ minh hoạ của Đoán Xuất Xứ (chỉ web từ 1024px, chunk lười): tên vùng của lựa chọn → vùng sơ đồ (`MAP_REGIONS` của `brand-map-data`) hoặc
 * đảo (`MAP_ISLANDS`). Bản đồ chỉ tô vùng khách đang chọn, không phải cách trả lời: lựa chọn chưa có trong bảng (tên mới, hay lựa chọn là năm)
 * thì bản đồ không tô gì, nút vẫn dùng bình thường. Vùng là vùng sơ đồ gần nhất theo tỉnh, không theo tỉ lệ.
 */
export type OriginMapSpot = { kind: 'region'; id: string } | { kind: 'island'; id: 'hoang-sa' | 'truong-sa' | 'phu-quoc' };

const REGION_OF: Record<string, string> = {
  'hạ long': 'dong-bac',
  'quảng ninh': 'dong-bac',
  'yên tử': 'dong-bac',
  'trùng khánh': 'dong-bac',
  'cao bằng': 'dong-bac',
  'mèo vạc': 'dong-bac',
  'hà giang': 'dong-bac',
  'lạng sơn': 'dong-bac',
  'bắc kạn': 'dong-bac',
  'tân cương': 'dong-bac',
  'thái nguyên': 'dong-bac',
  'lục ngạn': 'dong-bac',
  'bắc giang': 'dong-bac',
  'đoan hùng': 'dong-bac',
  'phú thọ': 'dong-bac',
  'văn yên': 'tay-bac',
  'yên bái': 'tay-bac',
  'lào cai': 'tay-bac',
  'sa pa': 'tay-bac',
  'điện biên': 'tay-bac',
  'mộc châu': 'son-la',
  'sơn la': 'son-la',
  'cao phong': 'son-la',
  'hòa bình': 'son-la',
  'hà nội': 'ha-noi',
  'thanh hà': 'ha-noi',
  'hải dương': 'ha-noi',
  'hưng yên': 'ha-noi',
  'đại hoàng': 'ha-noi',
  'hà nam': 'ha-noi',
  'nam định': 'ha-noi',
  'thái bình': 'ha-noi',
  'thanh hóa': 'thanh-hoa',
  'hậu lộc': 'thanh-hoa',
  'nga sơn': 'thanh-hoa',
  'nghệ an': 'nghe-an',
  vinh: 'nghe-an',
  'hà tĩnh': 'nghe-an',
  'phúc trạch': 'nghe-an',
  huế: 'hue',
  'quảng trị': 'hue',
  'quảng bình': 'hue',
  'quảng nam': 'quang-nam',
  'trà my': 'quang-nam',
  'đà nẵng': 'quang-nam',
  'quảng ngãi': 'quang-nam',
  'gia lai': 'gia-lai',
  'kon tum': 'gia-lai',
  'đắk lắk': 'dak-lak',
  'buôn ma thuột': 'dak-lak',
  'khánh hòa': 'khanh-hoa',
  'nha trang': 'khanh-hoa',
  'ninh thuận': 'khanh-hoa',
  'phan rang': 'khanh-hoa',
  'bình thuận': 'khanh-hoa',
  'phan thiết': 'khanh-hoa',
  'lâm đồng': 'lam-dong',
  'đà lạt': 'lam-dong',
  'cầu đất': 'lam-dong',
  'bà đen': 'dong-nam-bo',
  'tây ninh': 'dong-nam-bo',
  'đồng nai': 'dong-nam-bo',
  'bình phước': 'dong-nam-bo',
  'bà rịa': 'dong-nam-bo',
  'bạc liêu': 'dbscl',
  'bến tre': 'dbscl',
  'trà vinh': 'dbscl',
  'vĩnh kim': 'dbscl',
  'tiền giang': 'dbscl',
  'hòa lộc': 'dbscl',
  'cà mau': 'dbscl',
  'sóc trăng': 'dbscl',
  'cần thơ': 'dbscl',
  'đồng tháp': 'dbscl',
};

const ISLAND_OF: Record<string, 'hoang-sa' | 'truong-sa' | 'phu-quoc'> = {
  'phú quốc': 'phu-quoc',
  'hoàng sa': 'hoang-sa',
  'trường sa': 'truong-sa',
};

/** Dấu đặt kiểu cũ ở vần mở cuối tiếng ("hoà", "thuý") về kiểu của bảng trên ("hòa", "thúy"); vần có phụ âm cuối ("hoàng") không đổi. */
const OLD_TONE: ReadonlyArray<[RegExp, string]> = [
  [/oà(?=\s|$)/g, 'òa'],
  [/oá(?=\s|$)/g, 'óa'],
  [/oả(?=\s|$)/g, 'ỏa'],
  [/oã(?=\s|$)/g, 'õa'],
  [/oạ(?=\s|$)/g, 'ọa'],
  [/uý(?=\s|$)/g, 'úy'],
  [/uỳ(?=\s|$)/g, 'ùy'],
];

function norm(place: string): string {
  const base = place.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  return OLD_TONE.reduce((s, [re, to]) => s.replace(re, to), base);
}

export function originMapSpot(place: string | null | undefined): OriginMapSpot | null {
  if (!place) return null;
  const key = norm(place);
  const island = ISLAND_OF[key];
  if (island) return { kind: 'island', id: island };
  const region = REGION_OF[key];
  return region ? { kind: 'region', id: region } : null;
}
