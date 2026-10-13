import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { spinPrizeProblem } from './spin-prizes';

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
  private static readonly RANGES: Record<string, { min: number; max: number; note: string; integer?: true }> = {
    'loyalty.max_redeem_pct': { min: 0, max: 1, note: 'phân số (0.2 = 20%)' },
    // Hạn của mọi điểm thưởng mới (điểm đơn, điểm danh, đánh giá, vòng quay, giới thiệu…). 0 hay số âm làm điểm hết hạn
    // ngay lúc cộng, số quá lớn làm điểm không bao giờ hết hạn; số lẻ bị các nguồn cộng điểm cắt bỏ phần thập phân.
    'loyalty.point_expire_months': { min: 1, max: 120, note: 'số tháng nguyên (12 = điểm hết hạn sau 12 tháng)', integer: true },
    'subscribe.discount_pct': { min: 0, max: 1, note: 'phân số (0.12 = 12%)' },
    'wishlist.price_drop_min_pct': { min: 0, max: 1, note: 'phân số (0.05 = 5%)' },
    'wishlist.price_drop_cooldown_days': { min: 0, max: 90, note: 'số ngày (0 = tắt cooldown)', integer: true },
    'subscribe.stock_retry_days': { min: 0, max: 7, note: 'số đêm thử lại kỳ định kỳ khi hết hàng (0 = không thử lại)', integer: true },
    'flashsale.min_discount_pct': { min: 0, max: 1, note: 'phân số (0.1 = 10%)' },
    'dealer.max_discount_pct': { min: 0, max: 1, note: 'phân số (0.45 = 45%)' },
    'cashback.merchant_user_share': { min: 0, max: 1, note: 'phân số (0.7 = 70%)' },
    'groupbuy.discount_pct': { min: 0, max: 100, note: 'phần trăm nguyên (15 = 15%)' },
    'cashback.hold_days': { min: 0, max: 365, note: 'số ngày' },
    'affiliate.hold_days': { min: 0, max: 365, note: 'số ngày' },
    // Khoá code THẬT SỰ đọc (orders.service requestReturn, affiliate.service hold) — trước đây RANGES/seed
    // ghi 'return.window_days' (không ai đọc) nên giới hạn này chưa bao giờ áp vào khoá thật.
    'returns.window_days': { min: 0, max: 365, note: 'số ngày' },
    'dealer.reward_claim_grace_days': { min: 0, max: 366, note: 'số ngày' },
    // ETA giao hàng trên trang đặt hàng thành công (buy-flow 4a): số nguyên ngày, gõ nhầm (vd 300) sẽ
    // bị từ chối lúc ghi thay vì âm thầm ẩn dòng ETA (toShippingEta bỏ giá trị ngoài 0–60).
    'shipping.eta_min_days': { min: 0, max: 60, note: 'số ngày' },
    'shipping.eta_max_days': { min: 0, max: 60, note: 'số ngày' },
    // Cron VouchersService cấp mã hàng loạt theo các khoá này: gõ nhầm đơn vị (30000 → 3000000) hay số âm sẽ cấp mã
    // sai giá trị cho cả tệp khách. Mức 0đ bị loại vì grant() vẫn tạo mã 0đ và gửi thông báo.
    'voucher.welcome_amount': { min: 1000, max: 1_000_000, note: 'đồng' },
    'voucher.birthday_amount': { min: 1000, max: 1_000_000, note: 'đồng' },
    'voucher.winback_amount': { min: 1000, max: 1_000_000, note: 'đồng' },
    'voucher.welcome_min_order': { min: 0, max: 50_000_000, note: 'đồng (0 = không yêu cầu đơn tối thiểu)' },
    // 0 ngày = coi mọi khách từng mua là "đã bỏ đi" và cấp mã cho tất cả.
    'voucher.winback_days': { min: 1, max: 365, note: 'số ngày' },
    // PD-3: khoá tính bằng Điểm Xanh (1 điểm = 1.000đ). Khoá xu cũ cùng nghĩa có giá trị 200–100.000; gõ/chép
    // nhầm giá trị xu vào đây là thưởng gấp 1.000 lần, nên biên chặn ngay lúc ghi. `integer`: điểm là số nguyên
    // (cột INTEGER; RewardPointsService.grant ném 500 với số lẻ nên thưởng 2.5 sẽ không bao giờ được cấp).
    'referral.referrer_reward_points': { min: 0, max: 100, note: 'Điểm Xanh (1 điểm = 1.000đ), không phải xu', integer: true },
    'community.post_reward_points': { min: 0, max: 20, note: 'Điểm Xanh (1 điểm = 1.000đ), không phải xu', integer: true },
    'community.answer_reward_points': { min: 0, max: 20, note: 'Điểm Xanh (1 điểm = 1.000đ), không phải xu', integer: true },
    'community.best_answer_reward_points': { min: 0, max: 20, note: 'Điểm Xanh (1 điểm = 1.000đ), không phải xu', integer: true },
    'game.tree_points_price': { min: 1, max: 500, note: 'Điểm Xanh mỗi lượt góp quỹ (1 điểm = 1.000đ), không phải xu', integer: true },
    'game.spin_buy_cost_points': { min: 1, max: 1000, note: 'Điểm Xanh mỗi lượt quay', integer: true },
    // OQ-11: lô Điểm Xanh quy đổi từ xu là tiền khách trả trước theo giá 1 điểm = 1.000đ; đổi tỉ giá là
    // làm lô đó mất hoặc tăng giá trị cho mọi khách.
    'loyalty.vnd_per_point_redeem': { min: 1000, max: 1000, note: 'đồng/điểm, khoá cứng từ PD-3 (lô quy đổi)' },
  };

  /** Bậc thưởng Season Pass tính bằng Điểm Xanh lớn nhất hợp lệ (bản xu cũ tối đa 30.000 xu = 30 điểm). */
  private static readonly SEASONPASS_POINTS_MAX = 100;
  /** Thưởng mốc giới thiệu lớn nhất hợp lệ (bản xu cũ tối đa 100.000 xu = 100 điểm). */
  private static readonly REFERRAL_MILESTONE_POINTS_MAX = 500;

  /**
   * Kiểm dạng cho khoá JSON có đơn vị tiền bên trong (RANGES chỉ kiểm số). Trả lời lỗi hoặc null.
   * PD-3: chặn ghi dạng xu cũ ({bonus} / type 'XU') hay giá trị xu dưới tên điểm.
   */
  private static readonly JSON_RULES: Record<string, (value: unknown) => string | null> = {
    'referral.milestones_points': (value) => {
      if (!Array.isArray(value)) return 'phải là mảng [{ count, bonusPoints }]';
      const max = SystemConfigService.REFERRAL_MILESTONE_POINTS_MAX;
      for (const m of value as Record<string, unknown>[]) {
        const count = m?.count;
        const bonus = m?.bonusPoints;
        if (!Number.isInteger(count) || (count as number) < 1) return 'mỗi mốc cần count là số nguyên ≥ 1';
        if (!Number.isInteger(bonus) || (bonus as number) < 1 || (bonus as number) > max) {
          return `mỗi mốc cần bonusPoints là Điểm Xanh nguyên 1–${max} (không phải xu; trường cũ "bonus" không còn dùng)`;
        }
      }
      return null;
    },
    // Giải POINTS âm trừ điểm của khách trong lần quay trúng giải (GameService.creditPoints nhánh delta < 0). Mảng rỗng
    // hợp lệ: tắt vòng quay ("Vòng quay chưa cấu hình").
    'game.spin_prizes': (value) => {
      if (!Array.isArray(value)) return 'phải là mảng giải [{ id, name, weight, rewardType, value }]';
      for (const [i, prize] of value.entries()) {
        const problem = spinPrizeProblem(prize);
        if (problem) {
          const id = (prize as { id?: unknown } | null)?.id;
          return `giải thứ ${i + 1}${typeof id === 'string' ? ` ("${id}")` : ''}: ${problem}`;
        }
      }
      return null;
    },
    'seasonpass.tiers': (value) => {
      if (!Array.isArray(value)) return 'phải là mảng bậc [{ xp, free, premium }]';
      const max = SystemConfigService.SEASONPASS_POINTS_MAX;
      for (const t of value as Record<string, unknown>[]) {
        if (!Number.isInteger(t?.xp) || (t.xp as number) < 0) return 'mỗi bậc cần xp là số nguyên ≥ 0';
        for (const track of ['free', 'premium'] as const) {
          const r = t[track] as { type?: unknown; amount?: unknown } | undefined;
          if (!r || (r.type !== 'SEEDS' && r.type !== 'POINTS')) return `${track}.type chỉ nhận SEEDS hoặc POINTS (XU đã gộp vào Điểm Xanh)`;
          if (!Number.isInteger(r.amount) || (r.amount as number) < 0) return `${track}.amount phải là số nguyên ≥ 0`;
          if (r.type === 'POINTS' && (r.amount as number) > max) return `${track}.amount POINTS tối đa ${max} Điểm Xanh (không phải xu)`;
        }
      }
      return null;
    },
  };

  private assertInRange(key: string, value: unknown): void {
    const jsonRule = SystemConfigService.JSON_RULES[key];
    if (jsonRule) {
      const problem = jsonRule(value);
      if (problem) throw new BadRequestException(`"${key}" không hợp lệ: ${problem}.`);
      return;
    }
    const rule = SystemConfigService.RANGES[key];
    if (!rule) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`"${key}" phải là số — ${rule.note}.`);
    }
    if (rule.integer && !Number.isInteger(value)) {
      throw new BadRequestException(`"${key}" phải là số nguyên — ${rule.note}. Giá trị vừa nhập: ${value}.`);
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
        // JSON null = khoá có dòng nhưng chưa đặt giá trị (seed ETA giao hàng): chưa có kiểu để giữ, và `typeof null`
        // là 'object' nên nếu không bỏ qua thì admin không bao giờ đặt được số đầu tiên.
        const wasUnset = existing.value === null;
        const oldType = Array.isArray(existing.value) ? 'array' : typeof existing.value;
        const newType = Array.isArray(value) ? 'array' : typeof value;
        if (!wasUnset && oldType !== newType) {
          throw new BadRequestException(
            `Kiểu dữ liệu mới ("${newType}") khác kiểu hiện tại ("${oldType}") của "${key}". ` +
              'Đổi kiểu có thể làm crash nơi khác đang dùng get<T>() với kiểu cũ. Nếu chắc chắn muốn đổi, xoá config này trước rồi tạo lại.',
          );
        }
        await tx.systemConfigHistory.create({
          data: {
            key,
            oldValue: wasUnset ? Prisma.JsonNull : (existing.value as object),
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
