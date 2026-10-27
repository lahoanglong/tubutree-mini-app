import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface SeasonInput {
  name: string;
  theme?: string | null;
  region?: string | null;
  startAt: Date;
  endAt: Date;
}

export type SeasonPatch = Partial<SeasonInput>;

export type SeasonStatus = 'UPCOMING' | 'ACTIVE' | 'ENDED';

/**
 * Mùa Vườn Xanh (bảng seasons). Khách chỉ thấy mùa đang trong cửa sổ [startAt, endAt] (GameSeasonService.getActiveSeason), nên
 * hai mùa chồng thời gian sẽ chọn mùa bắt đầu muộn hơn mà admin không biết: chặn chồng ngay lúc lưu.
 */
@Injectable()
export class AdminGameSeasonService {
  constructor(private readonly prisma: PrismaService) {}

  private status(s: { startAt: Date; endAt: Date }, now = new Date()): SeasonStatus {
    return s.endAt < now ? 'ENDED' : s.startAt > now ? 'UPCOMING' : 'ACTIVE';
  }

  async list() {
    const rows = await this.prisma.season.findMany({ orderBy: { startAt: 'desc' } });
    return rows.map((s) => ({ ...s, status: this.status(s) }));
  }

  private async assertNoOverlap(startAt: Date, endAt: Date, exceptId?: string) {
    const clash = await this.prisma.season.findFirst({
      where: { startAt: { lte: endAt }, endAt: { gte: startAt }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { name: true },
    });
    if (clash) throw new BadRequestException(`Thời gian trùng với mùa "${clash.name}". Hãy chọn khoảng ngày không giao nhau.`);
  }

  private assertRange(startAt: Date, endAt: Date) {
    if (!(endAt.getTime() > startAt.getTime())) throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu.');
  }

  async create(input: SeasonInput) {
    this.assertRange(input.startAt, input.endAt);
    await this.assertNoOverlap(input.startAt, input.endAt);
    const row = await this.prisma.season.create({
      data: {
        id: randomUUID(),
        name: input.name,
        theme: input.theme ?? null,
        region: input.region ?? null,
        startAt: input.startAt,
        endAt: input.endAt,
      },
    });
    return { ...row, status: this.status(row) };
  }

  async update(id: string, patch: SeasonPatch) {
    const found = await this.prisma.season.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Không tìm thấy mùa.');
    const startAt = patch.startAt ?? found.startAt;
    const endAt = patch.endAt ?? found.endAt;
    this.assertRange(startAt, endAt);
    await this.assertNoOverlap(startAt, endAt, id);
    const row = await this.prisma.season.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
        ...(patch.region !== undefined ? { region: patch.region } : {}),
        startAt,
        endAt,
      },
    });
    return { ...row, status: this.status(row) };
  }

  async remove(id: string) {
    const found = await this.prisma.season.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Không tìm thấy mùa.');
    await this.prisma.season.delete({ where: { id } });
    return { deleted: true as const };
  }
}
