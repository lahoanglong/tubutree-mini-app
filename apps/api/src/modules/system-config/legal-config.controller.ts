import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { SystemConfigService } from './system-config.service';

/**
 * Nội dung điều khoản/chính sách hiển thị ở web (/chinh-sach/:loai). Admin nhập ở tab Cấu hình dưới dạng markdown hoặc chữ
 * thường; chưa nhập thì web dùng bản nháp mặc định của nó. WHITELIST rõ ràng: đường dẫn không được biến thành cách đọc
 * khoá cấu hình tuỳ ý.
 */
export const LEGAL_CONFIG_KEYS: Readonly<Record<string, string>> = {
  'dieu-khoan': 'legal.dieu-khoan',
  'bao-mat': 'legal.bao-mat',
  'doi-tra': 'legal.doi-tra',
  'van-chuyen': 'legal.van-chuyen',
};

const DEFAULT_RETURN_WINDOW_DAYS = 7;
const DEFAULT_FREESHIP_THRESHOLD = 200000;

/** Số dương hợp lệ, không thì mặc định: giá trị hỏng trong DB không được hiện thành "NaN ngày" trên trang chính sách. */
function positiveOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

@Public()
@Controller('config')
export class LegalConfigController {
  constructor(private readonly config: SystemConfigService) {}

  @Get('legal/:loai')
  @PublicCache('STATIC')
  async get(@Param('loai') loai: string) {
    const key = Object.prototype.hasOwnProperty.call(LEGAL_CONFIG_KEYS, loai) ? LEGAL_CONFIG_KEYS[loai] : undefined;
    if (!key) throw new NotFoundException('Không có trang chính sách này.');
    const [raw, returnWindowDays, freeshipThreshold] = await Promise.all([
      this.config.get<unknown>(key, ''),
      this.config.get<unknown>('returns.window_days', DEFAULT_RETURN_WINDOW_DAYS),
      this.config.get<unknown>('shipping.free_threshold', DEFAULT_FREESHIP_THRESHOLD),
    ]);
    return {
      loai,
      content: typeof raw === 'string' && raw.trim() !== '' ? raw : null,
      // Bản nháp có chỗ nhắc tới các số này: lấy từ đúng khoá hệ thống đang chạy để không lệch với giỏ/đổi trả thật.
      vars: {
        returnWindowDays: positiveOr(returnWindowDays, DEFAULT_RETURN_WINDOW_DAYS),
        freeshipThreshold: positiveOr(freeshipThreshold, DEFAULT_FREESHIP_THRESHOLD),
      },
    };
  }
}
