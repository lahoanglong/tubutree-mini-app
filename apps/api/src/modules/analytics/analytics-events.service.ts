import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AnalyticsEventInput {
  eventId?: string;
  eventName: string;
  occurredAt?: Date;
  userId?: string | null;
  anonymousId?: string | null;
  sessionId?: string | null;
  platform: 'miniapp' | 'web' | 'admin' | 'pos' | 'system';
  appVersion?: string | null;
  entrySource?: string | null;
  notificationId?: string | null;
  refCode?: string | null;
  storefrontSlug?: string | null;
  props?: Record<string, unknown>;
}

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AnalyticsEventsService {
  private readonly logger = new Logger(AnalyticsEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Ghi sự kiện — gọi với `tx` khi cần atomic với nghiệp vụ đang chạy trong transaction đó. */
  async record(db: Db, input: AnalyticsEventInput): Promise<void> {
    await db.analyticsEvent.create({
      data: {
        eventId: input.eventId ?? randomUUID(),
        eventName: input.eventName,
        occurredAt: input.occurredAt ?? new Date(),
        userId: input.userId ?? null,
        anonymousId: input.anonymousId ?? null,
        sessionId: input.sessionId ?? null,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
        entrySource: input.entrySource ?? null,
        notificationId: input.notificationId ?? null,
        refCode: input.refCode ?? null,
        storefrontSlug: input.storefrontSlug ?? null,
        props: (input.props ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /** Ghi best-effort NGOÀI transaction — không bao giờ throw, dùng cho sự kiện không phải tiền. */
  async recordBestEffort(input: AnalyticsEventInput): Promise<void> {
    try {
      await this.record(this.prisma, input);
    } catch (err) {
      this.logger.warn(`Ghi analytics event thất bại (bỏ qua): ${input.eventName} — ${err}`);
    }
  }
}
