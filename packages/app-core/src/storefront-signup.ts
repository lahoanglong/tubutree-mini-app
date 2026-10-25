/** Chữ và luật dùng chung của luồng đăng ký gian hàng (Mini App và web cùng đọc, không chép riêng). */

export type StorefrontStatusCode = 'DRAFT' | 'PENDING_APPROVAL' | 'LIVE' | 'TAKEN_DOWN' | 'HIDDEN';

export const STOREFRONT_TITLE_MAX = 120;
export const STOREFRONT_NOTE_MAX = 200;

export const STOREFRONT_REVIEW_PROMISE = 'Tubu duyệt trong 1 ngày làm việc, rồi khách mới xem được gian hàng của bạn.';

export const SAMPLE_STOREFRONT_LABEL = 'Gian hàng mẫu';
export const SAMPLE_STOREFRONT_NOTE = 'Đây là gian hàng mẫu để giới thiệu cách hoạt động, không phải người bán thật.';

export const OPEN_STOREFRONT_MENU_LABEL = 'Mở gian hàng & nhận hoa hồng';
export const OPEN_STOREFRONT_MENU_HINT = 'Gian hàng riêng, chia sẻ link, nhận hoa hồng';
export const OPEN_STOREFRONT_PROMPT = 'Bạn cũng muốn có gian hàng như này?';
export const OPEN_STOREFRONT_CTA = 'Mở gian hàng';

export const SIGNUP_STEPS = [
  { key: 'conditions', label: 'Điều kiện', title: 'Điều kiện mở gian hàng' },
  { key: 'info', label: 'Thông tin', title: 'Thông tin gian hàng' },
  { key: 'products', label: 'Sản phẩm', title: 'Chọn sản phẩm' },
  { key: 'review', label: 'Gửi duyệt', title: 'Xem trước và gửi duyệt' },
] as const;
export type SignupStepKey = (typeof SIGNUP_STEPS)[number]['key'];

export const SIGNUP_COPY = {
  stepOf: (n: number, total: number) => `Bước ${n}/${total}`,
  conditionsIntro: 'Gian hàng riêng giúp bạn gom những sản phẩm mình tâm đắc vào một đường dẫn để gửi cho bạn bè.',
  conditions: [
    'Là Cộng tác viên của Tubu Tree (đăng ký miễn phí).',
    'Đồng ý điều khoản hoa hồng và thuế khi đăng ký Cộng tác viên.',
    'Có ít nhất 1 sản phẩm trong gian hàng.',
    'Gian hàng mới cần Tubu duyệt lần đầu trước khi khách xem được.',
  ],
  isCtv: 'Bạn đã là Cộng tác viên.',
  needsCtv: 'Bạn cần là Cộng tác viên trước khi mở gian hàng.',
  registerCta: 'Đăng ký làm Cộng tác viên',
  registerHint: 'Đăng ký xong, bạn quay lại đây để mở gian hàng.',
  cannotCtv: 'Tài khoản này không mở gian hàng Cộng tác viên được.',
  cannotCtvHint: 'Tài khoản đại lý và nhân viên quản lý gian hàng ở trang Đại lý hoặc Nhân viên.',
  start: 'Bắt đầu mở gian hàng',
  next: 'Tiếp tục',
  back: 'Quay lại',
  infoIntro: 'Khách thấy những thông tin này đầu tiên.',
  titleLabel: 'Tên gian hàng',
  titleRequired: 'Nhập tên gian hàng.',
  slugLabel: 'Đường dẫn gian hàng',
  slugHint: 'Đường dẫn gắn với mã giới thiệu của bạn nên không đổi được.',
  noteLabel: 'Mô tả ngắn',
  notePlaceholder: 'VD: Đồ cho bé và mẹ bầu mình đã dùng thật.',
  imagesTitle: 'Ảnh gian hàng',
  productsIntro: 'Chọn ít nhất 1 sản phẩm để khách có gì xem. Bạn thêm hoặc bớt sau cũng được.',
  templateTitle: 'Dựng nhanh theo danh mục',
  templateHint: 'Tubu tự thêm sẵn 8 sản phẩm nổi bật của danh mục bạn chọn.',
  pickTitle: 'Tự chọn sản phẩm',
  pickCta: 'Thêm sản phẩm',
  selectedTitle: (n: number) => `Đã chọn ${n} sản phẩm`,
  noProducts: 'Chưa có sản phẩm nào.',
  needProduct: 'Thêm ít nhất 1 sản phẩm để tiếp tục.',
  defaultCollection: 'Sản phẩm mình chọn',
  reviewIntro: 'Khách sẽ thấy gian hàng như thế này.',
  submit: 'Gửi duyệt',
  submitted: 'Đã gửi duyệt. Tubu sẽ thông báo khi xong.',
  openFullEditor: 'Mở trình chỉnh sửa đầy đủ',
} as const;

/** Lỗi của bước "Thông tin" (null = hợp lệ). */
export function validateStorefrontInfo(info: { title: string; headerNote: string }): string | null {
  if (!info.title.trim()) return SIGNUP_COPY.titleRequired;
  if (info.title.trim().length > STOREFRONT_TITLE_MAX) return `Tên gian hàng tối đa ${STOREFRONT_TITLE_MAX} ký tự.`;
  if (info.headerNote.length > STOREFRONT_NOTE_MAX) return `Mô tả tối đa ${STOREFRONT_NOTE_MAX} ký tự.`;
  return null;
}

export type SignupGate = 'READY' | 'NEEDS_CTV' | 'CANNOT_BE_CTV';

/** Bước "Điều kiện": đọc từ GET /affiliate/me (API đã tính sẵn quyền). */
export function signupGate(me: { isAffiliate?: boolean; canRegister?: boolean; canOpenStorefront?: boolean } | null | undefined): SignupGate {
  if (!me) return 'NEEDS_CTV';
  if (me.isAffiliate && me.canOpenStorefront !== false) return 'READY';
  if (me.canRegister !== false) return 'NEEDS_CTV';
  return 'CANNOT_BE_CTV';
}

export interface StorefrontStatusView {
  code: StorefrontStatusCode;
  label: string;
  tone: 'success' | 'warning' | 'neutral' | 'danger';
  hint: string | null;
  /** Chỉ gian hàng khách đang thấy mới có link đáng chia sẻ. */
  canShare: boolean;
}

const STATUS_VIEWS: Record<StorefrontStatusCode, Omit<StorefrontStatusView, 'code'>> = {
  DRAFT: { label: 'Bản nháp, chưa gửi duyệt', tone: 'neutral', hint: 'Gửi duyệt để khách xem được gian hàng.', canShare: false },
  PENDING_APPROVAL: {
    label: 'Chờ duyệt',
    tone: 'warning',
    hint: 'Tubu đang duyệt, thường trong 1 ngày làm việc và sẽ báo cho bạn khi xong. Bạn chia sẻ được sau khi duyệt.',
    canShare: false,
  },
  LIVE: { label: 'Đang hiển thị', tone: 'success', hint: null, canShare: true },
  TAKEN_DOWN: { label: 'Đã bị gỡ', tone: 'danger', hint: null, canShare: false },
  HIDDEN: { label: 'Đang ẩn với khách', tone: 'warning', hint: null, canShare: false },
};

/**
 * Trạng thái hiển thị cho chủ. Ưu tiên `status` do API tính; thiếu (API cũ hơn app) thì suy từ isPublished như trước, coi đã đăng là
 * đang hiển thị vì không có thông tin nào nói ngược lại.
 */
export function storefrontStatusView(sf: { status?: StorefrontStatusCode; isPublished: boolean }): StorefrontStatusView {
  const code: StorefrontStatusCode = sf.status ?? (sf.isPublished ? 'LIVE' : 'DRAFT');
  return { code, ...STATUS_VIEWS[code] };
}
