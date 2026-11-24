import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TAX_CODE_RE } from '../checkout/dto/checkout.dto';
import type { InvoiceRequestDto } from '../checkout/dto/checkout.dto';

/** Đơn đặt quá số ngày này thì đại lý không tự gửi yêu cầu hoá đơn được nữa: hoá đơn VAT lập theo ngày bán, kế toán xử lý riêng. */
export const DEALER_INVOICE_REQUEST_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DealerInvoiceInfo {
  taxCode: string;
  companyName: string;
  address: string;
  email: string;
}

/** Thông tin xuất hoá đơn điền sẵn cho đại lý. `saved` = đại lý đã tự lưu; false = lấy từ hồ sơ đăng ký đại lý (có thể trống). */
export interface DealerInvoiceProfile extends DealerInvoiceInfo {
  saved: boolean;
}

export interface DealerInvoiceRequestResult {
  requested: string[];
  skipped: { code: string; reason: string }[];
  profile: DealerInvoiceProfile | null;
}

const NOT_DEALER = 'Tài khoản chưa được duyệt làm đại lý.';
const SKIP_NOT_FOUND = 'Không tìm thấy đơn đại lý này.';
const SKIP_CLOSED = 'Đơn đã huỷ hoặc trả hàng.';
const SKIP_ISSUED = 'Đơn đã có hoá đơn.';
const SKIP_REQUESTED = 'Đơn đã có yêu cầu hoá đơn.';
const SKIP_TOO_OLD = `Đơn đặt quá ${DEALER_INVOICE_REQUEST_DAYS} ngày, bạn liên hệ Tubu Tree để xuất hoá đơn.`;
const SKIP_CHANGED = 'Đơn vừa đổi trạng thái, bạn tải lại để xem.';

const CLOSED_STATUSES = ['CANCELLED', 'RETURNED'] as const;
/** Đơn chưa có yêu cầu hoá đơn: cột trống (đơn rất cũ) hoặc NOT_REQUESTED. */
const NO_INVOICE_YET: Prisma.OrderWhereInput = { OR: [{ invoiceStatus: null }, { invoiceStatus: 'NOT_REQUESTED' }] };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** `metadata.dealerInvoice` đọc an toàn: thiếu ô hay MST sai dạng (dữ liệu cũ, sửa tay) thì coi như chưa lưu. */
export function savedInvoiceOf(metadata: unknown): DealerInvoiceInfo | null {
  const raw = (metadata as { dealerInvoice?: unknown } | null)?.dealerInvoice;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const info = { taxCode: str(r.taxCode), companyName: str(r.companyName), address: str(r.address), email: str(r.email) };
  if (!TAX_CODE_RE.test(info.taxCode) || !info.companyName || !info.address || !info.email) return null;
  return info;
}

const INCOMPLETE = 'Nhập tên công ty và địa chỉ xuất hoá đơn.';

/**
 * DTO hoá đơn dùng chung với thanh toán lẻ chỉ cắt khoảng trắng, không bắt tên công ty và địa chỉ khác rỗng. Chặn ở đây để thông tin
 * đại lý lưu và mọi yêu cầu vào hàng chờ "Hoá đơn VAT" của admin luôn đủ ô, kể cả khi gọi thẳng API.
 */
export function assertInvoiceComplete(dto: Pick<InvoiceRequestDto, 'companyName' | 'address'>): void {
  if (!dto.companyName?.trim() || !dto.address?.trim()) throw new BadRequestException(INCOMPLETE);
}

const infoOf = (dto: InvoiceRequestDto): DealerInvoiceInfo => ({
  taxCode: dto.taxCode,
  companyName: dto.companyName,
  address: dto.address,
  email: dto.email,
});

/**
 * Hoá đơn VAT của đại lý: thông tin xuất hoá đơn lưu sẵn (một chạm điền vào đơn) và gửi yêu cầu hoá đơn cho nhiều đơn đã đặt.
 * Thông tin lưu ở `users.metadata.dealerInvoice` (không thêm cột); yêu cầu ghi vào `orders.invoiceRequest` như thanh toán lẻ, nên
 * vào đúng hàng chờ "Hoá đơn VAT" của admin (admin-order-filter INVOICE_OPEN_WHERE).
 */
@Injectable()
export class DealerInvoiceService {
  private readonly logger = new Logger(DealerInvoiceService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async dealerUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, email: true, metadata: true } });
    if (!user || user.role !== 'DEALER') throw new ForbiddenException(NOT_DEALER);
    return user;
  }

  async profile(userId: string): Promise<DealerInvoiceProfile> {
    const user = await this.dealerUser(userId);
    const saved = savedInvoiceOf(user.metadata);
    if (saved) return { ...saved, saved: true };
    // Chưa lưu: điền từ hồ sơ đăng ký đại lý (hồ sơ đã duyệt gần nhất). Email hồ sơ không có, lấy email tài khoản.
    const app = await this.prisma.dealerApplication.findFirst({
      where: { userId, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      select: { businessName: true, taxCode: true, address: true },
    });
    return {
      saved: false,
      taxCode: app?.taxCode && TAX_CODE_RE.test(app.taxCode) ? app.taxCode : '',
      companyName: app?.businessName ?? '',
      address: app?.address ?? '',
      email: user.email ?? '',
    };
  }

  /** Lưu thông tin xuất hoá đơn. Khoá dòng users rồi mới gộp metadata: duyệt/gán bậc đại lý ghi `dealerTierId` vào cùng cột. */
  async saveProfile(userId: string, dto: InvoiceRequestDto): Promise<DealerInvoiceProfile> {
    assertInvoiceComplete(dto);
    const info = infoOf(dto);
    await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ role: string; metadata: unknown }[]>`
        SELECT "role"::text AS "role", "metadata" FROM "users" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
      if (!row || row.role !== 'DEALER') throw new ForbiddenException(NOT_DEALER);
      const base = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
      await tx.user.update({
        where: { id: userId },
        data: { metadata: { ...base, dealerInvoice: { ...info, savedAt: new Date().toISOString() } } as Prisma.InputJsonObject },
      });
    });
    return { ...info, saved: true };
  }

  /**
   * Gửi yêu cầu hoá đơn VAT cho các đơn đại lý (theo mã) chưa có yêu cầu. Mỗi đơn ghi bằng một lệnh có điều kiện (chưa có yêu cầu,
   * chưa huỷ/trả), nên gửi lại hay hai lần bấm cùng lúc không ghi đè yêu cầu đã có; đơn không đủ điều kiện trả về `skipped` kèm lý do.
   */
  async requestInvoices(
    userId: string,
    dto: { orderCodes: string[]; invoice: InvoiceRequestDto; save?: boolean },
    now: Date = new Date(),
  ): Promise<DealerInvoiceRequestResult> {
    await this.dealerUser(userId);
    assertInvoiceComplete(dto.invoice);
    const codes = [...new Set(dto.orderCodes.map((c) => c.trim()).filter(Boolean))];
    const info = infoOf(dto.invoice);
    const cutoff = new Date(now.getTime() - DEALER_INVOICE_REQUEST_DAYS * DAY_MS);
    const orders = await this.prisma.order.findMany({
      where: { userId, type: 'DEALER', code: { in: codes } },
      select: { id: true, code: true, status: true, invoiceStatus: true, createdAt: true },
    });
    const byCode = new Map(orders.map((o) => [o.code, o]));
    const requested: string[] = [];
    const skipped: { code: string; reason: string }[] = [];
    for (const code of codes) {
      const o = byCode.get(code);
      let reason: string | null = null;
      if (!o) reason = SKIP_NOT_FOUND;
      else if ((CLOSED_STATUSES as readonly string[]).includes(o.status)) reason = SKIP_CLOSED;
      else if (o.invoiceStatus === 'ISSUED') reason = SKIP_ISSUED;
      else if (o.invoiceStatus && o.invoiceStatus !== 'NOT_REQUESTED') reason = SKIP_REQUESTED;
      else if (o.createdAt.getTime() < cutoff.getTime()) reason = SKIP_TOO_OLD;
      if (reason || !o) {
        skipped.push({ code, reason: reason ?? SKIP_NOT_FOUND });
        continue;
      }
      const res = await this.prisma.order.updateMany({
        where: { id: o.id, userId, type: 'DEALER', status: { notIn: [...CLOSED_STATUSES] }, ...NO_INVOICE_YET },
        data: { invoiceRequest: { ...info }, invoiceStatus: 'REQUESTED' },
      });
      if (res.count === 1) requested.push(code);
      else skipped.push({ code, reason: SKIP_CHANGED });
    }
    const profile = dto.save ? await this.saveProfile(userId, dto.invoice) : null;
    if (requested.length > 0) this.logger.log(`Đại lý ${userId} gửi yêu cầu hoá đơn VAT cho ${requested.length} đơn: ${requested.join(', ')}.`);
    return { requested, skipped, profile };
  }
}
