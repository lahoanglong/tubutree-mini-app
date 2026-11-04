import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import { NOT_NULL_CONSTRAINT } from './decorators/optional-not-null.decorator';

/**
 * Nhãn tiếng Việt cho các trường khách/admin hay nhập; trường khác rơi về «tên-trường». Miniapp và web hiện nguyên văn
 * message[0] của lỗi 400 nên không để câu tiếng Anh của class-validator lọt ra.
 */
export const FIELD_LABELS: Record<string, string> = {
  rating: 'Số sao',
  comment: 'Nội dung đánh giá',
  images: 'Ảnh',
  videoUrl: 'Video',
  reason: 'Lý do',
  body: 'Nội dung',
  title: 'Tiêu đề',
  question: 'Câu hỏi',
  answer: 'Câu trả lời',
  note: 'Ghi chú',
  fullName: 'Họ tên',
  recipient: 'Người nhận',
  phone: 'Số điện thoại',
  email: 'Email',
  street: 'Địa chỉ',
  ward: 'Phường/xã',
  district: 'Quận/huyện',
  province: 'Tỉnh/thành',
  quantity: 'Số lượng',
  intervalWeeks: 'Chu kỳ giao',
  amount: 'Số tiền',
  code: 'Mã',
  startAt: 'Thời gian bắt đầu',
  endAt: 'Thời gian kết thúc',
  q: 'Từ khoá',
  page: 'Trang',
  limit: 'Số dòng mỗi trang',
  accountName: 'Tên chủ tài khoản',
  accountNumber: 'Số tài khoản',
  addonPrice: 'Giá cộng thêm',
  address: 'Địa chỉ',
  addressLine: 'Địa chỉ',
  approvedEnd: 'Giờ kết thúc được duyệt',
  approvedStart: 'Giờ bắt đầu được duyệt',
  audience: 'Đối tượng',
  avatarUrl: 'Ảnh đại diện',
  bankAccountName: 'Tên chủ tài khoản',
  bankAccountNo: 'Số tài khoản',
  bankBin: 'Ngân hàng',
  bankInfo: 'Thông tin ngân hàng',
  bankName: 'Tên ngân hàng',
  bankRef: 'Mã giao dịch ngân hàng',
  basePrice: 'Giá gốc',
  benefit: 'Công dụng',
  bodyTemplate: 'Nội dung mẫu',
  businessName: 'Tên doanh nghiệp',
  cancelReasonCode: 'Lý do huỷ',
  cancelReasonText: 'Lý do huỷ',
  captions: 'Chú thích',
  carrier: 'Đơn vị vận chuyển',
  carrierCostVnd: 'Phí vận chuyển',
  category: 'Danh mục',
  cccdBackUrl: 'Ảnh CCCD mặt sau',
  cccdFrontUrl: 'Ảnh CCCD mặt trước',
  certifications: 'Chứng nhận',
  channel: 'Kênh',
  checkinAt: 'Giờ vào ca',
  checkoutAt: 'Giờ ra ca',
  choice: 'Lựa chọn',
  claimInstructions: 'Hướng dẫn nhận quà',
  codes: 'Danh sách mã',
  comboDiscountPct: 'Giảm giá combo (%)',
  commissionPct: 'Hoa hồng (%)',
  communeName: 'Phường/xã',
  companyName: 'Tên công ty',
  consignmentFeeFixed: 'Phí ký gửi cố định',
  consignmentFeePct: 'Phí ký gửi (%)',
  content: 'Nội dung',
  correct: 'Đáp án đúng',
  count: 'Số lượng',
  couponCode: 'Mã giảm giá',
  coverUrl: 'Ảnh bìa',
  creditLimit: 'Hạn mức công nợ',
  csv: 'Dữ liệu CSV',
  currency: 'Loại tiền',
  customDomain: 'Tên miền riêng',
  customer: 'Thông tin khách hàng',
  dailyCapQty: 'Giới hạn số lượng mỗi ngày',
  day: 'Ngày',
  days: 'Số ngày',
  declaredQty: 'Số lượng khai báo',
  description: 'Mô tả',
  difficulty: 'Độ khó',
  discountPct: 'Mức giảm (%)',
  dob: 'Ngày sinh',
  drops: 'Số giọt nước',
  dropsPerUnit: 'Số giọt mỗi đơn vị',
  endMin: 'Giờ kết thúc',
  evidenceUrl: 'Ảnh minh chứng',
  explanation: 'Giải thích',
  faqs: 'Câu hỏi thường gặp',
  flashPrice: 'Giá giờ vàng',
  freeShipFrom: 'Miễn phí vận chuyển từ',
  from: 'Từ ngày',
  goal: 'Mục tiêu',
  gramsPerUnit: 'Số gram mỗi đơn vị',
  headerNote: 'Ghi chú đầu trang',
  hourlyRate: 'Lương theo giờ',
  image: 'Ảnh',
  imageUrl: 'Ảnh',
  ingredients: 'Thành phần',
  invoiceRequest: 'Yêu cầu hoá đơn',
  invoiceUrl: 'Đường dẫn hoá đơn',
  items: 'Danh sách mục',
  keywords: 'Từ khoá',
  label: 'Nhãn',
  lat: 'Vĩ độ',
  layout: 'Bố cục',
  lines: 'Các dòng',
  linkType: 'Loại liên kết',
  linkValue: 'Giá trị liên kết',
  lng: 'Kinh độ',
  logoUrl: 'Ảnh logo',
  maxDiscount: 'Giảm tối đa',
  maxPrice: 'Giá cao nhất',
  maxQty: 'Số lượng tối đa',
  memberCode: 'Mã thành viên',
  message: 'Tin nhắn',
  method: 'Phương thức',
  minOrder: 'Đơn tối thiểu',
  minOrderVolume: 'Sản lượng đơn tối thiểu',
  minPrice: 'Giá thấp nhất',
  minRating: 'Số sao tối thiểu',
  month: 'Tháng',
  monthlyCapQty: 'Giới hạn số lượng mỗi tháng',
  monthlyQuotaPoints: 'Hạn mức điểm mỗi tháng',
  monthlyVolumeEstimate: 'Sản lượng ước tính mỗi tháng',
  name: 'Tên',
  notes: 'Ghi chú',
  openingHours: 'Giờ mở cửa',
  options: 'Các lựa chọn',
  orderCode: 'Mã đơn hàng',
  orderTotal: 'Tổng giá trị đơn',
  origin: 'Xuất xứ',
  ownerName: 'Tên chủ sở hữu',
  pancakeCode: 'Mã Pancake',
  parcelCode: 'Mã kiện hàng',
  parcelTracking: 'Mã vận đơn của kiện',
  paymentMethod: 'Phương thức thanh toán',
  paymentTerms: 'Điều khoản thanh toán',
  pct: 'Phần trăm giảm',
  perUserLimit: 'Giới hạn mỗi người',
  percentage: 'Tỷ lệ (%)',
  period: 'Kỳ',
  perkText: 'Nội dung ưu đãi',
  permissions: 'Quyền',
  placement: 'Vị trí hiển thị',
  pointsCost: 'Số điểm đổi',
  pointsPerGroup: 'Số điểm mỗi nhóm',
  pointsToUse: 'Số điểm dùng',
  prefix: 'Tiền tố mã',
  prepInstructions: 'Hướng dẫn chuẩn bị',
  price: 'Giá',
  proofImageUrl: 'Ảnh chứng từ',
  provinceName: 'Tỉnh/thành',
  qrImageUrl: 'Ảnh mã QR',
  quota: 'Số lượng giới hạn',
  rate: 'Tỷ lệ hoa hồng',
  reasonCode: 'Lý do',
  receivedQty: 'Số lượng đã nhận',
  receivedWeightGrams: 'Khối lượng đã nhận (gram)',
  referralCode: 'Mã giới thiệu',
  refundMethod: 'Hình thức hoàn tiền',
  refundPoints: 'Số điểm hoàn lại',
  region: 'Vùng',
  rejectReason: 'Lý do từ chối',
  rejectionNote: 'Ghi chú từ chối',
  rejectionReason: 'Lý do từ chối',
  rewardPoints: 'Điểm thưởng',
  role: 'Vai trò',
  rows: 'Các dòng dữ liệu',
  salePrice: 'Giá bán',
  scope: 'Phạm vi',
  search: 'Từ khoá tìm kiếm',
  seeds: 'Số hạt giống',
  shippingFee: 'Phí vận chuyển',
  shortCode: 'Mã rút gọn',
  shortDesc: 'Mô tả ngắn',
  shortfallReason: 'Lý do thiếu hàng',
  sku: 'Mã SKU',
  slug: 'Đường dẫn',
  sortOrder: 'Thứ tự',
  startDate: 'Ngày bắt đầu',
  startMin: 'Giờ bắt đầu',
  status: 'Trạng thái',
  stock: 'Tồn kho',
  storeFrontUrl: 'Đường dẫn gian hàng',
  story: 'Câu chuyện',
  subdomain: 'Tên miền phụ',
  subtitle: 'Phụ đề',
  tagline: 'Khẩu hiệu',
  tags: 'Thẻ',
  take: 'Số dòng mỗi trang',
  takeOverReason: 'Lý do tiếp nhận',
  taxCode: 'Mã số thuế',
  taxId: 'Mã số thuế',
  theme: 'Chủ đề',
  themeColor: 'Màu chủ đạo',
  threshold: 'Ngưỡng',
  thumbnail: 'Ảnh đại diện sản phẩm',
  to: 'Đến ngày',
  trackingCode: 'Mã vận đơn',
  trackingUrl: 'Đường dẫn theo dõi vận đơn',
  type: 'Loại',
  unitLabel: 'Đơn vị tính',
  unitsPerPoint: 'Số đơn vị mỗi điểm',
  usageLimit: 'Số lượt dùng tối đa',
  usps: 'Điểm nổi bật',
  validDays: 'Số ngày hiệu lực',
  value: 'Giá trị',
  videoUrls: 'Video',
  voucher: 'Phiếu quà tặng',
  warehouseAddress: 'Địa chỉ kho',
  warehouseCity: 'Tỉnh/thành của kho',
  warehouseDistrict: 'Quận/huyện của kho',
  warehousePhone: 'Số điện thoại kho',
  warehouseWard: 'Phường/xã của kho',
  workDate: 'Ngày làm việc',
  year: 'Năm',
  zaloTemplateId: 'Mã mẫu ZNS',
};

const trailingNumber = (original: string): string => original.match(/(-?\d+(?:\.\d+)?)(?: characters| elements)?$/)?.[1] ?? '';
const allowedValues = (original: string): string => {
  const list = original.split(':').slice(1).join(':').trim();
  return list && list.length <= 120 ? list : '';
};

/** Câu tiếng Việt cho các luật class-validator mặc định (khoá = tên constraint của class-validator). */
const TEMPLATES: Record<string, (subject: string, original: string) => string> = {
  isString: (s) => `${s} phải là chuỗi ký tự.`,
  isNotEmpty: (s) => `${s} không được để trống.`,
  isNotEmptyObject: (s) => `${s} không được để trống.`,
  arrayNotEmpty: (s) => `${s} không được để trống.`,
  isDefined: (s) => `${s} là bắt buộc.`,
  [NOT_NULL_CONSTRAINT]: (s) => `${s} không được để null; bỏ trường này nếu không muốn đổi.`,
  isInt: (s) => `${s} phải là số nguyên.`,
  isNumber: (s) => `${s} phải là số.`,
  isPositive: (s) => `${s} phải lớn hơn 0.`,
  isBoolean: (s) => `${s} chỉ nhận đúng hoặc sai.`,
  isArray: (s) => `${s} phải là một danh sách.`,
  isObject: (s) => `${s} phải là một đối tượng.`,
  nestedValidation: (s) => `${s} phải là một đối tượng.`,
  isEmail: (s) => `${s} không hợp lệ.`,
  isUrl: (s) => `${s} phải là đường dẫn (URL) hợp lệ.`,
  isDateString: (s) => `${s} phải là ngày giờ hợp lệ (ISO 8601).`,
  isIso8601: (s) => `${s} phải là ngày giờ hợp lệ (ISO 8601).`,
  isUuid: (s) => `${s} không đúng định dạng.`,
  matches: (s) => `${s} không đúng định dạng.`,
  isIn: (s, o) => `${s} chỉ nhận một trong: ${allowedValues(o) || 'các giá trị được phép'}.`,
  isEnum: (s, o) => `${s} chỉ nhận một trong: ${allowedValues(o) || 'các giá trị được phép'}.`,
  minLength: (s, o) => `${s} phải có ít nhất ${trailingNumber(o)} ký tự.`,
  isLength: (s, o) => {
    const range = o.match(/equal to (\d+) and shorter than or equal to (\d+)/);
    if (range) return `${s} phải dài từ ${range[1]} đến ${range[2]} ký tự.`;
    const max = o.match(/shorter than or equal to (\d+)/)?.[1];
    if (max) return `${s} không được dài quá ${max} ký tự.`;
    const min = o.match(/longer than or equal to (\d+)/)?.[1];
    return min ? `${s} phải có ít nhất ${min} ký tự.` : `${s} không hợp lệ.`;
  },
  maxLength: (s, o) => `${s} không được dài quá ${trailingNumber(o)} ký tự.`,
  min: (s, o) => `${s} không được nhỏ hơn ${trailingNumber(o)}.`,
  max: (s, o) => `${s} không được lớn hơn ${trailingNumber(o)}.`,
  arrayMinSize: (s, o) => `${s} phải có ít nhất ${trailingNumber(o)} mục.`,
  arrayMaxSize: (s, o) => `${s} chỉ được có tối đa ${trailingNumber(o)} mục.`,
};

/** Có chữ có dấu tiếng Việt → thông điệp do dev tự viết trong DTO, giữ nguyên văn (cụ thể hơn câu chung). */
const HAS_VIETNAMESE = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;

function translate(constraint: string, original: string, path: string[]): string {
  const property = path[path.length - 1]!;
  if (constraint === 'whitelistValidation') return `Không nhận trường «${property}».`;
  if (HAS_VIETNAMESE.test(original)) return original;

  const named = [...path].reverse().find((seg) => !/^\d+$/.test(seg)) ?? property;
  const index = path.find((seg) => /^\d+$/.test(seg));
  const label = FIELD_LABELS[named] ?? `Trường «${named}»`;
  const base = /^each value in /.test(original) ? `Mỗi mục của ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
  const subject = index === undefined ? base : `${base} (mục ${Number(index) + 1})`;

  const template = TEMPLATES[constraint];
  return template ? template(subject, original) : `${subject} không hợp lệ.`;
}

export function translateValidationErrors(errors: ValidationError[], parent: string[] = []): string[] {
  const out: string[] = [];
  for (const e of errors) {
    const path = [...parent, e.property];
    const constraints = e.constraints ?? {};
    // null cũng trượt @IsString/@IsInt…: chỉ nói câu "không được để null", không kèm câu về kiểu dữ liệu.
    const entries = NOT_NULL_CONSTRAINT in constraints ? [[NOT_NULL_CONSTRAINT, constraints[NOT_NULL_CONSTRAINT]!] as const] : Object.entries(constraints);
    for (const [constraint, original] of entries) {
      out.push(translate(constraint, original, path));
    }
    if (e.children?.length) out.push(...translateValidationErrors(e.children, path));
  }
  return out;
}

/**
 * ValidationPipe toàn cục của API (whitelist, chặn trường lạ, transform) với lỗi 400 bằng tiếng Việt. Giữ dạng phản hồi
 * mặc định của Nest ({ statusCode: 400, message: string[], error }) vì client đọc message[0].
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new BadRequestException(translateValidationErrors(errors)),
  });
}
