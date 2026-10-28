// Dùng chung cho các phép đo hiệu năng (đợt review 2026-10-28). Chỉ cổng 3600-3619 và lane 5 (API 3251).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const R = path.resolve(HERE, '../..');
export const WT = path.resolve(R, '../..');
export const H = path.join(WT, 'docs/2026-10-20-uat/tools/uat-harness');
export const LANE_N = 5;
export const PORTS = { web: 3601, mini: 3603, apiSql: 3611 };
export const MINI_WWW = path.join(H, 'state/perf-mini-www');
export const WEB_URL = `http://localhost:${PORTS.web}`;
export const MINI_URL = `http://localhost:${PORTS.mini}`;
export const API = 'http://localhost:3251/api';
export const NODE_BIN = process.execPath;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const median = (xs) => {
  const a = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
export const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function laneEnvVal(key, n = LANE_N) {
  const t = fs.readFileSync(path.join(H, `state/lane-${n}/lane.env`), 'utf8');
  const m = t.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1] : '';
}

/** Dòng đầu của `top -l 1 -n 0` (load) để ghi cạnh số đo. */
export function loadSnapshot() {
  try {
    const out = execFileSync('top', ['-l', '1', '-n', '0'], { encoding: 'utf8' });
    const g = (re) => (out.match(re) || [])[0] || '';
    return { loadAvg: g(/Load Avg:[^\n]*/), cpu: g(/CPU usage:[^\n]*/) };
  } catch {
    return { loadAvg: 'n/a', cpu: 'n/a' };
  }
}

export async function portUp(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    return r.status > 0;
  } catch {
    return false;
  }
}

export function killPort(port) {
  try {
    const pids = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split(/\s+/).filter(Boolean);
    for (const p of pids) process.kill(Number(p), 'SIGTERM');
  } catch {
    /* không có tiến trình nghe cổng */
  }
}

/** Bật một tiến trình nền chỉ khi cổng chưa có ai nghe; trả hàm dừng (chỉ kill cổng do mình bật). */
export async function ensureServer(name, port, cmd, args, opts) {
  if (await portUp(port)) return { started: false, stop: () => {} };
  const child = spawn(cmd, args, { ...opts, stdio: 'ignore', detached: true });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await portUp(port)) return { started: true, stop: () => killPort(port) };
  }
  killPort(port);
  throw new Error(`${name} không lên trên cổng ${port}`);
}

export function playwright() {
  return makeRequire(path.join(WT, 'apps/e2e/package.json'))('@playwright/test');
}
import { createRequire as makeRequire } from 'node:module';

export function lib() {
  return import(path.join(H, 'lib.mjs'));
}

export const MOTO_G4 = {
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 11; Moto G Power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
};
export const MINI_375 = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: MOTO_G4.userAgent };

/** Slow 4G kiểu Lighthouse: 1,6 Mbps xuống, 750 Kbps lên, RTT 150 ms; CPU x4. */
export async function throttle(page, { cpu = 4 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  return cdp;
}

/** Quan sát web-vitals trong trang (cài trước khi tải): FCP, LCP, CLS (cửa sổ phiên lớn nhất), long task, INP thô. */
export const VITALS_INIT = `(() => {
  const v = (window.__perf = { lcp: null, fcp: null, cls: 0, clsSession: 0, longTasks: [], events: [], firstMatch: null, resources: [] });
  const po = (type, cb, extra) => { try { new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type, buffered: true, ...extra }); } catch (e) {} };
  po('paint', (e) => { if (e.name === 'first-contentful-paint') v.fcp = e.startTime; });
  po('largest-contentful-paint', (e) => { v.lcp = e.startTime; v.lcpEl = (e.element && (e.element.tagName + '.' + String(e.element.className).slice(0, 60))) || e.url || ''; v.lcpSize = e.size; });
  let win = { v: 0, first: 0, last: 0 };
  po('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    if (win.v && e.startTime - win.last < 1000 && e.startTime - win.first < 5000) { win.v += e.value; win.last = e.startTime; }
    else win = { v: e.value, first: e.startTime, last: e.startTime };
    v.cls += e.value; v.clsSession = Math.max(v.clsSession, win.v);
  });
  po('longtask', (e) => v.longTasks.push([e.startTime, e.duration]));
  po('event', (e) => { if (e.interactionId) v.events.push([e.name, e.startTime, e.duration, e.processingStart - e.startTime, (e.processingEnd - e.processingStart), e.interactionId]); }, { durationThreshold: 16 });
})();`;

/** TBT: tổng (thời lượng - 50 ms) của long task nằm sau FCP, cắt ở mốc `until` (ms). */
export function tbt(longTasks, fcp, until) {
  if (fcp == null) return null;
  let s = 0;
  for (const [st, d] of longTasks) {
    if (st + d < fcp || st > until) continue;
    s += Math.max(0, d - 50);
  }
  return s;
}

export function summarize(runs) {
  const keys = new Set(runs.flatMap((r) => Object.keys(r)));
  const out = {};
  for (const k of keys) {
    const vals = runs.map((r) => r[k]).filter((x) => typeof x === 'number');
    if (vals.length) out[k] = { median: round(median(vals), 3), runs: vals.map((x) => round(x, 3)) };
  }
  return out;
}
