import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
    if (dob !== undefined) data.dob = new Date(dob);

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
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      const makeDefault = dto.isDefault ?? count === 0;
      if (makeDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.create({ data: { ...dto, isDefault: makeDefault, userId } });
    });
  }

  async updateAddress(userId: string, id: string, dto: UpdateAddressDto) {
    await this.assertOwner(userId, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.update({ where: { id }, data: dto });
    });
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
