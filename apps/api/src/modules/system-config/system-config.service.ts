import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Đọc/ghi tham số nghiệp vụ từ bảng SystemConfig (Build Spec Section 15).
 * QUY TẮC: mọi rate/ngưỡng/hold-time PHẢI lấy qua service này, KHÔNG hard-code.
 * Cache in-memory ngắn để tránh query lặp; invalidates khi set().
 */
@Injectable()
export class SystemConfigService {
  private cache = new Map<string, { value: unknown; at: number }>();
  private readonly ttlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback?: T): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) {
      return cached.value as T;
    }
    const row = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!row) {
      if (fallback !== undefined) {
        // Cache fallback value too — nếu không, key chưa tồn tại (DB mới/seed chưa chạy) khiến
        // MỌI lần get() (kể cả từ route @Public như /config/public) đều bỏ qua cache, query
        // thẳng DB. set() vẫn xoá đúng entry này khi config được tạo thật.
        this.cache.set(key, { value: fallback, at: Date.now() });
        return fallback;
      }
      throw new NotFoundException(`SystemConfig "${key}" chưa được cấu hình.`);
    }
    this.cache.set(key, { value: row.value, at: Date.now() });
    return row.value as T;
  }

  async getByCategory(category: string): Promise<Record<string, unknown>> {
    const rows = await this.prisma.systemConfig.findMany({ where: { category } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /**
   * Ghi 1 config. Nhiều module dùng `get<T>(key, fallback)` và TIN TƯỞNG runtime type khớp T mà
   * KHÔNG validate lại (xem vd. wallet.service.ts, cashback.service.ts, vouchers.service.ts —
   * dùng thẳng trong phép toán số học, không guard). Nếu set() cho phép ghi null/kiểu khác với
   * giá trị hiện tại, lần đọc tiếp theo ở module khác có thể NaN/throw giữa business logic tài
   * chính (ví dụ ví, cashback, voucher). Chặn ngay tại đây — điểm ghi DUY NHẤT — rẻ hơn nhiều so
   * với việc bắt từng call site tự guard.
   */
  /**
   * Biên hợp lệ cho những khoá mà ĐƠN VỊ dễ gõ nhầm. Kiểm tra kiểu (số vẫn là số) không cứu
   * được trường hợp gõ "80" cho một khoá lưu PHÂN SỐ: mô tả trong seed ghi "User nhận 70%"
   * nhưng giá trị thật là 0.7, nên nâng lên 80% rất dễ thành 80 — hoa hồng 50.000đ biến thành
   * 4.000.000đ cộng thẳng vào ví rút được, và sau khi đã trả thì không đòi lại được.
   *
   * Cố ý liệt kê TỪNG KHOÁ chứ không suy theo hậu tố: `subscribe.discount_pct` là phân số
   * (0.12) còn `groupbuy.discount_pct` là phần trăm nguyên (15) — cùng hậu tố, khác đơn vị.
   */
  private static readonly RANGES: Record<string, { min: number; max: number; note: string }> = {
    'loyalty.max_redeem_pct': { min: 0, max: 1, note: 'phân số (0.2 = 20%)' },
    'subscribe.discount_pct': { min: 0, max: 1, note: 'phân số (0.12 = 12%)' },
    'flashsale.min_discount_pct': { min: 0, max: 1, note: 'phân số (0.1 = 10%)' },
    'dealer.max_discount_pct': { min: 0, max: 1, note: 'phân số (0.45 = 45%)' },
    'cashback.merchant_user_share': { min: 0, max: 1, note: 'phân số (0.7 = 70%)' },
    'cashback.merchant_tubu_share': { min: 0, max: 1, note: 'phân số (0.3 = 30%)' },
    'groupbuy.discount_pct': { min: 0, max: 100, note: 'phần trăm nguyên (15 = 15%)' },
    'affiliate.tubu_wallet_multiplier': { min: 1, max: 10, note: 'hệ số nhân (1.5 = ×1,5)' },
    'cashback.tubu_wallet_multiplier': { min: 1, max: 10, note: 'hệ số nhân (1.5 = ×1,5)' },
    'wallet.xu_convert_multiplier': { min: 0.1, max: 10, note: 'hệ số nhân (1.2 = ×1,2)' },
    'cashback.hold_days': { min: 0, max: 365, note: 'số ngày' },
    'affiliate.hold_days': { min: 0, max: 365, note: 'số ngày' },
    'return.window_days': { min: 0, max: 365, note: 'số ngày' },
  };

  private assertInRange(key: string, value: unknown): void {
    const rule = SystemConfigService.RANGES[key];
    if (!rule) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`"${key}" phải là số — ${rule.note}.`);
    }
    if (value < rule.min || value > rule.max) {
      throw new BadRequestException(
        `"${key}" phải nằm trong khoảng ${rule.min}–${rule.max} — ${rule.note}. Giá trị vừa nhập: ${value}.`,
      );
    }
  }

  async set(key: string, value: object | string | number | boolean, changedBy: string): Promise<void> {
    if (value === null || value === undefined) {
      throw new BadRequestException(`Giá trị cho SystemConfig "${key}" không được null/undefined.`);
    }
    this.assertInRange(key, value);
    const dotIndex = key.indexOf('.');
    const category = dotIndex > 0 ? key.slice(0, dotIndex) : 'misc';
    await this.prisma.$transaction(async (tx) => {
      // Đọc `existing` TRONG transaction (thay vì trước đó) để thu hẹp cửa sổ race: 2 admin sửa
      // cùng key gần như đồng thời trước đây có thể tạo 2 dòng history cùng oldValue (v1→v2 và
      // v1→v3), làm mất bản ghi v1→v2 thật sự đã xảy ra trong audit trail.
      const existing = await tx.systemConfig.findUnique({ where: { key } });
      if (existing) {
        const oldType = Array.isArray(existing.value) ? 'array' : typeof existing.value;
        const newType = Array.isArray(value) ? 'array' : typeof value;
        if (oldType !== newType) {
          throw new BadRequestException(
            `Kiểu dữ liệu mới ("${newType}") khác kiểu hiện tại ("${oldType}") của "${key}". ` +
              'Đổi kiểu có thể làm crash nơi khác đang dùng get<T>() với kiểu cũ. Nếu chắc chắn muốn đổi, xoá config này trước rồi tạo lại.',
          );
        }
        await tx.systemConfigHistory.create({
          data: {
            key,
            oldValue: existing.value as object,
            newValue: value as object,
            changedBy,
          },
        });
      }
      await tx.systemConfig.upsert({
        where: { key },
        update: { value: value as object, updatedBy: changedBy },
        create: { key, value: value as object, category, updatedBy: changedBy },
      });
    });
    this.cache.delete(key);
  }
}
