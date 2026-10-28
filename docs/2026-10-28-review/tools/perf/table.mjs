#!/usr/bin/env node
// In bảng markdown từ JSON của run-all.mjs. Có hai file thì thêm cột so sánh (sau - trước).
// Dùng: node table.mjs perf/baseline.json [perf/after-x.json]
import fs from 'node:fs';
const [fa, fb] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(fa, 'utf8'));
const B = fb ? JSON.parse(fs.readFileSync(fb, 'utf8')) : null;
const f = (x, d = 0) => (x == null ? '-' : Number(x).toFixed(d));
const cell = (a, b, d = 0) => (b === undefined ? f(a, d) : `${f(a, d)} → ${f(b, d)}`);
const m = (o, k) => o?.medians?.[k]?.median;
const rows = [];
const out = (s = '') => rows.push(s);

out(`Mã ${A.meta.commit} (${A.meta.branch}), ngày ${A.meta.date.slice(0, 16)}, ${A.meta.runsPerMetric} lần/số đo, trung vị.${B ? ` So với ${B.meta.commit}.` : ''}`);
out('\n### Web, Moto G + 4G chậm + CPU x4 (next start, API lane 5)\n');
out('| Trang | persona | FCP ms | LCP ms | CLS | TBT ms | INP ms | tải JS KB | request | API |');
out('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const [k, v] of Object.entries(A.web ?? {})) {
  const w = B?.web?.[k];
  out(`| ${k} ${v.path} | ${v.persona} | ${['fcp', 'lcp'].map((x) => cell(m(v, x), w && m(w, x))).join(' | ')} | ${cell(m(v, 'cls'), w && m(w, 'cls'), 3)} | ${cell(m(v, 'tbt'), w && m(w, 'tbt'))} | ${cell(m(v, 'inp'), w && m(w, 'inp'))} | ${cell(m(v, 'jsKB'), w && m(w, 'jsKB'))} | ${cell(m(v, 'requests'), w && m(w, 'requests'))} | ${cell(m(v, 'apiRequests'), w && m(w, 'apiRequests'))} |`);
}
out('\n### Web, Lighthouse mobile (khách)\n');
out('| Trang | Điểm | FCP | LCP | TBT | CLS | SI |');
out('|---|---:|---:|---:|---:|---:|---:|');
for (const [k, v] of Object.entries(A.lighthouse ?? {})) {
  const w = B?.lighthouse?.[k];
  out(`| ${k} | ${cell(v.score, w?.score)} | ${cell(v.fcp, w?.fcp)} | ${cell(v.lcp, w?.lcp)} | ${cell(v.tbt, w?.tbt)} | ${cell(v.cls, w?.cls, 3)} | ${cell(v.si, w?.si)} |`);
}
out('\n### Mini App, 375 + 4G chậm + CPU x4 (bản build tĩnh, API lane 5)\n');
out('| Ô | FCP ms | LCP ms | thẻ SP đầu ms | CLS | TBT ms | JS KB | request | API | /auth xong | /home xong |');
out('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const [k, v] of Object.entries(A.mini ?? {})) {
  const w = B?.mini?.[k];
  const c = (x, d = 0) => cell(m(v, x), w && m(w, x), d);
  out(`| ${k} | ${c('fcp')} | ${c('lcp')} | ${c('firstProductCard')} | ${c('cls', 3)} | ${c('tbt')} | ${c('jsKB')} | ${c('requests')} | ${c('apiRequests')} | ${c('authEnd')} | ${c('homeApiEnd')} |`);
}
out('\n### API lane 5, autocannon 10 kết nối (ms; p97,5 là cận trên của p95)\n');
out('| Endpoint | p50 | p90 | p97,5 | p99 | req/s | SQL lần 1 | SQL lần 2 |');
out('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const [k, v] of Object.entries(A.apiLoad ?? {})) {
  const w = B?.apiLoad?.[k];
  const s = A.apiSql?.[k];
  const s2 = B?.apiSql?.[k];
  out(`| ${k} ${v.path} | ${cell(v.p50, w?.p50, 1)} | ${cell(v.p90, w?.p90, 1)} | ${cell(v.p97_5, w?.p97_5, 1)} | ${cell(v.p99, w?.p99, 1)} | ${cell(v.rps, w?.rps)} | ${cell(s?.first?.sql, s2?.first?.sql)} | ${cell(s?.second?.sql, s2?.second?.sql)} |`);
}
console.log(rows.join('\n'));
