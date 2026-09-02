import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
    const data: { fullName?: string; email?: string; avatarUrl?: string; dob?: Date } = { ...rest };
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
      data.dob = parsed;
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
