import { BadRequestException, Injectable } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

export interface BetaFeature {
  key: string;
  title: string;
  desc: string;
}

/**
 * Beta Tester (§6.14.11). User tự nguyện tham gia chương trình trải nghiệm sớm:
 * - thấy danh sách tính năng beta (config `beta.features`, chỉ lộ cho người đã tham gia),
 * - gửi góp ý cho đội ngũ.
 * `isBetaTester` dùng để các tính năng khác gate early-access nếu cần.
 */
@Injectable()
export class BetaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async getStatus(userId: string) {
    const tester = await this.prisma.betaTester.findUnique({ where: { userId } });
    const enrolled = tester?.status === 'ACTIVE';
    const features = enrolled ? await this.config.get<BetaFeature[]>('beta.features', []) : [];
    return { enrolled, joinedAt: enrolled ? tester?.joinedAt ?? null : null, features };
  }

  async isBetaTester(userId: string): Promise<boolean> {
    const tester = await this.prisma.betaTester.findUnique({ where: { userId } });
    return tester?.status === 'ACTIVE';
  }

  async join(userId: string) {
    const tester = await this.prisma.betaTester.upsert({
      where: { userId },
      create: { userId, status: 'ACTIVE' },
      update: { status: 'ACTIVE', joinedAt: new Date() },
    });
    // Dựng status trực tiếp từ kết quả upsert (đã chắc chắn ACTIVE) — đỡ 1 query.
    const features = await this.config.get<BetaFeature[]>('beta.features', []);
    return { enrolled: true, joinedAt: tester.joinedAt, features };
  }

  async leave(userId: string) {
    // updateMany theo userId → idempotent, không lỗi nếu chưa từng tham gia.
    await this.prisma.betaTester.updateMany({ where: { userId }, data: { status: 'LEFT' } });
    return { enrolled: false };
  }

  async submitFeedback(userId: string, message: string) {
    const enrolled = await this.isBetaTester(userId);
    if (!enrolled) throw new BadRequestException('Bạn cần tham gia chương trình Beta trước khi gửi góp ý.');
    const trimmed = (message ?? '').trim();
    if (!trimmed) throw new BadRequestException('Nội dung góp ý không được để trống.');
    await this.prisma.betaFeedback.create({ data: { userId, message: trimmed } });
    return { ok: true };
  }
}
