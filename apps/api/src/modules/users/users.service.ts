import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Optional: mirror DealerService/GameService — 18+ chỗ test dựng service trực tiếp không
    // truyền notifications. Thiếu wiring thì log cảnh báo, KHÔNG im lặng bỏ qua.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { tier: true },
    });
    return this.serialize(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    // dob đến dạng "YYYY-MM-DD" → ép về Date (Prisma DateTime không nhận date-only string).
    const { dob, ...rest } = dto;
    const data: { fullName?: string; email?: string; avatarUrl?: string } = { ...rest };
    if (dob !== undefined) {
      const parsed = new Date(dob);
      // DTO chỉ khớp SHAPE "YYYY-MM-DD" bằng regex, KHÔNG kiểm tra ngày có thật tồn tại.
      // 2 kiểu input vô lý cùng khớp regex nhưng cần chặn khác nhau:
      //  - Tháng ngoài 01-12 (vd "2024-13-01") → new Date() trả Invalid Date; nếu lọt xuống
      //    Prisma, .toISOString() nội bộ throw RangeError → 500 thô.
      //  - Ngày ngoài số ngày thực của tháng (vd "2024-02-30") → new Date() KHÔNG báo lỗi mà
      //    ÂM THẦM lăn sang tháng sau (2024-02-30 → 2024-03-01) → lưu sai ngày sinh mà
      //    không ai biết (ảnh hưởng voucher sinh nhật). Round-trip qua ISO string để bắt cả 2.
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dob) {
        throw new BadRequestException('dob không phải một ngày hợp lệ.');
      }

      // A3-04 (audit 2026-09): dob trước đây sửa được tự do bất kỳ lúc nào → khách đổi dob
      // sang "ngày mai" mỗi tháng để cày voucher sinh nhật (50.000đ, KHÔNG minOrder — xem
      // vouchers.service.ts birthdayVouchers()). Khoá idempotency của cron cấp voucher chỉ
      // chặn theo `BIRTHDAY-<năm>-<tháng>-<userId>`, KHÔNG chặn theo việc dob có thật hay có
      // đứng yên đủ lâu không — mỗi tháng đổi dob là một reason mới, không bị chặn trùng.
      // Fix đơn giản và chắc: dob chỉ ĐẶT ĐƯỢC MỘT LẦN; sửa lại (đính chính) phải qua CSKH,
      // không tự phục vụ. Đây là đánh đổi chấp nhận được cho một tính năng giá trị thấp.
      // updateMany + where dob:null (thay vì findUnique rồi update riêng) để 2 request ghi
      // đồng thời không cùng đọc thấy null rồi cùng lọt qua — Postgres khoá theo dòng nên chỉ
      // request nào TỚI TRƯỚC mới khớp where, request sau đọc lại thấy dob đã khác null.
      const guarded = await this.prisma.user.updateMany({ where: { id: userId, dob: null }, data: { dob: parsed } });
      if (guarded.count === 0) {
        throw new BadRequestException(
          'Ngày sinh chỉ có thể đặt một lần và không tự sửa lại được. Vui lòng liên hệ CSKH nếu cần đính chính.',
        );
      }
      // Đã ghi dob ở updateMany trên — KHÔNG gắn lại vào `data` (tránh update() ghi đè lần 2).
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      include: { tier: true },
    });
    return this.serialize(user);
  }

  listAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
  }

  async createAddress(userId: string, dto: CreateAddressDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const count = await tx.address.count({ where: { userId } });
        const makeDefault = dto.isDefault ?? count === 0;
        if (makeDefault) {
          await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
        }
        return tx.address.create({ data: { ...dto, isDefault: makeDefault, userId } });
      },
      // Serializable: count-rồi-write không atomic — 2 request tạo địa chỉ đầu tiên
      // đồng thời có thể cùng đọc count=0 rồi cùng tạo isDefault:true. Serializable
      // buộc 1 trong 2 tx fail (P2034, map 409 bởi PrismaExceptionFilter) thay vì
      // để user có 2 địa chỉ mặc định.
      { isolationLevel: 'Serializable' },
    );
  }

  async updateAddress(userId: string, id: string, dto: UpdateAddressDto) {
    await this.assertOwner(userId, id);
    return this.prisma.$transaction(
      async (tx) => {
        if (dto.isDefault) {
          await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
        }
        return tx.address.update({ where: { id }, data: dto });
      },
      // Serializable: 2 update isDefault:true đồng thời cho 2 địa chỉ khác nhau có thể
      // đan xen và để lại 0 hoặc 2 địa chỉ mặc định (mirror createAddress ở trên).
      { isolationLevel: 'Serializable' },
    );
  }

  async deleteAddress(userId: string, id: string) {
    await this.assertOwner(userId, id);
    await this.prisma.address.delete({ where: { id } });
    return { ok: true };
  }

  private async assertOwner(userId: string, addressId: string) {
    const addr = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!addr) throw new NotFoundException('Không tìm thấy địa chỉ.');
    if (addr.userId !== userId) throw new ForbiddenException('Địa chỉ không thuộc về bạn.');
  }

  /** Lưu kết quả onboarding quiz (segments) vào metadata + đánh dấu đã onboard. */
  async completeOnboarding(userId: string, segments: string[]) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const metadata = { ...(user.metadata as Record<string, unknown> | null), segments, onboardedAt: new Date().toISOString() };
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { metadata },
      include: { tier: true },
    });
    return this.serialize(updated);
  }

  /**
   * A1-03 (audit 2026-09): nút "Gửi yêu cầu xoá tài khoản" trước đây chỉ hiện snackbar giả, không
   * gọi API nào. Đây KHÔNG phải xoá thật (cascade/ẩn danh hoá dữ liệu là quyết định nghiệp vụ lớn
   * hơn phạm vi vá lỗi này) — chỉ ghi nhận YÊU CẦU thật + báo admin qua NotificationsService để CSKH
   * xử lý thủ công, mirror notifyAdminsOfCreditReport (dealer.service.ts). Idempotent-ish: đã có
   * yêu cầu PENDING thì trả lại chính yêu cầu đó, không tạo dòng mới (khách bấm nhiều lần không
   * tạo hàng đợi vô hạn cho CSKH).
   */
  async requestAccountDeletion(userId: string, reason?: string) {
    const existing = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return {
        alreadyRequested: true,
        createdAt: existing.createdAt,
        message: 'Bạn đã gửi yêu cầu xoá tài khoản trước đó. CSKH sẽ liên hệ xử lý trong vòng 3 ngày làm việc.',
      };
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const request = await this.prisma.accountDeletionRequest.create({
      data: { userId, reason: reason?.trim() || null },
    });

    await this.notifyAdminsOfDeletionRequest(user, request.id).catch((e) =>
      this.logger.warn(`Báo admin yêu cầu xoá tài khoản ${userId} lỗi: ${(e as Error).message}`),
    );

    return {
      alreadyRequested: false,
      createdAt: request.createdAt,
      message: 'Yêu cầu đã được ghi nhận. CSKH sẽ liên hệ xử lý trong vòng 3 ngày làm việc — tài khoản CHƯA bị xoá.',
    };
  }

  /** Báo mọi tài khoản ADMIN có yêu cầu xoá tài khoản mới cần xử lý — mirror
   * DealerService.notifyAdminsOfCreditReport (cùng kiểu: query ADMIN, Promise.allSettled, log warn
   * không throw — thiếu thông báo không được chặn việc ghi nhận yêu cầu của khách). */
  private async notifyAdminsOfDeletionRequest(
    user: { id: string; fullName: string | null; phone: string | null },
    requestId: string,
  ) {
    if (!this.notifications) {
      this.logger.warn(`NotificationsService chưa wiring — không báo được admin yêu cầu xoá tài khoản ${user.id} (request ${requestId}).`);
      return;
    }
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', isBlocked: false },
      select: { id: true },
      take: 20,
    });
    if (admins.length === 0) {
      this.logger.warn(`Không có tài khoản ADMIN nào để báo yêu cầu xoá tài khoản ${user.id}.`);
      return;
    }
    const data = { user: user.fullName || user.phone || user.id, phone: user.phone ?? '' };
    const results = await Promise.allSettled(
      admins.map((a) => this.notifications!.notify(a.id, 'ACCOUNT_DELETION_REQUESTED', data)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.warn(`Báo admin yêu cầu xoá tài khoản ${user.id}: lỗi ${failed}/${admins.length}.`);
    }
  }

  private serialize(user: {
    id: string;
    zaloId: string | null;
    phone: string | null;
    email: string | null;
    fullName: string | null;
    dob?: Date | null;
    avatarUrl: string | null;
    role: string;
    tierId: string | null;
    referralCode: string;
    pointsBalance: number;
    walletBalance: number;
    cashbackPending: number;
    metadata?: unknown;
    tier?: { id: string; name: string } | null;
  }) {
    const meta = (user.metadata ?? null) as { segments?: string[]; onboardedAt?: string } | null;
    return {
      id: user.id,
      zaloId: user.zaloId,
      phone: user.phone,
      email: user.email,
      fullName: user.fullName,
      dob: user.dob ? user.dob.toISOString().slice(0, 10) : null,
      avatarUrl: user.avatarUrl,
      role: user.role,
      tierId: user.tierId,
      tierName: user.tier?.name ?? null,
      referralCode: user.referralCode,
      pointsBalance: user.pointsBalance,
      walletBalance: user.walletBalance,
      cashbackPending: user.cashbackPending,
      onboarded: Boolean(meta?.onboardedAt),
      segments: meta?.segments ?? [],
    };
  }
}
