// node scores.mjs > rows.html — dựng {{SCORE_ROWS}} cho báo cáo GĐ4.
// Cột Nhanh của các màn có đo lại lấy từ PERF (điền sau khi chạy run-all).
const PERF = JSON.parse(process.env.PERF_SCORES || '{}');
const N = (k, d) => (PERF[k] ?? d);

const rows = [
  ['home', [3,3,3,2,4], [4,4,4,N('homeMini',2),4], [3,3,3,2,3], [4,4,4,N('homeWeb',2),3.5], 'R-2, R-3, R-4'],
  ['browse', [4,4,4,4,4], null, [4,4,4,3,4], [4,4,4,N('browseWeb',3),4], 'R-17'],
  ['browse-category', [3,3,4,3.5,4], [4,4,4,4,4], [3,3,4,3,4], [4,4,4,3.5,4], 'R-89, R-5'],
  ['browse-search', [4,4,4,3.5,2.5], [4,4,4,3.5,4], [4,4,4,3,3.5], [4,4,4,3,4], 'R-14'],
  ['brand-slug', [2,2,4,4,2], [4,4,4,4,4], [4,4,4,4,4], null, 'R-19'],
  ['brand-story', [3,4,4,4,4], [4,4,4,4,4], [3,4,4,4,4], [4,4,4,4,4], 'R-20'],
  ['about', [3,3,3,4,4], null, [3,4,4,4,4], null, 'Chờ anh/chị (R-1)'],
  ['product-slug', [4,3,3,3,4], [4,4,4,3.5,4], [4,3,3,3,3], [4,4,4,N('detailWeb',3),3], 'R-6, R-5; R-24 còn'],
  ['cart', [4,4,4,3.5,4], null, [4,4,3,3.5,4], null, '/cart 18 → 13 câu SQL'],
  ['checkout', [4,4,3,3.5,4], [4,4,4,3.5,4], [4,3,3,2,3], [4,4,4,N('checkoutWeb',2),4], 'R-7, R-22, R-23'],
  ['bank-payment-code', [3,2,3,4,4], [4,4,4,4,4], [3,2,3,4,4], [4,4,4,4,4], 'R-8'],
  ['group-buy', [3,4,4,4,4], null, [3,2,4,4,4], [3,4,4,4,4], 'R-25'],
  ['orders', [4,4,4,4,4], null, [4,4,3,3.5,4], [4,4,4,3.5,4], 'R-36'],
  ['order-code', [4,3,4,4,4], [4,4,4,4,4], [4,3,3,3,3], [4,4,4,3,4], 'R-9, R-35'],
  ['profile', [4,3,3,3.5,4], [4,4,4,3.5,4], [4,3,3,3,4], [4,4,4,3,4], 'R-33, R-34'],
  ['loyalty', [4,3,3,4,4], [4,4,3,4,4], [4,3,3,3,4], [4,4,3,3,4], 'R-37, R-41, R-42'],
  ['offers', [4,3,4,4,3.5], [4,4,4,4,4], [3,3,4,3,3.5], [4,4,4,3,4], 'R-10, R-37, R-43'],
  ['rewards', [4,3,3,4,4], [4,4,3,4,4], [4,3,3,4,4], [4,4,3,4,4], 'R-39'],
  ['game', [3,3,3,4,3.5], [4,3.5,3,4,4], [3,3,4,3,3.5], [4,3.5,4,3,4], 'R-37, R-45 một phần'],
  ['recycle', [4,3,3,3.5,4], [4,4,3,3.5,4], [4,3,4,3.5,4], [4,4,4,3.5,4], 'R-47'],
  ['recycle-new', [4,3,4,4,4], [4,4,4,4,4], [3,3,4,4,4], [3,4,4,4,4], 'R-48, R-49, R-52'],
  ['recycle-rules', [2,3,3,4,3], null, [2,3,3,4,3], null, 'Chờ anh/chị (R-11)'],
  ['recycle-requests', [3,3,3,4,2], [4,3,3,4,4], [3,3,4,4,3], [4,3,4,4,4], 'R-50, R-51'],
  ['chat', [4,3,3,3.5,4], [4,4,3.5,3.5,4], [4,3,3,3.5,4], [4,4,3,3.5,4], 'R-52, R-128'],
  ['feed', [3,3,3,4,4], null, [3,3,3,4,4], null, 'Chờ anh/chị (R-55)'],
  ['academy', [3,3,3,4,4], [3,3.5,3,4,4], [3,3,3,4,4], [3,3.5,3,4,4], 'R-53 một phần'],
  ['affiliate', [3,3,4,3.5,4], [4,4,4,3.5,4], [3,3,4,3,4], [4,4,4,3,4], 'R-12, R-59, R-60'],
  ['storefront', [3,3,3,4,3], [4,3,3,4,4], [3,3,4,4,3], [4,3,4,4,4], 'R-58'],
  ['s-slug', [4,3,4,4,4], [4,4,4,4,4], [4,3,4,4,4], [4,4,4,4,4], 'R-61'],
  ['dealer', [4,3,3,4,4], [4,4,3,4,4], [4,3,3,3.5,4], [4,4,3,3.5,4], 'R-62'],
  ['wallet', [4,3,4,4,4], [4,4,4,4,4], [4,3,4,3.5,3.5], [4,4,4,3.5,3.5], 'R-60'],
  ['staff', [4,3,3,4,3], [4,4,4,4,4], [4,4,4,4,4], null, 'R-64, R-65'],
  ['cashback', null, null, [2,3,3,4,4], 'gone', 'R-44: web về trang chủ khi cờ tắt, như Mini'],
  ['404', [4,4,4,5,5], null, [4,4,4,4,5], null, '—'],
];

const fmt = (x) => String(x).replace('.', ',');
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const cls = (v) => (v >= 4.5 ? 's5' : v >= 3.75 ? 's4' : v >= 2.75 ? 's3' : 's2');
const cell = (a, before) => {
  if (a === 'gone') return '<td>Không còn màn này</td>';
  if (!a) return before ? '<td>như trước</td>' : '<td>–</td>';
  const v = Math.round(avg(a) * 10) / 10;
  const parts = a.map((x, i) => (before && before[i] !== x ? `<b>${fmt(x)}</b>` : fmt(x)));
  return `<td>${parts.join('·')} <span class="${cls(v)}">${fmt(v.toFixed(1))}</span></td>`;
};

const out = [];
const sums = { mb: [], ma: [], wb: [], wa: [] };
for (const [k, mb, ma, wb, wa, fix] of rows) {
  out.push(`      <tr><td>${k}</td>${cell(mb)}${cell(ma, mb)}${cell(wb)}${cell(wa, wb)}<td>${fix}</td></tr>`);
  if (mb) { sums.mb.push(mb); sums.ma.push(ma || mb); }
  if (wb && wa !== 'gone') { sums.wb.push(wb); sums.wa.push(wa || wb); }
}
const col = (list) => [0, 1, 2, 3, 4].map((i) => Math.round(avg(list.map((a) => a[i])) * 10) / 10);
const tb = (list) => {
  const c = col(list);
  const v = Math.round(avg(c) * 10) / 10;
  return `<td><b>${c.map((x) => fmt(x.toFixed(1))).join('·')}</b> <span class="${cls(v)}">${fmt(v.toFixed(1))}</span></td>`;
};
out.push(`      <tr><td><b>Trung bình</b></td>${tb(sums.mb)}${tb(sums.ma)}${tb(sums.wb)}${tb(sums.wa)}<td>Dễ ${fmt(col(sums.mb)[1].toFixed(1))} → ${fmt(col(sums.ma)[1].toFixed(1))} (Mini), ${fmt(col(sums.wb)[1].toFixed(1))} → ${fmt(col(sums.wa)[1].toFixed(1))} (web)</td></tr>`);
console.log(out.join('\n'));
