import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { notifyAdmins } from '../../common/notify-admins';
import { setCronRunSink, type CronRunReport, type CronRunSink } from '../../common/cron-run/track-cron';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const ALERT_EVERY_MS = 6 * 3_600_000;
/** Một lần lỗi lẻ (mạng chập chờn) chưa đáng báo. */
const ALERT_AFTER_FAILURES = 2;
const RECOVERY_QUIET_MS = 3_600_000;
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
  lastOutcome: string;
  lastErrorCount: number;
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
 * chỉ leader ghi. Lần chạy hỏng = ném lỗi hoặc có log error (xem track-cron.ts). Từ lần hỏng liên tiếp thứ hai báo admin qua
 * OPS_CRON_FAILED, tối đa một lần mỗi job mỗi 6 giờ.
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
    const timing = {
      lastStartedAt: run.startedAt,
      lastFinishedAt: run.finishedAt,
      lastDurationMs: Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime()),
    };
    if (run.outcome === 'SKIPPED') {
      // Chuỗi lỗi, mốc báo và lần thành công cuối giữ nguyên: thoát sớm không nói gì về sức khoẻ của job.
      await this.prisma.cronRun.upsert({
        where: { job: run.job },
        create: { job: run.job, ...timing, lastOutcome: 'SKIPPED', consecutiveFailures: 0 },
        update: { lastFinishedAt: run.finishedAt, lastOutcome: 'SKIPPED' },
      });
      return;
    }
    if (run.outcome === 'OK') {
      const row = await this.prisma.cronRun.upsert({
        where: { job: run.job },
        create: { job: run.job, ...timing, lastOutcome: 'OK', lastSuccessAt: run.finishedAt, consecutiveFailures: 0 },
        update: { ...timing, lastOutcome: 'OK', lastErrorCount: 0, lastSuccessAt: run.finishedAt, consecutiveFailures: 0 },
      });
      // Job chập chờn (lỗi, OK, lỗi...) không được báo lại mỗi chu kỳ: chỉ xoá mốc báo khi lần lỗi cuối đã hơn 1 giờ.
      if (row.lastAlertedAt && (!row.lastErrorAt || row.lastErrorAt.getTime() < run.finishedAt.getTime() - RECOVERY_QUIET_MS)) {
        await this.prisma.cronRun.updateMany({ where: { job: run.job, lastAlertedAt: row.lastAlertedAt }, data: { lastAlertedAt: null } });
      }
      return;
    }
    const lastError = run.outcome === 'THREW' ? describeCronError(run.error) : (run.errorLine ?? '').slice(0, MAX_ERROR_LENGTH);
    const fail = { lastErrorAt: run.finishedAt, lastError, lastOutcome: run.outcome, lastErrorCount: run.errorCount };
    const row = await this.prisma.cronRun.upsert({
      where: { job: run.job },
      create: { job: run.job, ...timing, ...fail, consecutiveFailures: 1 },
      update: { ...timing, ...fail, consecutiveFailures: { increment: 1 } },
    });
    if (row.consecutiveFailures < ALERT_AFTER_FAILURES) return;
    // Giành quyền báo bằng một UPDATE có điều kiện: hai lần lỗi sát nhau chỉ một bên thấy count = 1.
    const claimed = await this.prisma.cronRun.updateMany({
      where: { job: run.job, OR: [{ lastAlertedAt: null }, { lastAlertedAt: { lt: new Date(run.finishedAt.getTime() - ALERT_EVERY_MS) } }] },
      data: { lastAlertedAt: run.finishedAt },
    });
    if (claimed.count === 0) return;
    let delivered = 0;
    const notifier = this.notifications && {
      notify: async (userId: string, template: string, data: Record<string, string>) => {
        await this.notifications!.notify(userId, template, data);
        delivered++;
      },
    };
    try {
      await notifyAdmins(
        { prisma: this.prisma, notifications: notifier, logger: this.logger },
        { template: 'OPS_CRON_FAILED', subject: `tác vụ nền ${run.job} lỗi`, data: () => ({ job: run.job, count: String(row.consecutiveFailures), error: lastError }) },
      );
    } catch (err) {
      this.logger.error(`Không báo được admin về cron ${run.job}: ${err instanceof Error ? err.message : err}`);
    }
    // notifyAdmins nuốt lỗi từng admin; không ai nhận được thì nhả mốc báo để lần hỏng kế tiếp thử lại, thay vì im lặng 6 giờ.
    if (delivered === 0) {
      await this.prisma.cronRun
        .updateMany({ where: { job: run.job, lastAlertedAt: run.finishedAt }, data: { lastAlertedAt: null } })
        .catch((e: unknown) => this.logger.error(`Không nhả được mốc báo cron ${run.job}: ${e instanceof Error ? e.message : e}`));
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
      lastOutcome: r.lastOutcome,
      lastErrorCount: r.lastErrorCount,
    }));
  }
}
