#!/usr/bin/env node
// Khói PROD chỉ đọc trước khi gửi duyệt Zalo (tubu-w36-02). CHỈ gửi GET, không đăng nhập, không tạo hay sửa gì; chỉ chạy khi PO đồng ý.
//   node scripts/smoke/pre-submit-prod.mjs --web https://<web PROD> [--api https://<gốc API, mặc định = --web>] [--expect orderZaloEnabled=true ...]
// Kiểm:
//   GET <api>/api/health            200
//   GET <api>/api/config/public     200, JSON có ba cờ boolean orderZaloEnabled, orderZaloPrechecked, orderZaloGuest (in giá trị; --expect so giá trị)
//   GET <web>/                      200, HTML chưa nén ≤ 215.000 B (cùng trần scripts/ci/web-budget.json)
//   GET <web>/thanh-toan, <web>/don có phản hồi (mã < 500; không theo chuyển hướng)
// Thoát 0 khi mọi mục đạt, 1 khi có mục không đạt, 2 khi sai đối số. Không có giá trị mặc định cho --web để không lỡ gọi PROD.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const HTML_MAX = 215_000;
const TIMEOUT_MS = 15_000;
const FLAGS = ['orderZaloEnabled', 'orderZaloPrechecked', 'orderZaloGuest'];

export function parseArgs(argv) {
  const out = { web: '', api: '', expect: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--web') out.web = argv[++i] ?? '';
    else if (a === '--api') out.api = argv[++i] ?? '';
    else if (a === '--expect') {
      const [k, v] = String(argv[++i] ?? '').split('=');
      if (!FLAGS.includes(k) || (v !== 'true' && v !== 'false')) throw new Error(`--expect cần dạng <${FLAGS.join('|')}>=true|false, nhận "${k}=${v}"`);
      out.expect[k] = v === 'true';
    } else throw new Error(`đối số không biết: ${a}`);
  }
  if (!/^https?:\/\//.test(out.web)) throw new Error('thiếu --web <url gốc web>');
  out.api ||= out.web;
  if (!/^https?:\/\//.test(out.api)) throw new Error('--api phải là url http(s)');
  out.web = out.web.replace(/\/+$/, '');
  out.api = out.api.replace(/\/+$/, '');
  return out;
}

/** Lời gọi duy nhất ra mạng của script: luôn GET, không theo chuyển hướng, không gửi thân hay cookie. */
export async function get(url, accept) {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { accept, 'accept-encoding': 'identity', 'user-agent': 'tubu-pre-submit-smoke/1 (read-only)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes: body.length, text: body.toString('utf8') };
}

export async function runSmoke(opts, fetchGet = get) {
  const results = [];
  const check = async (name, fn) => {
    try {
      const { ok, detail } = await fn();
      results.push({ name, ok, detail });
    } catch (e) {
      results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };
  await check('GET /api/health', async () => {
    const r = await fetchGet(`${opts.api}/api/health`, 'application/json');
    return { ok: r.status === 200, detail: `HTTP ${r.status}` };
  });
  await check('GET /api/config/public', async () => {
    const r = await fetchGet(`${opts.api}/api/config/public`, 'application/json');
    if (r.status !== 200) return { ok: false, detail: `HTTP ${r.status}` };
    const cfg = JSON.parse(r.text);
    const parts = [];
    let ok = true;
    for (const k of FLAGS) {
      const v = cfg?.[k];
      if (typeof v !== 'boolean') ok = false;
      if (k in opts.expect && v !== opts.expect[k]) ok = false;
      parts.push(`${k}=${JSON.stringify(v)}${k in opts.expect ? ` (chờ ${opts.expect[k]})` : ''}`);
    }
    return { ok, detail: parts.join(', ') };
  });
  await check('GET /', async () => {
    const r = await fetchGet(`${opts.web}/`, 'text/html');
    return { ok: r.status === 200 && r.bytes <= HTML_MAX, detail: `HTTP ${r.status}, ${r.bytes} B chưa nén (trần ${HTML_MAX} B)` };
  });
  for (const p of ['/thanh-toan', '/don']) {
    await check(`GET ${p}`, async () => {
      const r = await fetchGet(`${opts.web}${p}`, 'text/html');
      return { ok: r.status < 500, detail: `HTTP ${r.status}` };
    });
  }
  return results;
}

// So đường thật: gọi qua symlink hay đường có dấu cách mà so chuỗi thô thì khối dưới không chạy và script thoát 0 không kiểm gì.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  const results = await runSmoke(opts);
  for (const r of results) console.log(`${r.ok ? 'ĐẠT      ' : 'KHÔNG ĐẠT'}  ${r.name}: ${r.detail}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad === 0 ? `khói PROD chỉ đọc xanh: ${results.length}/${results.length} mục` : `khói PROD chỉ đọc: ${bad}/${results.length} mục không đạt`);
  process.exit(bad === 0 ? 0 : 1);
}
