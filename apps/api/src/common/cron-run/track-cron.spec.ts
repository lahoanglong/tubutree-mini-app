import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Cron, ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';
import { CRON_TZ } from '../cron-tz';
import { setCronRunSink, TrackCron, type CronRunReport } from './track-cron';

@Injectable()
class Probe {
  calls = 0;
  fail: Error | null = null;

  @Cron('0 0 1 1 *', { timeZone: CRON_TZ })
  @TrackCron()
  async unnamed(): Promise<void> {
    this.calls++;
    if (this.fail) throw this.fail;
  }

  @Cron('0 0 1 1 *', { name: 'probe.named', timeZone: CRON_TZ })
  @TrackCron()
  async named(): Promise<string> {
    return 'ok';
  }
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
}

describe('TrackCron (chạy trên @nestjs/schedule + cron thật)', () => {
  const reports: CronRunReport[] = [];
  afterEach(() => {
    setCronRunSink(undefined);
    reports.length = 0;
  });

  async function boot() {
    setCronRunSink({ record: async (r) => void reports.push(r) });
    const mod = await Test.createTestingModule({ imports: [ScheduleModule.forRoot()], providers: [Probe] }).compile();
    await mod.init();
    return { mod, probe: mod.get(Probe), registry: mod.get(SchedulerRegistry) };
  }

  it('job được Nest đăng ký vẫn chạy và báo thành công, tên Lớp.phươngThức khi không đặt name', async () => {
    const { mod, probe, registry } = await boot();
    // Cron của Nest chỉ ghi lỗi vào log và nuốt promise; ép bắn như lịch thật: job.fireOnTick().
    const job = [...registry.getCronJobs().entries()].find(([k]) => k !== 'probe.named')![1];
    job.fireOnTick();
    await until(() => reports.length > 0);
    expect(probe.calls).toBe(1);
    expect(reports[0]).toMatchObject({ job: 'Probe.unnamed' });
    expect(reports[0]!.error).toBeUndefined();
    expect(reports[0]!.finishedAt.getTime()).toBeGreaterThanOrEqual(reports[0]!.startedAt.getTime());
    await mod.close();
  });

  it('dùng name của @Cron khi có', async () => {
    const { mod, registry } = await boot();
    registry.getCronJob('probe.named').fireOnTick();
    await until(() => reports.length > 0);
    expect(reports[0]!.job).toBe('probe.named');
    await mod.close();
  });

  it('lỗi do handler ném (dù Nest nuốt) vẫn được báo kèm lỗi gốc', async () => {
    const { mod, probe, registry } = await boot();
    probe.fail = new TypeError('boom\nsecond line');
    const job = [...registry.getCronJobs().entries()].find(([k]) => k !== 'probe.named')![1];
    job.fireOnTick();
    await until(() => reports.length > 0);
    expect(reports[0]!.error).toBe(probe.fail);
    await mod.close();
  });

  it('ghi nhận hỏng (sink ném) không làm cron hỏng theo', async () => {
    const probe = new Probe();
    setCronRunSink({
      record: () => {
        throw new Error('db down');
      },
    });
    await expect(probe.named()).resolves.toBe('ok');
  });

  it('không có sink (test đơn vị): chạy như cũ, lỗi vẫn ném ra', async () => {
    const probe = new Probe();
    probe.fail = new Error('x');
    await expect(probe.unnamed()).rejects.toThrow('x');
  });
});

const SRC_ROOT = join(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('mọi @Cron đều kèm @TrackCron()', () => {
  const files = sourceFiles(SRC_ROOT).filter((f) => /^[ \t]*@Cron\(/m.test(readFileSync(f, 'utf8')));

  it('quét được các file có @Cron', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [f.slice(SRC_ROOT.length + 1).split(sep).join('/'), f]))('%s', (_rel, file) => {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/^[ \t]*@Cron\(/.test(line)) return;
      // Decorator có thể trải nhiều dòng: tìm @TrackCron() trong cụm decorator liền sau, trước dòng khai báo phương thức.
      let j = i + 1;
      let found = false;
      while (j < lines.length && /^[ \t]*(@|\}|\)|[a-zA-Z]*:|\/\/)/.test(lines[j] ?? '')) {
        if (/^[ \t]*@TrackCron\(\)/.test(lines[j] ?? '')) found = true;
        j++;
      }
      expect({ line: i + 1, found }).toEqual({ line: i + 1, found: true });
    });
  });
});
