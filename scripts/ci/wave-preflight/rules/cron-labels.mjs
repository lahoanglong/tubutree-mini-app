// Luật 3: mọi việc nền @Cron có @TrackCron trong apps/api/src có tên tiếng Việt trong CRON_JOB_LABELS (trang Sức khoẻ hệ thống), và bảng không
// còn khoá chết. Cùng cách đọc với apps/web/src/components/admin/cron-job-labels.spec.ts (tên = `name` của @Cron nếu có, không thì `Lớp.hàm`),
// nhưng không cần chạy vitest của web.
import { quotedStrings, sliceBlock } from '../lib.mjs';

export const id = 'cron-labels';
export const title = 'Mỗi @Cron có nhãn tiếng Việt trong CRON_JOB_LABELS (ops-health-tab.tsx)';

export const API_SRC = 'apps/api/src';
export const LABELS_FILE = 'apps/web/src/components/admin/ops-health-tab.tsx';
export const LABELS_SPEC = 'apps/web/src/components/admin/cron-job-labels.spec.ts';

const CRON_RE = /@Cron\(([\s\S]*?)\)[^\n]*\n\s*@TrackCron\([^)]*\)\s*(?:async\s+)?(\w+)\(/g;

/** Tên việc nền như API ghi vào cron_runs, và các chỗ luật không đọc được (để không lặng lẽ bỏ sót). */
export function cronJobs(files) {
  const jobs = [];
  const problems = [];
  for (const [rel, s] of files) {
    if (s == null || !s.includes('@TrackCron(')) continue;
    const tracked = (s.match(/@TrackCron\(/g) ?? []).length;
    let found = 0;
    for (const m of s.matchAll(CRON_RE)) {
      found++;
      const args = m[1];
      const literal = /name:\s*(['"`])([^'"`]+)\1/.exec(args);
      if (!literal && /\bname:/.test(args)) {
        problems.push(`${rel}: "name" của @Cron không phải chuỗi trực tiếp, luật không tra được hằng`);
        continue;
      }
      const cls = [...s.slice(0, m.index).matchAll(/class (\w+)/g)].pop()?.[1] ?? '?';
      jobs.push({ name: literal ? literal[2] : `${cls}.${m[2]}`, file: rel });
    }
    if (found !== tracked) problems.push(`${rel}: ${tracked} @TrackCron nhưng chỉ đọc được ${found} @Cron (đặt @TrackCron ngay dưới @Cron)`);
  }
  return { jobs, problems };
}

/** Khoá → nhãn của CRON_JOB_LABELS. */
export function parseLabels(text) {
  const block = sliceBlock(text, 'export const CRON_JOB_LABELS', '\n};');
  if (!block) return null;
  const body = block.slice(block.indexOf('{') + 1);
  const out = new Map();
  for (const m of body.matchAll(/(['"])([^'"]+)\1\s*:\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g)) out.set(m[2], m[4]);
  return out;
}

export function check(ctx) {
  const res = { errors: [], warnings: [], notes: [] };
  const labelsText = ctx.head.read(LABELS_FILE);
  const labels = labelsText == null ? null : parseLabels(labelsText);
  if (!labels) {
    res.errors.push(`không đọc được CRON_JOB_LABELS trong ${LABELS_FILE}`);
    return res;
  }
  const markerBlock = sliceBlock(ctx.head.read(LABELS_SPEC) ?? '', 'const MARKER_JOBS', '];');
  const markers = new Set(markerBlock ? quotedStrings(markerBlock) : []);

  const sources = ctx.head.list(API_SRC).filter((f) => f.endsWith('.ts') && !f.includes('.spec.') && !f.includes('/common/cron-run/'));
  const { jobs, problems } = cronJobs(sources.map((f) => [f, ctx.head.read(f)]));
  res.errors.push(...problems);
  const names = new Set(jobs.map((j) => j.name));
  for (const j of jobs) {
    const label = labels.get(j.name);
    if (label === undefined) res.errors.push(`việc nền ${j.name} (${j.file}) chưa có nhãn trong CRON_JOB_LABELS của ${LABELS_FILE}: thêm \`'${j.name}': '<việc này làm gì, giờ chạy>'\``);
    else if (!label.trim() || label === j.name || !/[^\u0000-\u007f]/.test(label)) res.errors.push(`nhãn của ${j.name} trong CRON_JOB_LABELS phải là câu tiếng Việt có dấu, đang là "${label}"`);
  }
  for (const key of labels.keys()) {
    if (!names.has(key) && !markers.has(key)) res.errors.push(`CRON_JOB_LABELS còn khoá chết ${key}: không còn @Cron nào mang tên này (xoá dòng, hoặc thêm vào MARKER_JOBS của ${LABELS_SPEC} nếu mã tự ghi mốc)`);
  }
  res.notes.push(`${jobs.length} việc nền, ${labels.size} nhãn`);
  return res;
}
