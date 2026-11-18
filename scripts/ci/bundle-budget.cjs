#!/usr/bin/env node
// Báo cáo kích thước bundle miniapp trong CI và CẢNH BÁO khi vượt ngưỡng. Không chặn (thoát 0) trừ khi BUNDLE_BUDGET_STRICT=1.
//   node scripts/ci/bundle-budget.cjs apps/miniapp/www
//
// Ngưỡng là ngưỡng cảnh báo của dự án, KHÔNG phải giới hạn của Zalo (giới hạn dung lượng gói hiện hành của Zalo chưa kiểm).
//   MINIAPP_ENTRY_WARN_KB  file JS lớn nhất (entry), raw, mặc định 700. Mục tiêu trong docs/2026-10-review/03-perf.md A3-013: dưới 450.
//   MINIAPP_TOTAL_WARN_KB  tổng mọi file của bản build (JS + CSS + font/ảnh), raw, mặc định 2350 (W177 hạ từ 2500 sau khi chuyển 8 màn quản trị/đối tác/nhân sự sang cổng web đưa bản dựng về 2237 KB, để wave sau không đẩy tổng quay lại trên 2350).
//   MINIAPP_GAME_MINI_WARN_BYTES  tổng các chunk JS `mini-*` (khung ván, màn kết quả, bàn chơi game mini, tải lười), raw, mặc định 40000: khung ván,
//                                 màn kết quả (kèm chunk thêm giỏ `mini-result-cart`) và bàn chơi của cả 6 game mini chơi ngay trong Mini App; không nâng
//                                 hơn. Chọn Chuẩn Xanh là route riêng (chunk `game-matcher`) nên chỉ nằm trong tổng 2350 KB. CSS game mini không
//                                 tính: Rollup đặt tên file CSS theo chunk dùng chung nên tên không ổn định. Mỗi chunk còn có trần riêng: `mini-round-shell`
//                                 10 KB, chunk `mini-*` khác 6 KB. Không thấy chunk `mini-*` nào (Rollup gộp chunk nhỏ vào chunk tên khác) cũng là cảnh báo,
//                                 để ngưỡng không xanh vì không đo được gì.
// Đặt các biến repo cùng tên (Settings > Variables) để chỉnh ngưỡng mà không sửa workflow.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const kb = (bytes) => Math.round(bytes / 1024);
function threshold(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function collect(dir) {
  const rows = [];
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        const buf = fs.readFileSync(p);
        const compressible = /\.(js|css|html|json|svg|map)$/.test(p);
        rows.push({ file: path.relative(dir, p).split(path.sep).join('/'), raw: buf.length, gz: compressible ? zlib.gzipSync(buf).length : buf.length });
      }
    }
  })(dir);
  return rows;
}

function main() {
  const dir = path.resolve(process.argv[2] || 'apps/miniapp/www');
  const strict = process.env.BUNDLE_BUDGET_STRICT === '1';
  const entryWarnKb = threshold('MINIAPP_ENTRY_WARN_KB', 700);
  const totalWarnKb = threshold('MINIAPP_TOTAL_WARN_KB', 2350);
  const gameMiniWarnBytes = threshold('MINIAPP_GAME_MINI_WARN_BYTES', 40000);

  if (!fs.existsSync(dir)) {
    console.log(`::warning title=Bundle miniapp::không thấy thư mục ${dir}: bản build đổi chỗ đầu ra hoặc build chưa chạy, nên chưa đo được kích thước.`);
    process.exit(strict ? 1 : 0);
  }

  const rows = collect(dir);
  const sum = (re) => {
    const r = rows.filter((x) => re.test(x.file));
    return { files: r.length, raw: r.reduce((s, x) => s + x.raw, 0), gz: r.reduce((s, x) => s + x.gz, 0) };
  };
  const groups = [
    ['JS', sum(/\.js$/)],
    ['CSS', sum(/\.css$/)],
    ['Ảnh và font', sum(/\.(png|jpe?g|webp|gif|svg|woff2?|ttf)$/)],
    ['Tất cả', sum(/./)],
  ];
  const js = rows.filter((x) => x.file.endsWith('.js')).sort((a, b) => b.raw - a.raw);
  const entry = js[0];
  const total = groups[3][1];
  const gameMini = rows.filter((x) => /(^|\/)mini-[^/]*\.js$/.test(x.file));
  const gameMiniRaw = gameMini.reduce((s, x) => s + x.raw, 0);

  const warnings = [];
  if (entry && kb(entry.raw) > entryWarnKb) {
    warnings.push(`Entry ${entry.file} là ${kb(entry.raw)} KB raw / ${kb(entry.gz)} KB gzip, vượt ngưỡng cảnh báo ${entryWarnKb} KB (mục tiêu 450 KB).`);
  }
  if (kb(total.raw) > totalWarnKb) {
    warnings.push(`Tổng bản build là ${kb(total.raw)} KB raw / ${kb(total.gz)} KB gzip, vượt ngưỡng cảnh báo ${totalWarnKb} KB.`);
  }
  if (gameMiniRaw > gameMiniWarnBytes) {
    warnings.push(`Các chunk game mini (mini-*) tổng ${gameMiniRaw} byte raw, vượt ngưỡng ${gameMiniWarnBytes} byte.`);
  }
  if (gameMini.length === 0) {
    warnings.push('Không thấy chunk game mini (mini-*) nào: tên chunk đã đổi hoặc bị gộp vào chunk khác, ngưỡng game mini không đo được.');
  }
  for (const x of gameMini) {
    const cap = /(^|\/)mini-round-shell\./.test(x.file) ? 10 * 1024 : 6 * 1024;
    if (x.raw > cap) warnings.push(`Chunk ${x.file} là ${x.raw} byte raw, vượt trần ${cap} byte của một chunk game mini.`);
  }

  const lines = [
    `Bundle miniapp (${path.relative(process.cwd(), dir) || dir})`,
    ...groups.map(([name, g]) => `  ${name.padEnd(12)} ${String(g.files).padStart(4)} file  ${String(kb(g.raw)).padStart(6)} KB raw  ${String(kb(g.gz)).padStart(6)} KB gzip`),
    `  Game mini   ${String(gameMini.length).padStart(4)} file  ${String(gameMiniRaw).padStart(6)} byte raw (ngưỡng ${gameMiniWarnBytes})`,
    ...gameMini.slice().sort((a, b) => b.raw - a.raw).map((x) => `    ${x.file}  ${x.raw} byte raw / ${x.gz} byte gzip`),
    `  Ngưỡng cảnh báo: entry ${entryWarnKb} KB, tổng ${totalWarnKb} KB (giới hạn dung lượng của Zalo: chưa kiểm)`,
    'File lớn nhất:',
    ...rows
      .slice()
      .sort((a, b) => b.raw - a.raw)
      .slice(0, 8)
      .map((x) => `  ${x.file}  ${kb(x.raw)} KB raw / ${kb(x.gz)} KB gzip`),
  ];
  console.log(lines.join('\n'));
  for (const w of warnings) console.log(`::warning title=Bundle miniapp::${w}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      '### Bundle miniapp',
      '',
      '| Nhóm | File | Raw (KB) | Gzip (KB) |',
      '|---|---:|---:|---:|',
      ...groups.map(([name, g]) => `| ${name} | ${g.files} | ${kb(g.raw)} | ${kb(g.gz)} |`),
      '',
      `Game mini (\`mini-*\`): ${gameMini.length} file, ${gameMiniRaw} byte raw (ngưỡng ${gameMiniWarnBytes} byte).`,
      '',
      `Entry lớn nhất: \`${entry ? entry.file : '(không có JS)'}\` ${entry ? `${kb(entry.raw)} KB raw / ${kb(entry.gz)} KB gzip` : ''}. Ngưỡng cảnh báo: entry ${entryWarnKb} KB, tổng ${totalWarnKb} KB. Giới hạn dung lượng gói của Zalo: chưa kiểm.`,
      ...warnings.map((w) => `\n> **Cảnh báo:** ${w}`),
      '',
    ].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }

  process.exit(strict && warnings.length > 0 ? 1 : 0);
}

main();
