// Sinh bảng chấm điểm A4 (markdown, in ra stdout). Điểm tự động: token (quét tĩnh), tap (boundingBox), contrast (axe).
// Điểm thủ công (thứ bậc, CTA, copy, premium) khai báo trong MANUAL, dựa trên ảnh chụp.
//   node scripts/uiux/scorecard.mjs miniapp|web
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/pw.mjs';

const app = process.argv[2] ?? 'miniapp';
const readJsonl = (f) => fs.readFileSync(path.join(ROOT, 'scripts/uiux/results', f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const L = readJsonl(`${app}.jsonl`);
const scan = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/uiux/results/static-scan.json'), 'utf8'));
const find = (id, state, vp) => L.find((r) => r.id === id && r.state === state && r.vp === vp);

// id -> [file trang (để tra token), H, A, V, R, vấn đề chính]
const M = {
  home: ['home', 4, 4, 4, 4, 'Dải "Mua lại" cắt ngang không gợi ý cuộn; "★ Mới" tone disabled xám nhạt (product-tile.tsx:174,179); 12 phần tử tap <44px; khi catalog lỗi các khối biến mất, không có nút thử lại'],
  'home-new-customer': ['home', 4, 4, 4, 4, 'contrast×9 trên ảnh khách mới; chữ <12px ×11'],
  browse: ['browse', 4, 4, 4, 4, 'Không có h1; 6 tap nhỏ; nested-interactive×30 (thẻ chứa nút tim)'],
  'browse-search': ['browse', 4, 4, 4, 4, 'contrast×4 ở kết quả tìm kiếm'],
  'product-detail': ['product-detail', 4, 5, 4, 4, 'Viewport chặn zoom (index.html:7); chữ <12px ×17; không có h1; trang dài, "Cam kết Tubu" và mô tả nằm sau 4 khối khuyến mãi'],
  cart: ['cart', 4, 4, 4, 4, '13/23 phần tử tương tác <44px; nhãn "Mã giảm giá" (cart.tsx:446) ≠ "Mã ưu đãi" (voucher-sheet.tsx:162)'],
  checkout: ['checkout', 4, 5, 4, 4, 'label×6 (radio/checkbox thiếu nhãn); Ví Tubu/TubuXu bị làm mờ nhưng không nói vì sao; "48/65000 điểm" không có dấu phân cách nghìn'],
  'bank-payment': ['bank-payment', 4, 4, 4, 3, 'Trang rất thưa, không có h1; mã QR dựa vào CSP/Vite nên chưa kiểm chứng nội dung thật'],
  orders: ['orders', 4, 4, 4, 4, 'contrast×6; chữ <12px ×5; thẻ "Mua lại" lặp lại đúng thẻ ở Home'],
  'orders-subscriptions': ['orders', 4, 4, 3, 4, 'contrast×7; thông báo giảm giá 12% hiển thị trên cả đơn đã huỷ'],
  'order-detail': ['order-detail', 4, 4, 3, 4, 'Dòng sự kiện hiện enum thô `ev.status ?? "—"` (order-detail.tsx ~401); chữ <12px ×20; 2 Sheet ZaUI'],
  game: ['game', 2, 3, 3, 3, '163 alias legacy, 107 emoji, trang dài >3200px chứa ≥12 khối; số không định dạng ("1250000", "65.000 xu"); contrast×10; 4 lỗi console'],
  feed: ['feed', 3, 3, 4, 3, '26/35 phần tử tương tác <44px; button-name×1; scrollable-region-focusable×5'],
  'feed-leaderboard': ['community-leaderboard', 4, 3, 4, 3, 'Lặp "điểm uy tín" ở từng hàng; contrast×3; huy chương emoji'],
  'feed-events': ['community-events', 3, 3, 4, 3, 'contrast×2; không h1'],
  'post-detail': ['post-detail', 3, 3, 4, 3, '60 alias legacy; 7/15 tap nhỏ'],
  'ai-advisor': ['ai-advisor', 3, 4, 4, 3, 'Ô nhập + nút "Gửi" (disabled) xám trên xám; khi lỗi mạng chưa thấy thông báo trong ảnh error'],
  'group-buy': ['group-buy', 3, 4, 4, 3, 'contrast×9'],
  refill: ['refill', 3, 3, 4, 3, 'button-name×2 (nút icon không nhãn); 37 alias legacy'],
  beta: ['beta', 3, 3, 4, 3, 'contrast×6; nút "Gửi góp ý" vô hiệu hoá nhạt; 3 lỗi console'],
  profile: ['profile', 3, 3, 4, 3, 'contrast×10; 43 alias legacy; menu 17 mục không nhóm theo mức dùng'],
  wallet: ['wallet', 3, 3, 4, 3, 'contrast×6; 62 alias legacy'],
  addresses: ['addresses', 3, 3, 4, 3, 'ActionLink là Text onClick không role/min-height (addresses.tsx:178-200)'],
  notifications: ['notifications', 3, 3, 4, 3, 'aria-prohibited-attr×3; contrast×4'],
  affiliate: ['affiliate', 3, 3, 3, 3, '129 alias legacy; trang rất dài; thuật ngữ "Tubu Xu"/"TubuXu"/"xu" lẫn lộn (affiliate.tsx:368)'],
  academy: ['academy', 3, 3, 4, 3, 'contrast×9'],
  'academy-course': ['academy', 3, 3, 4, 3, 'Không có h1'],
  cashback: ['cashback', 3, 3, 4, 3, 'contrast×4; 26 alias legacy + 5 màu thô'],
  dealer: ['dealer', 2, 3, 3, 2, '20/23 tap nhỏ; 121 alias; contrast×8; `--dealer-*` giữ hex v1'],
  about: ['about', 3, 2, 2, 2, 'Hotline/email giữ chỗ (about.tsx:181-183: "1900 1234", "hotro@tubutree.com") chưa xác nhận; 14/16 tap nhỏ'],
  wishlist: ['wishlist', 3, 3, 4, 3, 'Dùng components/product-card.tsx cũ (không phải ProductTile); contrast×7'],
  'edit-profile': ['edit-profile', 3, 4, 4, 3, 'label×3 (ô nhập thiếu nhãn gắn kết)'],
  settings: ['settings', 3, 3, 3, 3, 'aria-toggle-field-name×3; mũi tên bằng ký tự "›" (settings.tsx:225)'],
  'brand-story': ['brand-story', 3, 2, 4, 3, '102 hex + 5 rgb trong file; chữ <12px ×29; không h1'],
  'storefront-builder': ['storefront-builder', 2, 3, 3, 2, '64/100 phần tử tương tác <44px; 88 alias legacy; trang rất dài'],
  'storefront-view': ['storefront-view', null, null, null, null, 'KHÔNG CHỤP ĐƯỢC (Vite 504 "Outdated Optimize Dep" do qrcode); chấm token theo code'],
  'brand-view': ['brand-view', null, null, null, null, 'KHÔNG CHỤP ĐƯỢC (Vite 504, qrcode); chấm token theo code'],
  loyalty: ['loyalty', null, null, null, null, 'KHÔNG CHỤP ĐƯỢC (Vite 504, qrcode); 150 alias legacy, emoji hạng (loyalty.tsx:36-41)'],
  'brand-owner': ['brand-owner', 3, 3, 3, 3, '12/24 tap nhỏ; label×3; không có màn doanh thu/đơn hàng cho chủ nhãn'],
  admin: ['admin', 3, 3, 3, 3, '3 lỗi console; tiêu đề trang thiếu h1; 32 alias legacy'],
  'admin-community': ['community-moderation', 3, 3, 4, 3, 'contrast×2'],
  'my-payroll': ['my-payroll', 3, 3, 4, 3, 'button-name×2; 7 màu rgb thô'],
  'not-found': ['not-found', 4, 4, 5, 4, 'Tiêu đề đè lên hình minh hoạ (ảnh not-found__normal__390)'],
  staff: ['staff', 3, 4, 4, 3, 'button-name×2; contrast×4; 41 alias legacy'],
  // web
  'w:home': [null, 4, 4, 4, 3, 'Hero gradient + CTA cam (palette v1); chữ <12px ×86; contrast×20'],
  'w:san-pham': [null, 4, 4, 4, 3, 'CTA cam, placeholder lá; 6/7 tap nhỏ'],
  'w:gio-hang': [null, 3, 4, 4, 3, '19/20 tap nhỏ; contrast×8'],
  'w:thanh-toan': [null, 3, 4, 4, 3, '11/16 tap nhỏ'],
  'w:tai-khoan': [null, 3, 3, 4, 3, 'Header gradient cam; không h1'],
  'w:dang-nhap': [null, 4, 4, 4, 3, 'contrast×3'],
  'w:dang-nhap-callback': [null, 3, 3, 3, 3, 'Không h1; trạng thái chờ OAuth trống'],
  'w:storefront': [null, 3, 3, 4, 3, 'Palette v1'],
  'w:brand': [null, 3, 3, 4, 3, 'Palette v1'],
  'w:admin-pos': [null, 3, 4, 4, 3, '6/6 tap nhỏ'],
  'w:merchant-denied': [null, 3, 3, 4, 3, 'Không h1; chỉ báo từ chối'],
};

const tapScore = (s, t) => (t === 0 || s === 0 ? 5 : s <= 2 || s / t <= 0.1 ? 4 : s / t <= 0.25 ? 3 : s / t <= 0.5 ? 2 : 1);
const conScore = (n) => (n === 0 ? 5 : n <= 2 ? 4 : n <= 5 ? 3 : n <= 9 ? 2 : 1);
const tokScore = (f) => {
  if (!f) return 1;
  const raw = f.hex + f.rgb;
  if (f.hex > 50) return 1;
  if (f.legacy > 100) return 1;
  if (f.legacy > 40 || raw >= 5) return 2;
  if (f.legacy > 15) return 3;
  if (f.legacy > 0 || raw > 0) return 4;
  return 5;
};

const ids = [...new Set(L.map((r) => r.id))];
const rows = [];
for (const id of ids) {
  const key = app === 'web' ? (M[`w:${id}`] ? `w:${id}` : id) : id;
  const m = M[key] ?? (id.startsWith('admin-') && app === 'web' ? [null, 3, 3, 4, 2, 'Bảng quản trị palette v1, nút <44px'] : id.startsWith('merchant-') ? [null, 3, 3, 4, 2, 'Console palette v1, giữ hex theme'] : null);
  if (!m) continue;
  const r = find(id, 'normal', 390) ?? find(id, 'normal', 1440);
  const shot = r?.shot ? `screens/${app}/${path.basename(String(r.shot)).replace(/\\/g, '/')}` : `screens/${app}/${id}__normal__390.png`;
  const cc = (r?.axe ?? []).find((v) => v.id === 'color-contrast')?.count ?? 0;
  const tap = r ? tapScore(r.tapSmall, r.tapTotal) : '—';
  const con = r ? conScore(cc) : '—';
  let tok;
  if (app === 'miniapp') {
    const f = scan.mini.find((x) => x.file === `apps/miniapp/src/pages/${m[0]}.tsx`);
    tok = tokScore(f);
  } else tok = 1;
  const [, H, A, V, R, issue] = m;
  const nums = [tok, H, A, V, tap, con, R].filter((x) => typeof x === 'number');
  const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : '—';
  rows.push(`| \`${id}\` | ${tok} | ${H ?? '—'} | ${A ?? '—'} | ${V ?? '—'} | ${tap} | ${con} | ${R ?? '—'} | **${avg}** | ${issue} | [ảnh](${shot}) |`);
}
console.log('| trang | token DS v2 | thứ bậc | CTA | copy VN | tap ≥44px | contrast | premium | TB | vấn đề chính | ảnh |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
console.log(rows.join('\n'));
