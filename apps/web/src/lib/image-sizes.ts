/**
 * Giá trị `sizes` của ảnh: bề rộng hiển thị thật theo khung nhìn để trình duyệt chọn bản srcset đúng. Chuỗi dựng từ số (không viết tay "<n>px")
 * vì đây là số mô tả bố cục của các khuôn trang (lề, khe, bề rộng cột), không phải số đo kiểu dáng mới.
 */
const px = (n: number) => `${n}px`;
const upTo = (n: number) => `(max-width: ${px(n)})`;
const vwSub = (n: number) => `100vw - ${px(n)}`;
const vwMinus = (n: number) => `calc(${vwSub(n)})`;

/** Điểm gãy của web: điện thoại dưới md (768), md dưới lg (1024), lg dưới xl (1280). */
const PHONE = 767;
const MD = 1023;
const LG = 1279;
const FRAME = 1200;

/** Ô lưới 2 cột ở điện thoại (lề 16 hai bên + khe 12), 3 cột ở md (lề 24 + 2 khe 16). */
const GRID_PHONE = `${upTo(PHONE)} calc((${vwSub(44)}) / 2)`;
const GRID_MD = `${upTo(MD)} calc((${vwSub(80)}) / 3)`;
const frameMinus = (n: number) => `(min(100vw, ${px(FRAME)}) - ${px(n)})`;

/** Lưới sản phẩm mặc định: lg 5 cột, xl ô cố định. */
export const GRID_IMAGE_SIZES = `${GRID_PHONE}, ${GRID_MD}, ${upTo(LG)} calc(${frameMinus(112)} / 5), ${px(179)}`;
/** Có cột lọc bên trái (200 + khe 24, listing-layout): lg 4 cột, xl ô cố định. */
export const GRID_IMAGE_SIZES_WITH_FILTER = `${GRID_PHONE}, ${GRID_MD}, ${upTo(LG)} calc(${frameMinus(332)} / 4), ${px(170)}`;
export const GRID_RANK_IMAGE_SIZES = `${GRID_PHONE}, ${GRID_MD}, calc(${frameMinus(112)} / 5)`;

/** Kệ ngang và thẻ dòng: ô cố định. */
export const TILE_IMAGE_SIZES = { rail: px(148), flash: px(128), line: px(64) } as const;

/** Banner Trang chủ: điện thoại tràn khung trừ lề 16; md lề 24; lg 8/12 cột của khung 1200 (~728). */
export const BANNER_SLIDE_SIZES = `${upTo(PHONE)} ${vwMinus(32)}, ${upTo(MD)} ${vwMinus(48)}, ${px(728)}`;
/** Banner Ưu đãi từ lg tràn cả khung nội dung (~1152). */
export const BANNER_WIDE_SLIDE_SIZES = `${upTo(PHONE)} ${vwMinus(32)}, ${upTo(MD)} ${vwMinus(48)}, min(${vwSub(48)}, ${px(1152)})`;
/** Ảnh đầu trang chiến dịch: tràn khung trừ lề 16 ở điện thoại, từ md tối đa 768. */
export const CAMPAIGN_HERO_SIZES = `${upTo(PHONE)} ${vwMinus(32)}, ${px(768)}`;
/** Bìa gian hàng: tràn 100vw đến lg, từ lg ô trái 5/12 khung 1200 (~500). */
export const SHOP_COVER_SIZES = `${upTo(MD)} 100vw, ${px(500)}`;
/** Avatar gian hàng: 56, từ lg 72. */
export const SHOP_AVATAR_SIZES = `(min-width: ${px(MD + 1)}) ${px(72)}, ${px(56)}`;
/** Ảnh chính trang sản phẩm: tràn mép ở điện thoại, md nửa khung (lề 24, khe 32), lg cột trái 440. */
export const PDP_MAIN_IMAGE_SIZES = `${upTo(PHONE)} 100vw, ${upTo(MD)} calc((${vwSub(80)}) / 2), ${px(440)}`;
