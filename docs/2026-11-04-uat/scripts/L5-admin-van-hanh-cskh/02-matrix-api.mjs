// Ma trận vai trò x route (API lane 5). Nguồn luật: bảng EXPECTED trong apps/api/src/common/staff-permissions.matrix.spec.ts
// (bảng duyệt ADMINOPS-10/D1-05, đọc từ chính file nguồn lúc chạy). Mỗi persona gọi THẲNG từng route:
//  - route không được phép: phải 403 (ẩn danh: 401), gọi mọi method với id giả, nên dù lọt cũng chỉ 404/400.
//  - route được phép: GET thì phải KHÁC 403/401; method ghi chỉ gọi khi đường dẫn có tham số id giả và không thuộc /staff/ hay /loyalty/staff/ (không ghi gì thật).
import fs from 'node:fs';
import { L, check, rec, save, short, tok, ENV } from './_lib.mjs';

const SPEC = '/Users/longla/coding/tubutree-mini-app/.claude/worktrees/uat-1104/apps/api/src/common/staff-permissions.matrix.spec.ts';
const src = fs.readFileSync(SPEC, 'utf8');
const block = src.slice(src.indexOf('const EXPECTED'), src.indexOf('\n};', src.indexOf('const EXPECTED')));
const EXPECTED = {};
for (const m of block.matchAll(/^\s*'([A-Z]+ [^']+)':\s*(STAFF|ADMIN_ONLY|\[[^\]]*\]),/gm)) {
  const v = m[2];
  EXPECTED[m[1]] = v === 'STAFF' ? 'STAFF' : v === 'ADMIN_ONLY' ? [] : v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
}
const KEYS = Object.keys(EXPECTED);
console.log(`đọc ${KEYS.length} route từ bảng duyệt`);

const PERSONAS = [
  { alias: null, name: 'anonymous', role: 'NONE', perms: [] },
  { alias: 'returning', name: 'returning', role: 'CUSTOMER', perms: [] },
  { alias: 'ctv', name: 'ctv', role: 'AFFILIATE', perms: [] },
  { alias: 'dealer', name: 'dealer', role: 'DEALER', perms: [] },
  { alias: 'staff', name: 'staff', role: 'STAFF', perms: [] },
  { alias: 'kho', name: 'kho', role: 'STAFF', perms: ['KHO'] },
  { alias: 'ketoan', name: 'ketoan', role: 'STAFF', perms: ['KE_TOAN'] },
  { alias: 'marketing', name: 'marketing', role: 'STAFF', perms: ['MARKETING'] },
  { alias: 'cskh', name: 'cskh', role: 'STAFF', perms: ['CSKH'] },
  { alias: 'admin', name: 'admin', role: 'ADMIN', perms: [] },
];

// Bốn route @Roles('AFFILIATE','DEALER','STAFF','ADMIN') (academy.controller.ts:7, content-kit.controller.ts:7): bảng duyệt gộp chúng vào "STAFF" nhưng CTV/đại lý cũng được phép.
const AFF_DEALER_OK = new Set(['GET /academy/courses', 'GET /academy/courses/:id', 'POST /academy/lessons/:id/complete', 'GET /affiliate/content-kit/:slug']);
function allowedFor(exp, p, key) {
  if (p.role === 'ADMIN') return true;
  if ((p.role === 'AFFILIATE' || p.role === 'DEALER') && AFF_DEALER_OK.has(key)) return true;
  if (p.role !== 'STAFF') return false;
  if (exp === 'STAFF') return true; // @Roles có STAFF
  return exp.some((g) => p.perms.includes(g));
}

const fill = (p) => p.replace(/:[A-Za-z]+/g, 'uat-none-id');
const matrix = {}; // persona -> {deniedOk, deniedBad:[], allowedOk, allowedBad:[], skipped}
for (const p of PERSONAS) matrix[p.name] = { deniedOk: 0, deniedBad: [], allowedOk: 0, allowedBad: [], skipped: 0 };

for (const p of PERSONAS) {
  const token = p.alias ? await tok(p.alias) : undefined;
  for (const key of KEYS) {
    const [method, path] = key.split(' ');
    const allow = allowedFor(EXPECTED[key], p, key);
    const url = fill(path);
    const hasParam = /:/.test(path);
    const safeWrite = method === 'GET' || (hasParam && !/^\/(staff|loyalty\/staff)\//.test(path));
    if (allow && !safeWrite) { matrix[p.name].skipped++; continue; }
    // Admin gọi route lớn của ADMIN_ONLY mà không có id (đặc biệt POST) đã bị loại ở trên; GET của admin thì an toàn.
    if (allow && p.role === 'ADMIN' && method !== 'GET' && !hasParam) { matrix[p.name].skipped++; continue; }
    const res = await fetch(`${L.apiUrl127}${url}`, {
      method,
      headers: {
        'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(method === 'GET' || method === 'DELETE' ? {} : { 'content-type': 'application/json' }),
      },
      body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
    });
    const status = res.status;
    await res.arrayBuffer();
    const m = matrix[p.name];
    if (allow) {
      if (status === 403 || status === 401) m.allowedBad.push(`${key} -> ${status}`);
      else m.allowedOk++;
    } else {
      const want = p.role === 'NONE' ? 401 : 403;
      if (status === want) m.deniedOk++;
      else m.deniedBad.push(`${key} -> ${status}`);
    }
  }
}

for (const p of PERSONAS) {
  const m = matrix[p.name];
  const evid = { deniedOk: m.deniedOk, allowedOk: m.allowedOk, skippedWrites: m.skipped, deniedBad: m.deniedBad.slice(0, 12), allowedBad: m.allowedBad.slice(0, 12) };
  check(`L5-MX-deny-${p.name}`, p.name, 'api', 'Ma trận vai trò x API', `gọi thẳng ${m.deniedOk + m.deniedBad.length} route không được phép`, p.role === 'NONE' ? 'mọi route admin 401' : 'mọi route không được phép 403',
    m.deniedBad.length === 0, `${m.deniedOk} đúng, ${m.deniedBad.length} sai`, evid);
  if (p.role !== 'NONE' && p.role !== 'CUSTOMER') {
    check(`L5-MX-allow-${p.name}`, p.name, 'api', 'Ma trận vai trò x API', `gọi route được phép (GET + ghi với id giả): ${m.allowedOk + m.allowedBad.length}`, 'không 403/401',
      m.allowedBad.length === 0, `${m.allowedOk} đúng, ${m.allowedBad.length} sai, ${m.skipped} route ghi bỏ qua`, evid);
  }
}

// Bảng markdown vai trò x route (gom theo nhóm) để dán vào báo cáo.
const groups = new Map();
for (const key of KEYS) {
  const [, path] = key.split(' ');
  const seg = path.split('/').filter(Boolean);
  const g = seg[0] === 'admin' ? `/admin/${seg[1]}` : `/${seg[0]}/${seg[1] ?? ''}`.replace(/\/$/, '');
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(key);
}
const lines = ['| Nhóm route | số route | Ai được phép (theo bảng duyệt) |', '|---|---|---|'];
for (const [g, ks] of [...groups.entries()].sort()) {
  const who = new Set(ks.map((k) => (EXPECTED[k] === 'STAFF' ? 'mọi STAFF' : EXPECTED[k].length ? EXPECTED[k].join('/') : 'chỉ ADMIN')));
  lines.push(`| \`${g}\` | ${ks.length} | ${[...who].join('; ')} |`);
}
fs.writeFileSync(new URL('./results/02-matrix-groups.md', import.meta.url), lines.join('\n') + '\n');
fs.writeFileSync(new URL('./results/02-matrix-summary.json', import.meta.url), JSON.stringify(Object.fromEntries(Object.entries(matrix).map(([k, v]) => [k, { deniedOk: v.deniedOk, deniedBad: v.deniedBad, allowedOk: v.allowedOk, allowedBad: v.allowedBad, skipped: v.skipped }])), null, 2));
save('02-matrix-api');
