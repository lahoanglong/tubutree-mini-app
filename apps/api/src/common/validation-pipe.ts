import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from '@nestjs/common';
import { NOT_NULL_CONSTRAINT } from './decorators/optional-not-null.decorator';

/**
 * Nhãn tiếng Việt cho các trường khách/admin hay nhập; trường khác rơi về «tên-trường». Miniapp và web hiện nguyên văn
 * message[0] của lỗi 400 nên không để câu tiếng Anh của class-validator lọt ra.
 */
const FIELD_LABELS: Record<string, string> = {
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
  amount: 'Số tiền',
  code: 'Mã',
  startAt: 'Thời gian bắt đầu',
  endAt: 'Thời gian kết thúc',
  q: 'Từ khoá',
  page: 'Trang',
  limit: 'Số dòng mỗi trang',
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
