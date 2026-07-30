import { Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

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
      if (fallback !== undefined) return fallback;
      throw new NotFoundException(`SystemConfig "${key}" chưa được cấu hình.`);
    }
    this.cache.set(key, { value: row.value, at: Date.now() });
    return row.value as T;
  }

  async getByCategory(category: string): Promise<Record<string, unknown>> {
    const rows = await this.prisma.systemConfig.findMany({ where: { category } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async set(key: string, value: object | string | number | boolean, changedBy: string): Promise<void> {
    const existing = await this.prisma.systemConfig.findUnique({ where: { key } });
    await this.prisma.$transaction(async (tx) => {
      if (existing) {
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
        create: { key, value: value as object, category: key.split('.')[0] ?? 'misc', updatedBy: changedBy },
      });
    });
    this.cache.delete(key);
  }
}
