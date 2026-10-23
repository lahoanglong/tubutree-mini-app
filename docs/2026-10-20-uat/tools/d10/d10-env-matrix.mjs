// Dựng bảng đối chiếu biến môi trường (nhánh D10). Chỉ đọc file, không ghi gì ngoài stdout.
// Dùng: node d10-env-matrix.mjs <gốc worktree>
import fs from 'node:fs'; import path from 'node:path';
const root = process.argv[2];
const R = (p) => path.join(root, p);
const read = (p) => (fs.existsSync(R(p)) ? fs.readFileSync(R(p), 'utf8') : '');
const lines = (p) => read(p).split('\n');

const files = {
  exApi: 'apps/api/.env.example', exProd: '.env.production.example', exWeb: 'apps/web/.env.example',
  cProd: 'docker-compose.prod.yml', cViet: 'docker-compose.vietnix.yml', keys: 'docs/GO-LIVE-KEYS.md', rb: 'docs/launch/deploy-rollback-runbook.md',
};

function inExample(v, p) {
  for (const l of lines(p)) {
    if (new RegExp(`^\\s*${v}=`).test(l)) return 'có';
    if (new RegExp(`^\\s*#\\s*${v}=`).test(l)) return 'có (cmt)';
  }
  return '-';
}
function inCompose(v, p) {
  const out = new Set();
  for (const l of lines(p)) {
    if (l.trim().startsWith('#')) continue;
    if (new RegExp(`^\\s+${v}:`).test(l)) out.add(/NEXT_PUBLIC_/.test(v) ? 'build-arg' : 'ghi đè');
    else if (new RegExp(`^\\s+NEXT_PUBLIC_[A-Z_]+:.*\\$\\{${v}[:}]`).test(l)) out.add('build-arg');
    else if (new RegExp(`\\$\\{${v}[:}?-]`).test(l)) out.add('nội suy');
  }
  return out.size ? [...out].join('+') : '-';
}
const rbLines = lines(files.rb);
function rbSections(v) {
  let sec = ''; const hit = new Set();
  rbLines.forEach((l) => {
    const h = /^#{2,4}\s+(Bước\s+)?([0-9][0-9a-z.]*)/.exec(l); if (h) sec = (h[1] ? 'B' : '') + h[2].replace(/\.$/, '');
    if (new RegExp(`\\b${v}\\b`).test(l)) hit.add(sec === '1.3' ? (l.startsWith('| `') ? '1.3' : '1.3-chữ') : sec || '0');
  });
  return [...hit];
}
function inKeys(v) { return new RegExp(`\\b${v}\\b`).test(read(files.keys)) ? 'có' : '-'; }

// Dòng định nghĩa trong env.validation.ts
const ev = lines('apps/api/src/config/env.validation.ts');
const defLine = (v) => { const i = ev.findIndex((l) => new RegExp(`^\\s{2}${v}:`).test(l)); return i >= 0 ? i + 1 : null; };

// Nơi đọc lúc chạy (bỏ spec, fixture, go-live, env.validation)
function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next', 'coverage'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc); else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && !/\.(spec|test)\./.test(e.name)) acc.push(p);
  }
  return acc;
}
const apiFiles = [...walk(R('apps/api/src')), ...walk(R('apps/api/prisma')), ...walk(R('apps/api/scripts'))]
  .filter((p) => !/env\.validation\.ts$|go-live\.fixtures\.ts$/.test(p));
const apiText = new Map(apiFiles.map((p) => [p, fs.readFileSync(p, 'utf8').split('\n')]));
function readers(v) {
  const runtime = [], golive = [];
  for (const [p, ls] of apiText) {
    ls.forEach((l, i) => {
      if (!new RegExp(`['"\`.]${v}\\b|\\b${v}['"\`]`).test(l) && !new RegExp(`\\b${v}\\b`).test(l)) return;
      if (l.trim().startsWith('//') || l.trim().startsWith('*')) return;
      const rel = path.relative(root, p) + ':' + (i + 1);
      (/config\/go-live\//.test(p) ? golive : runtime).push(rel);
    });
  }
  return { runtime, golive };
}

const prodRequired = {
  DATABASE_URL: 'BẮT BUỘC (mọi môi trường)', JWT_ACCESS_SECRET: 'BẮT BUỘC (mọi môi trường, ≥16 ký tự)', JWT_REFRESH_SECRET: 'BẮT BUỘC (≥16 ký tự) nhưng mã không dùng',
  PANCAKE_API_KEY: 'BẮT BUỘC ở prod', PANCAKE_SHOP_ID: 'BẮT BUỘC ở prod', PANCAKE_WEBHOOK_SECRET: 'BẮT BUỘC ở prod',
  ACCESSTRADE_WEBHOOK_SECRET: 'BẮT BUỘC ở prod', CORS_ORIGINS: 'BẮT BUỘC ở prod (CSV, ≥1 origin)',
  GOMDON_WEBHOOK_SECRET: 'bắt buộc nếu đã đặt GOMDON_PHONE+PASSWORD', GOMDON_PHONE: 'tuỳ chọn (đi cặp PASSWORD)', GOMDON_PASSWORD: 'tuỳ chọn (đi cặp PHONE)',
  OPS_ALERT_EMAIL_TO: 'nhóm email: TO+HOST+(FROM|USER là email) hoặc để trống cả bảy', SMTP_HOST: 'nhóm email', SMTP_PORT: 'nhóm email (trống = 587/465)', SMTP_SECURE: 'nhóm email (true/false/...)',
  SMTP_USER: 'nhóm email (đi cặp PASS)', SMTP_PASS: 'nhóm email (đi cặp USER)', SMTP_FROM: 'nhóm email (hoặc USER là email)',
  THROTTLE_BYPASS_TOKEN: 'tuỳ chọn; đặt thì ≥32 ký tự', OPS_ALERT_WEBHOOK_URL: 'tuỳ chọn; đặt thì phải là URL', OPS_ALERT_ENV_LABEL: 'tuỳ chọn; ≤24 ký tự, không [ ]',
  REDIS_URL: 'có mặc định localhost; compose ghi đè', PORT: 'mặc định 3001; compose ghi đè', NODE_ENV: 'mặc định development; compose ghi đè production',
};

const schemaKeys = [...read('apps/api/src/config/env.validation.ts').matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*z/gm)].map((m) => m[1]);
const extraApi = ['ALLOW_PROD_SEED', 'SEED_ADMIN_PHONES', 'ADMIN_PHONE', 'DEV_ROLE', 'BACKUP_DIR', 'BACKUP_RCLONE_MOCK_PLACEHOLDER', 'RCLONE_REMOTE', 'BACKUP_RCLONE_REMOTE', 'GO_LIVE_REPO_ROOT', 'GO_LIVE_ACCEPT_DEMO_COUPONS', 'VITE_CLOUDINARY_CLOUD_NAME', 'VITE_CLOUDINARY_UPLOAD_PRESET'].filter((x) => !x.includes('MOCK'));

function row(v, schema) {
  const rd = readers(v);
  const code = v === 'DATABASE_URL' ? 'apps/api/prisma/schema.prisma:12 (Prisma đọc env) ; apps/api/src/config/demo-data/cleanup.ts:41' : schema
    ? (rd.runtime.length ? rd.runtime.slice(0, 2).join(' ; ') : `chỉ validate ở env.validation.ts:${defLine(v)}` + (rd.golive.length ? ` + go-live ${rd.golive[0]}` : ''))
    : (rd.runtime.slice(0, 2).concat(rd.golive.slice(0, 1)).join(' ; ') || '?');
  const sec = rbSections(v);
  const in13 = sec.includes('1.3') ? 'bảng' : sec.includes('1.3-chữ') ? 'chỉ chữ' : '-';
  const other = sec.filter((s) => !s.startsWith('1.3')).slice(0, 4).join(',') || '-';
  return `| \`${v}\` | ${code} | ${inExample(v, files.exApi)} | ${inExample(v, files.exProd)} | ${inCompose(v, files.cProd)} | ${inCompose(v, files.cViet)} | ${inKeys(v)} | ${in13} | ${other} | ${prodRequired[v] ?? (schema ? 'tuỳ chọn (có mặc định)' : 'ngoài schema')} |`;
}
const head = '| Biến | Code đọc ở path:line | api/.env.example | .env.production.example | compose.prod | compose.vietnix | GO-LIVE-KEYS | runbook 1.3 | runbook mục khác | Bắt buộc ở prod? |\n|---|---|---|---|---|---|---|---|---|---|';
console.log('## API: biến trong env.validation.ts (' + schemaKeys.length + ')\n'); console.log(head);
for (const v of schemaKeys) console.log(row(v, true));
console.log('\n## API: biến đọc ngoài env.validation.ts (script, seed, go-live)\n'); console.log(head);
for (const v of extraApi) console.log(row(v, false));

// ---- Web, Mini App, biến chỉ compose/Docker ----
const dockerWeb = read('apps/web/Dockerfile');
function webReaders(v, dirs) {
  const hits = [];
  const walk2 = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', 'dist', '.next', 'www'].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk2(p); else if (/\.(ts|tsx|js|mjs|mts)$/.test(e.name) && !/\.(spec|test)\./.test(e.name)) { fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (!l.trim().startsWith('//') && !l.trim().startsWith('*') && new RegExp(`\\b${v}\\b`).test(l)) hits.push(path.relative(root, p) + ':' + (i + 1)); }); } } };
  for (const d of dirs) { if (fs.statSync(R(d)).isDirectory()) walk2(R(d)); else fs.readFileSync(R(d), 'utf8').split('\n').forEach((l, i) => { if (!l.trim().startsWith('//') && !l.trim().startsWith('*') && new RegExp(`\\b${v}\\b`).test(l)) hits.push(d + ':' + (i + 1)); }); }
  return hits.slice(0, 2).join(' ; ') || '-';
}
const vh = '| Biến | Code đọc ở path:line | Ví dụ web/.env.example | .env.production.example | Dockerfile web | compose.prod | compose.vietnix | GO-LIVE-KEYS | runbook mục |\n|---|---|---|---|---|---|---|---|---|';
const webVars = ['NEXT_PUBLIC_API_BASE_URL', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_TENANT_ROOT_DOMAIN', 'NEXT_PUBLIC_ZALO_APP_ID', 'NEXT_PUBLIC_ZALO_OA_ID', 'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', 'NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET', 'NEXT_PUBLIC_APP_URL', 'API_BASE_URL', 'THROTTLE_BYPASS_TOKEN', 'NEXT_STANDALONE', 'ALLOW_EMPTY_ZALO_APP_ID', 'KEEP_ALIVE_TIMEOUT', 'HOSTNAME'];
console.log('\n## Web (Next): biến NEXT_PUBLIC_* (nhúng lúc build) và biến runtime\n'); console.log(vh);
for (const v of webVars) {
  const dock = new RegExp(`\\b(ARG|ENV)\\s+${v}\\b`).test(dockerWeb) ? (/ARG/.test(dockerWeb.match(new RegExp(`.*\\b${v}\\b.*`))?.[0] ?? '') ? 'ARG' : 'ENV') : '-';
  console.log(`| \`${v}\` | ${webReaders(v, ['apps/web/src', 'apps/web/next.config.mjs'].filter((x) => fs.existsSync(R(x))).map((x) => x)) } | ${inExample(v, files.exWeb)} | ${inExample(v, files.exProd)} | ${dock} | ${inCompose(v, files.cProd)} | ${inCompose(v, files.cViet)} | ${inKeys(v)} | ${rbSections(v).slice(0, 5).join(',') || '-'} |`);
}
const miniVars = ['VITE_API_BASE_URL', 'VITE_WEB_BASE_URL', 'VITE_ZALO_OA_ID', 'VITE_CLOUDINARY_CLOUD_NAME', 'VITE_CLOUDINARY_UPLOAD_PRESET'];
console.log('\n## Mini App (Vite): biến VITE_* (nhúng lúc build, không qua Docker)\n');
console.log('| Biến | Code đọc ở path:line | File mẫu | .env.production.example | compose | GO-LIVE-KEYS | runbook mục |\n|---|---|---|---|---|---|---|');
for (const v of miniVars) console.log(`| \`${v}\` | ${webReaders(v, ['apps/miniapp/src'])} | ${fs.existsSync(R('apps/miniapp/.env.example')) ? inExample(v, 'apps/miniapp/.env.example') : 'KHÔNG CÓ file mẫu'} | ${inExample(v, files.exProd)} | ${inCompose(v, files.cViet)} | ${inKeys(v)} | ${rbSections(v).slice(0, 5).join(',') || '-'} |`);
const infraVars = ['WEB_DOMAIN', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'API_CPUS', 'WEB_CPUS', 'ZALO_APP_ID', 'ZALO_OA_ID', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_UPLOAD_PRESET', 'ALLOW_EMPTY_ZALO_APP_ID'];
console.log('\n## Biến chỉ compose / Docker (không nằm trong env.validation.ts)\n');
console.log('| Biến | api/.env.example | .env.production.example | compose.prod | compose.vietnix | GO-LIVE-KEYS | runbook 1.3 | runbook mục khác |\n|---|---|---|---|---|---|---|---|');
for (const v of infraVars) { const sec = rbSections(v); console.log(`| \`${v}\` | ${inExample(v, files.exApi)} | ${inExample(v, files.exProd)} | ${inCompose(v, files.cProd)} | ${inCompose(v, files.cViet)} | ${inKeys(v)} | ${sec.includes('1.3') ? 'bảng' : sec.includes('1.3-chữ') ? 'chỉ chữ' : '-'} | ${sec.filter((s) => !s.startsWith('1.3')).slice(0, 5).join(',') || '-'} |`); }
