import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CRON_JOB_LABELS } from './ops-health-tab';

const API_SRC = join(process.cwd(), '../api/src');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Tên việc nền như API ghi vào cron_runs (track-cron.ts): `name` trong @Cron nếu có, không thì `Lớp.hàm`. */
function realCronJobNames(): string[] {
  const out: string[] = [];
  for (const f of walk(API_SRC).filter((x) => x.endsWith('.ts') && !x.includes('.spec.'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/@Cron\(([^\n]*)\)[^\n]*\n\s*@TrackCron\([^\n]*\)\s*\n\s*(?:async\s+)?(\w+)\(/g)) {
      const cls = [...s.slice(0, m.index).matchAll(/class (\w+)/g)].pop()![1]!;
      out.push(/name:\s*'([^']+)'/.exec(m[1]!)?.[1] ?? `${cls}.${m[2]}`);
    }
  }
  return out;
}

describe.skipIf(!existsSync(API_SRC))('tên thường của việc nền (Sức khoẻ hệ thống)', () => {
  const real = realCronJobNames();
  it('bảng tên khớp từng việc nền thật trong mã API, không thừa khoá chết', () => {
    expect(real.length).toBeGreaterThan(40);
    expect(real.filter((n) => !CRON_JOB_LABELS[n])).toEqual([]);
    expect(Object.keys(CRON_JOB_LABELS).filter((k) => !real.includes(k))).toEqual([]);
  });
});
