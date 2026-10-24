import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { notifyAdmins } from '../../common/notify-admins';
import { setCronRunSink, type CronRunReport, type CronRunSink } from '../../common/cron-run/track-cron';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const ALERT_EVERY_MS = 6 * 3_600_000;
const MAX_ERROR_LENGTH = 300;

export interface CronRunRow {
  job: string;
  lastStartedAt: string;
  lastFinishedAt: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastDurationMs: number;
}

/** Tên lớp lỗi + dòng đầu thông điệp. Không stack; lỗi không phải Error chỉ ghi kiểu vì giá trị có thể là dữ liệu request. */
export function describeCronError(err: unknown): string {
  if (!(err instanceof Error)) return `NonError: ${typeof err}`;
  const firstLine = err.message.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  const name = err.constructor?.name && err.constructor.name !== 'Object' ? err.constructor.name : err.name;
  return `${name}: ${firstLine}`.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Sổ lần chạy cuối của từng @Cron (bảng cron_runs, một dòng mỗi job, một upsert mỗi lần chạy). Chỉ leader chạy cron nên
 * chỉ leader ghi. Lỗi thì báo admin qua OPS_CRON_FAILED, tối đa một lần mỗi job mỗi 6 giờ trong khi còn lỗi; chạy thành công
 * thì xoá mốc báo để lần lỗi sau báo ngay.
 */
@Injectable()
export class CronRunService implements OnModuleInit, CronRunSink {
  private readonly logger = new Logger(CronRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  onModuleInit(): void {
    setCronRunSink(this);
  }

  async record(run: CronRunReport): Promise<void> {
    const base = {
      lastStartedAt: run.startedAt,
      lastFinishedAt: run.finishedAt,
      lastDurationMs: Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime()),
    };
    if (!('error' in run)) {
      await this.prisma.cronRun.upsert({
        where: { job: run.job },
        create: { job: run.job, ...base, lastSuccessAt: run.finishedAt, consecutiveFailures: 0 },
        update: { ...base, lastSuccessAt: run.finishedAt, consecutiveFailures: 0, lastAlertedAt: null },
      });
      return;
    }
    const lastError = describeCronError(run.error);
    const fail = { lastErrorAt: run.finishedAt, lastError };
    const row = await this.prisma.cronRun.upsert({
      where: { job: run.job },
      create: { job: run.job, ...base, ...fail, consecutiveFailures: 1 },
      update: { ...base, ...fail, consecutiveFailures: { increment: 1 } },
    });
    // Giành quyền báo bằng một UPDATE có điều kiện: hai lần lỗi sát nhau chỉ một bên thấy count = 1.
    const claimed = await this.prisma.cronRun.updateMany({
      where: { job: run.job, OR: [{ lastAlertedAt: null }, { lastAlertedAt: { lt: new Date(run.finishedAt.getTime() - ALERT_EVERY_MS) } }] },
      data: { lastAlertedAt: run.finishedAt },
    });
    if (claimed.count === 0) return;
    try {
      await notifyAdmins(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        { template: 'OPS_CRON_FAILED', subject: `tác vụ nền ${run.job} lỗi`, data: () => ({ job: run.job, count: String(row.consecutiveFailures), error: lastError }) },
      );
    } catch (err) {
      this.logger.error(`Không báo được admin về cron ${run.job}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async list(): Promise<CronRunRow[]> {
    const rows = await this.prisma.cronRun.findMany({ orderBy: { job: 'asc' } });
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return rows.map((r) => ({
      job: r.job,
      lastStartedAt: r.lastStartedAt.toISOString(),
      lastFinishedAt: r.lastFinishedAt.toISOString(),
      lastSuccessAt: iso(r.lastSuccessAt),
      lastErrorAt: iso(r.lastErrorAt),
      lastError: r.lastError,
      consecutiveFailures: r.consecutiveFailures,
      lastDurationMs: r.lastDurationMs,
    }));
  }
}
