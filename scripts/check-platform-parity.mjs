#!/usr/bin/env node
// Rào chắn hai nền tảng: mọi <Route> của Mini App phải có dòng trong route-map.json,
// và dòng không `pending` thì route web phải có file thật (docs/2026-10-19-web-parity/01-thiet-ke.md mục 4).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_APP_DIR = 'apps/web/src/app';
const MINIAPP_ROUTES_FILE = 'apps/miniapp/src/components/app.tsx';
const ROUTE_MAP_FILE = 'packages/app-core/src/route-map.json';

export function parseMiniAppRoutes(source) {
  const paths = [];
  for (const m of source.matchAll(/<Route\s+path="([^"]*)"/g)) {
    if (m[1] !== '*') paths.push(m[1]);
  }
  return paths;
}

export function webPathToFileCandidates(webPath) {
  const pathname = webPath.split(/[?#]/)[0];
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith(':') ? `[${s.slice(1)}]` : s));
  const dir = [WEB_APP_DIR, ...segments].join('/');
  return ['page.tsx', 'route.ts'].map((f) => `${dir}/${f}`);
}

export function checkParity({ miniappRoutes, map, webFileExists, fileHasSymbol, strict = false }) {
  const errors = [];
  const warnings = [];
  const pending = (msg) => (strict ? errors : warnings).push(msg);

  const seen = new Set();
  for (const group of map.routes) {
    for (const item of group.items) {
      const label = item.miniapp;
      if (seen.has(label)) {
        errors.push(`route Mini App ${label} trùng: có nhiều hơn một dòng`);
        continue;
      }
      seen.add(label);
      if (!miniappRoutes.includes(label)) {
        errors.push(`dòng ${label} thừa: app.tsx không có <Route> này`);
        continue;
      }
      if ('skip' in item) {
        if (typeof item.skip !== 'string' || item.skip.trim() === '') {
          errors.push(`dòng skip ${label} thiếu lý do`);
        }
        continue;
      }
      if (item.pending) {
        pending(`${label} → ${item.web} chưa làm (pending)`);
        continue;
      }
      if (!webFileExists || !webPathToFileCandidates(item.web).some((p) => webFileExists(p))) {
        errors.push(`${label} → ${item.web} không có page.tsx/route.ts, hãy đặt pending hoặc tạo route`);
      }
    }
  }
  for (const route of miniappRoutes) {
    if (!seen.has(route)) errors.push(`route Mini App ${route} không có dòng trong route-map.json`);
  }

  for (const f of map.features) {
    const [miniFile, miniSymbol] = f.miniapp;
    if (!fileHasSymbol(miniFile, miniSymbol)) {
      errors.push(`feature ${f.id}: symbol ${miniSymbol} không còn trong ${miniFile} (Mini App)`);
    }
    if (f.pending) {
      pending(`feature ${f.id} chưa làm trên web (pending)`);
      continue;
    }
    const [webFile, webSymbol] = f.web;
    if (!fileHasSymbol(webFile, webSymbol)) {
      errors.push(`feature ${f.id}: symbol ${webSymbol} không có trong ${webFile} (web), hãy đặt pending hoặc làm`);
    }
  }
  return { errors, warnings };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const abs = (p) => join(root, p);
  const read = (p) => (existsSync(abs(p)) ? readFileSync(abs(p), 'utf8') : '');
  const strict = process.argv.includes('--strict');

  const { errors, warnings } = checkParity({
    miniappRoutes: parseMiniAppRoutes(read(MINIAPP_ROUTES_FILE)),
    map: JSON.parse(read(ROUTE_MAP_FILE)),
    webFileExists: (p) => existsSync(abs(p)),
    fileHasSymbol: (file, symbol) => new RegExp(`\\b${symbol}\\b`).test(read(file)),
    strict,
  });

  for (const w of warnings) console.warn(`cảnh báo: ${w}`);
  for (const e of errors) console.error(`lỗi: ${e}`);
  if (errors.length > 0) {
    console.error(`lint:parity đỏ: ${errors.length} lỗi`);
    process.exit(1);
  }
  console.log(`lint:parity xanh (${warnings.length} mục pending)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
