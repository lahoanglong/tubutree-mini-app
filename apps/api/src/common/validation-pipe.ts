import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';

type Translate = (field: string, englishMessage: string) => string;

const lastNumber = (msg: string) => msg.match(/-?\d+(?:\.\d+)?(?!.*\d)/)?.[0] ?? '';
const afterValues = (msg: string) => msg.split('following values:')[1]?.trim() ?? '';

/** Câu tiếng Việt cho các luật class-validator mặc định; `field` đã gồm "Mỗi phần tử của" khi luật áp từng phần tử. */
const VI: Record<string, Translate> = {
  isNotEmpty: (f) => `${f} không được để trống.`,
  arrayNotEmpty: (f) => `${f} không được để trống.`,
  isDefined: (f) => `${f} là bắt buộc.`,
  isString: (f) => `${f} phải là chuỗi ký tự.`,
  isInt: (f) => `${f} phải là số nguyên.`,
  isNumber: (f) => `${f} phải là số.`,
  isPositive: (f) => `${f} phải là số dương.`,
  isBoolean: (f) => `${f} phải là true/false.`,
  isArray: (f) => `${f} phải là danh sách.`,
  isObject: (f) => `${f} phải là object.`,
  nestedValidation: (f) => `${f} phải là object.`,
  isDateString: (f) => `${f} phải là ngày giờ hợp lệ (ISO 8601).`,
  isIso8601: (f) => `${f} phải là ngày giờ hợp lệ (ISO 8601).`,
  isUrl: (f) => `${f} phải là đường dẫn URL hợp lệ.`,
  isEmail: (f) => `${f} phải là email hợp lệ.`,
  isUuid: (f) => `${f} phải là mã UUID hợp lệ.`,
  matches: (f) => `${f} không đúng định dạng.`,
  min: (f, m) => `${f} không được nhỏ hơn ${lastNumber(m)}.`,
  max: (f, m) => `${f} không được lớn hơn ${lastNumber(m)}.`,
  minLength: (f, m) => `${f} phải có ít nhất ${lastNumber(m)} ký tự.`,
  maxLength: (f, m) => `${f} tối đa ${lastNumber(m)} ký tự.`,
  arrayMinSize: (f, m) => `${f} cần ít nhất ${lastNumber(m)} phần tử.`,
  arrayMaxSize: (f, m) => `${f} tối đa ${lastNumber(m)} phần tử.`,
  isIn: (f, m) => `${f} phải là một trong: ${afterValues(m)}.`,
  isEnum: (f, m) => `${f} phải là một trong: ${afterValues(m)}.`,
  whitelistValidation: (f) => `Trường ${f} không được gửi lên.`,
};

/** Thông báo mặc định của class-validator là tiếng Anh ("must", "should"); thông báo tự viết trong DTO giữ nguyên. */
const isEnglishDefault = (msg: string) => /\b(must|should)\b/.test(msg);

function translate(constraint: string, message: string, path: string): string {
  const rule = VI[constraint];
  if (!rule || !isEnglishDefault(message)) return message;
  const field = message.startsWith('each value in ') ? `Mỗi phần tử của ${path}` : path;
  return rule(field, message);
}

function flatten(errors: ValidationError[], parent?: string): string[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.entries(e.constraints ?? {}).map(([name, msg]) => translate(name, msg, path));
    return [...own, ...flatten(e.children ?? [], path)];
  });
}

/**
 * ValidationPipe dùng chung của API (cấu hình như trước: whitelist, chặn trường lạ, transform) với thông báo lỗi tiếng
 * Việt. Giữ dạng phản hồi mặc định của Nest ({ statusCode: 400, message: string[], error }) vì client đọc message[0].
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new BadRequestException(flatten(errors)),
  });
}
