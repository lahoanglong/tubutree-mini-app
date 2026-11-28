#!/usr/bin/env node
// Báo cáo kích thước bundle miniapp trong CI và CẢNH BÁO khi vượt ngưỡng. Không chặn (thoát 0) trừ khi BUNDLE_BUDGET_STRICT=1.
//   node scripts/ci/bundle-budget.cjs apps/miniapp/www
//
// Ngưỡng là ngưỡng cảnh báo của dự án, KHÔNG phải giới hạn của Zalo (giới hạn dung lượng gói hiện hành của Zalo chưa kiểm).
// Hai ngưỡng *_KB tính bằng KiB (1024 B) và so từng byte: số byte thô lớn hơn KB × 1024 là vượt. Trước w33-03 script so Math.round(byte / 1024)
// với ngưỡng, nên bản dựng vượt trần tới 511 B vẫn qua strict. Log in số byte thô, số byte còn tới trần và nguồn của ngưỡng (biến môi trường hay mặc định).
//   MINIAPP_ENTRY_WARN_KB  file JS lớn nhất (entry), raw, mặc định 312 = 319 488 B (cảnh báo từ 319 489 B; entry đo ở w31-04 là 308 778 B).
//                          Gọi `fillCopy` trong mô-đun gói đầu là kéo cả `SHOP_COPY` về entry: dùng `fillBootCopy` (packages/app-core/src/shop-copy-boot.ts).
//   MINIAPP_TOTAL_WARN_KB  tổng mọi file của bản build (JS + CSS + font/ảnh), raw, mặc định 2210 = 2 263 040 B = trần gói mà các lần phát hành từ w24-04 đã chặn
//                          (w28-01 hạ từ 2350 sau khi gom chuỗi lặp của từng chunk đưa bản dựng từ 2168 KB về 2082 KB; trước đó: W177 hạ từ 2500 xuống 2350 sau khi chuyển 8 màn quản trị/đối tác/nhân sự sang cổng web đưa bản dựng về 2237 KB; w3-09 nâng lên 2380 khi gộp 9 tính năng đợt 3,
//                          gồm cả 6 game chơi ngay trong Mini App, đưa bản dựng lên 2357 KB; w6-03 hạ lại 2350 sau khi cắt 4 tệp Inter
//                          về bộ glyph trình duyệt dùng mặc định (−43 KB, chữ hiển thị trùng từng pixel, xem packages/design-tokens/src/fonts.css), bản dựng còn ~2335 KB).
//   MINIAPP_GAME_MINI_WARN_BYTES  tổng các chunk JS `mini-*` (khung ván, màn kết quả, bàn chơi game mini, tải lười), raw, mặc định 50000: khung ván,
//                                 màn kết quả (kèm chunk thêm giỏ `mini-result-cart`) và bàn chơi của cả 8 game mini chơi ngay trong Mini App; không nâng
//                                 hơn (w48-01b nâng từ 40000 khi thêm hai game thao tác Ghép Mầm Xanh và Băng Chuyền Xanh: hai bàn chơi, hình vector và
//                                 hook vuốt/phím/âm thanh dùng chung đưa tổng từ 30659 lên ~48100 byte). Chọn Chuẩn Xanh là route riêng (chunk `game-matcher`) nên chỉ nằm trong tổng 2350 KB. CSS game mini không
//                                 tính: Rollup đặt tên file CSS theo chunk dùng chung nên tên không ổn định. Mỗi chunk còn có trần riêng: `mini-round-shell`
//                                 10 KB, chunk `mini-*` khác 6 KB. Không thấy chunk `mini-*` nào (Rollup gộp chunk nhỏ vào chunk tên khác) cũng là cảnh báo,
//                                 để ngưỡng không xanh vì không đo được gì.
// Đặt các biến repo cùng tên (Settings > Variables) để chỉnh ngưỡng mà không sửa workflow.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const KIB = 1024;
/** Chỉ để in bảng cho dễ đọc. So ngưỡng dùng `budget` (từng byte), không dùng số đã làm tròn này. */
const kb = (bytes) => Math.round(bytes / KIB);
/** Ngưỡng từ biến môi trường, sai dạng hoặc không đặt thì dùng mặc định; `source` cho log biết số đang dùng lấy từ đâu. */
function threshold(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  if (raw !== undefined && raw !== '' && Number.isFinite(n) && n > 0) return { value: n, source: `${name}=${raw}` };
  return { value: fallback, source: raw === undefined || raw === '' ? `mặc định ${fallback}` : `mặc định ${fallback}, ${name}="${raw}" sai dạng` };
}
/** Trần `kib` KiB tính ra byte, vượt khi byte thô lớn hơn trần; `headroom` âm là số byte vượt. */
function budget(bytes, kib) {
  const limit = Math.floor(kib * KIB);
  return { limit, over: bytes > limit, headroom: limit - bytes };
}
const room = (b) => (b.over ? `vượt ${-b.headroom} B` : `còn ${b.headroom} B tới trần`);

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
  const entryWarn = threshold('MINIAPP_ENTRY_WARN_KB', 312);
  const totalWarn = threshold('MINIAPP_TOTAL_WARN_KB', 2210);
  const gameMiniWarnBytes = threshold('MINIAPP_GAME_MINI_WARN_BYTES', 50000).value;

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
  const entryBudget = entry ? budget(entry.raw, entryWarn.value) : null;
  const totalBudget = budget(total.raw, totalWarn.value);
  const limitText = (warn) => `${warn.value} KiB = ${budget(0, warn.value).limit} B (${warn.source})`;
  const entryLimit = limitText(entryWarn);
  const totalLimit = limitText(totalWarn);

  const warnings = [];
  if (entry && entryBudget.over) {
    warnings.push(`Entry ${entry.file} là ${entry.raw} B raw / ${kb(entry.gz)} KiB gzip, vượt ngưỡng cảnh báo ${entryLimit}: thừa ${-entryBudget.headroom} B.`);
  }
  if (totalBudget.over) {
    warnings.push(`Tổng bản build là ${total.raw} B raw / ${kb(total.gz)} KiB gzip, vượt ngưỡng cảnh báo ${totalLimit}: thừa ${-totalBudget.headroom} B.`);
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
    ...groups.map(([name, g]) => `  ${name.padEnd(12)} ${String(g.files).padStart(4)} file  ${String(kb(g.raw)).padStart(6)} KiB raw  ${String(kb(g.gz)).padStart(6)} KiB gzip`),
    `  Game mini   ${String(gameMini.length).padStart(4)} file  ${String(gameMiniRaw).padStart(6)} byte raw (ngưỡng ${gameMiniWarnBytes})`,
    ...gameMini.slice().sort((a, b) => b.raw - a.raw).map((x) => `    ${x.file}  ${x.raw} byte raw / ${x.gz} byte gzip`),
    `  Đơn vị: KiB (1024 B); ngưỡng so từng byte thô, không làm tròn (giới hạn dung lượng của Zalo: chưa kiểm)`,
    `  Tổng: ${total.raw} B raw, ngưỡng ${totalLimit}: ${room(totalBudget)}`,
    entry ? `  Entry ${entry.file}: ${entry.raw} B raw, ngưỡng ${entryLimit}: ${room(entryBudget)}` : `  Entry: không có file JS, ngưỡng ${entryLimit}`,
    'File lớn nhất:',
    ...rows
      .slice()
      .sort((a, b) => b.raw - a.raw)
      .slice(0, 8)
      .map((x) => `  ${x.file}  ${kb(x.raw)} KiB raw / ${kb(x.gz)} KiB gzip`),
  ];
  console.log(lines.join('\n'));
  for (const w of warnings) console.log(`::warning title=Bundle miniapp::${w}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      '### Bundle miniapp',
      '',
      '| Nhóm | File | Raw (KiB) | Gzip (KiB) |',
      '|---|---:|---:|---:|',
      ...groups.map(([name, g]) => `| ${name} | ${g.files} | ${kb(g.raw)} | ${kb(g.gz)} |`),
      '',
      `Game mini (\`mini-*\`): ${gameMini.length} file, ${gameMiniRaw} byte raw (ngưỡng ${gameMiniWarnBytes} byte).`,
      '',
      `Tổng: ${total.raw} B raw, ngưỡng ${totalLimit}: ${room(totalBudget)}.`,
      '',
      `Entry lớn nhất: \`${entry ? entry.file : '(không có JS)'}\` ${entry ? `${entry.raw} B raw / ${kb(entry.gz)} KiB gzip, ngưỡng ${entryLimit}: ${room(entryBudget)}` : ''}. KiB = 1024 B, so từng byte thô. Giới hạn dung lượng gói của Zalo: chưa kiểm.`,
      ...warnings.map((w) => `\n> **Cảnh báo:** ${w}`),
      '',
    ].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }

  process.exit(strict && warnings.length > 0 ? 1 : 0);
}

main();
