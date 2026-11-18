#!/usr/bin/env node
/**
 * In bảng số đo tốc độ trên máy khách (p75 theo route và khung nhìn) giống thẻ "Tốc độ trên máy khách" ở Quản trị > Vận hành.
 *
 *   node scripts/perf/vitals-report.mjs --json tep.json              # tệp lưu từ GET /api/admin/perf/vitals?days=7
 *   VITALS_ADMIN_TOKEN=... node scripts/perf/vitals-report.mjs --api https://api.tubutree.com/api --days 28
 *
 * Chỉ ĐỌC (một lệnh GET, quyền ADMIN). Token đọc từ biến môi trường, không nhận qua tham số dòng lệnh để không lưu vào lịch sử shell.
 * Ngưỡng và cách tính p75 nằm ở API (apps/api/src/modules/analytics/vitals); script này chỉ trình bày lại.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const COLUMNS = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB', 'READY'];
const LABELS = { LCP: 'LCP', INP: 'INP', CLS: 'CLS', FCP: 'FCP', TTFB: 'TTFB', READY: 'Mở tới bấm được' };
const VIEWPORTS = { s: 'Điện thoại', m: 'Máy tính bảng', l: 'Máy tính' };
const RATING = { good: 'tốt', 'needs-improvement': 'cần cải thiện', poor: 'kém' };

export function parseArgs(argv) {
  const out = { json: '', api: '', days: 7 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = argv[++i] ?? '';
    else if (argv[i] === '--api') out.api = argv[++i] ?? '';
    else if (argv[i] === '--days') out.days = Number(argv[++i]) === 28 ? 28 : 7;
  }
  return out;
}

const nf = (digits) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
/** Như `formatVital` của web: CLS 2 số lẻ; dưới 1 giây ghi mili giây, từ 1 giây ghi giây 1 số lẻ. */
export function formatVital(name, value) {
  if (name === 'CLS') return nf(2).format(value);
  return value < 1000 ? `${Math.round(value)} ms` : `${nf(1).format(value / 1000)} s`;
}

/** Cùng thứ tự với `pivotClientVitals` của web: web trước Mini App, dòng gộp `*` trước, rồi route nhiều mẫu hơn. */
export function pivot(rows) {
  const lines = new Map();
  for (const r of rows) {
    const key = `${r.platform}|${r.route}|${r.viewport}`;
    const line = lines.get(key) ?? { platform: r.platform, route: r.route, viewport: r.viewport, samples: 0, cells: {} };
    line.cells[r.name] = r;
    line.samples = Math.max(line.samples, r.samples);
    lines.set(key, line);
  }
  const rank = (l) => [l.platform === 'web' ? 0 : 1, l.route === '*' ? 0 : 1];
  return [...lines.values()].sort((a, b) => {
    const [pa, ra] = rank(a);
    const [pb, rb] = rank(b);
    return pa - pb || ra - rb || b.samples - a.samples || a.route.localeCompare(b.route) || a.viewport.localeCompare(b.viewport);
  });
}

export function render(summary) {
  const out = [`Số đo trên máy khách, ${summary.days} ngày từ ${summary.since} (p75; dưới ${summary.minSamples} mẫu ghi "chưa đủ mẫu")`, ''];
  const lines = pivot(summary.rows ?? []);
  if (lines.length === 0) {
    out.push(`Chưa có số đo trong ${summary.days} ngày qua. Số đo chỉ được gửi khi cờ perf.rum_enabled đang bật.`);
    return out.join('\n');
  }
  out.push(`| Nền tảng | Route | Khung nhìn | Mẫu | ${COLUMNS.map((c) => LABELS[c]).join(' | ')} |`);
  out.push(`|---|---|---|---:|${COLUMNS.map(() => '---').join('|')}|`);
  for (const l of lines) {
    const cells = COLUMNS.map((c) => {
      const r = l.cells[c];
      if (!r) return '—';
      return `${formatVital(c, r.p75)} ${RATING[r.rating] ?? r.rating}${r.enoughSamples ? '' : ' (chưa đủ mẫu)'}`;
    });
    out.push(`| ${l.platform === 'web' ? 'Web' : 'Mini App'} | ${l.route === '*' ? 'Mọi route' : l.route} | ${VIEWPORTS[l.viewport] ?? l.viewport} | ${l.samples} | ${cells.join(' | ')} |`);
  }
  return out.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let summary;
  if (args.json) {
    summary = JSON.parse(readFileSync(args.json, 'utf8'));
  } else if (args.api) {
    const token = process.env.VITALS_ADMIN_TOKEN;
    if (!token) throw new Error('Đặt VITALS_ADMIN_TOKEN (token phiên ADMIN) trong biến môi trường.');
    const res = await fetch(`${args.api.replace(/\/$/, '')}/admin/perf/vitals?days=${args.days}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET /admin/perf/vitals trả HTTP ${res.status}`);
    summary = await res.json();
  } else {
    console.error('Dùng: node scripts/perf/vitals-report.mjs --json tep.json | --api https://.../api [--days 7|28] (token ở VITALS_ADMIN_TOKEN)');
    process.exit(2);
  }
  console.log(render(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
