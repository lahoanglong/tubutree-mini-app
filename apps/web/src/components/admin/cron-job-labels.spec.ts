import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CRON_JOB_LABELS } from './ops-health-tab';

// Tính theo vị trí file (không theo thư mục chạy lệnh) để chạy từ gốc repo hay từ apps/web đều kiểm thật.
const API_SRC = fileURLToPath(new URL('../../../../api/src', import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const CRON_RE = /@Cron\(([\s\S]*?)\)[^\n]*\n\s*@TrackCron\([^)]*\)\s*(?:async\s+)?(\w+)\(/g;

/** Tên việc nền như API ghi vào cron_runs (track-cron.ts): `name` trong @Cron nếu có, không thì `Lớp.hàm`. */
function realCronJobs(): { names: string[]; problems: string[] } {
  const names: string[] = [];
  const problems: string[] = [];
  const files = walk(API_SRC).filter((f) => f.endsWith('.ts') && !f.includes('.spec.') && !f.includes('/common/cron-run/'));
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    const rel = relative(API_SRC, f);
    const tracked = (s.match(/@TrackCron\(/g) ?? []).length;
    let found = 0;
    for (const m of s.matchAll(CRON_RE)) {
      found++;
      const args = m[1]!;
      const literal = /name:\s*(['"`])([^'"`]+)\1/.exec(args);
      if (!literal && /\bname:/.test(args)) {
        problems.push(`${rel}: "name" của @Cron không phải chuỗi trực tiếp, spec chưa tra được hằng`);
        continue;
      }
      const cls = [...s.slice(0, m.index).matchAll(/class (\w+)/g)].pop()![1]!;
      names.push(literal ? literal[2]! : `${cls}.${m[2]}`);
    }
    if (found !== tracked) problems.push(`${rel}: ${tracked} @TrackCron nhưng chỉ đọc được ${found} @Cron`);
  }
  return { names, problems };
}

describe('tên thường của việc nền (Sức khoẻ hệ thống)', () => {
  const { names, problems } = realCronJobs();
  it('đọc được đủ mọi @Cron có @TrackCron trong mã API', () => {
    expect(names.length).toBeGreaterThan(40);
    expect(problems).toEqual([]);
  });
  it('bảng tên khớp từng việc nền thật, không thừa khoá chết', () => {
    expect(names.filter((n) => !CRON_JOB_LABELS[n])).toEqual([]);
    expect(Object.keys(CRON_JOB_LABELS).filter((k) => !names.includes(k))).toEqual([]);
  });
});
