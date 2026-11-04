// C26: CTV không chiếm được tên miền phụ của hệ thống hay của người khác, và không gắn được ảnh đại diện/ảnh bìa nguy hiểm vào gian hàng.
// Luật: identifier-validation.ts (SUBDOMAIN_RE 3-30 ký tự, danh sách từ khoá hệ thống, không trùng slug/subdomain khác), storefront-images.ts (chỉ https hoặc base64 png/jpeg/webp/gif).
// Chạy sau c4: node c26-storefront-identifiers-images.mjs (từ gốc worktree uat-1104). Không ghi dữ liệu: mọi lệnh đều phải bị từ chối.
import { call, short, sql, check, done } from './common.mjs';

const T = (title, step, expect) => ({ title, persona: 'ctv', size: 'API', journey: title, step, expect });
const snap = async () => (await sql(`SELECT subdomain, "avatarUrl" a, "coverUrl" c FROM storefronts WHERE slug='uatctv'`))[0];
const before = await snap();

const subs = ['api', 'admin', 'www', 'cskh', 'zalo', 'uatreturning', 'ab', 'Bad_Name', '-abc', 'a'.repeat(31)];
const subRes = [];
for (const s of subs) subRes.push([s, await call('ctv', 'PATCH', '/storefront/me', { subdomain: s })]);
const subOk = subRes.every(([, r]) => r.status >= 400 && r.status < 500);
check('L6-X01', T('CTV đặt tên miền phụ trùng từ khoá hệ thống, trùng slug người khác hoặc sai dạng: bị từ chối', `PATCH /storefront/me subdomain = ${subs.map((s) => s.slice(0, 12)).join(', ')}`, 'mọi lệnh 4xx; subdomain trong SQL không đổi'),
  subOk && (await snap()).subdomain === before.subdomain, subRes.map(([s, r]) => `${s.slice(0, 12)}=${r.status}`).join(' '), 'SQL storefronts.subdomain');

const imgs = ['javascript:alert(1)', 'http://evil.test/x.png', '//evil.test/x.png', 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'ftp://evil.test/x.png'];
const imgRes = [];
for (const u of imgs) {
  imgRes.push(['avatarUrl', u, await call('ctv', 'PATCH', '/storefront/me', { avatarUrl: u })]);
  imgRes.push(['coverUrl', u, await call('ctv', 'PATCH', '/storefront/me', { coverUrl: u })]);
}
const after = await snap();
check('L6-X02', T('CTV gắn ảnh đại diện/ảnh bìa bằng javascript:, http, SVG, text/html, ftp: bị từ chối, ảnh cũ giữ nguyên', 'PATCH /storefront/me avatarUrl và coverUrl với 6 giá trị nguy hiểm', 'mọi lệnh 400; avatarUrl/coverUrl trong SQL không đổi'),
  imgRes.every(([, , r]) => r.status === 400) && after.a === before.a && after.c === before.c, imgRes.map(([f, u, r]) => `${f[0]}:${u.slice(0, 10)}=${r.status}`).join(' '), 'SQL storefronts.avatarUrl/coverUrl');

const msg = imgRes.find(([, , r]) => r.status === 400)?.[2]?.body?.message;
check('L6-X03', T('Chữ báo lỗi ảnh nguy hiểm và tên miền phụ là tiếng Việt, không "Vui lòng", không lộ chi tiết kỹ thuật', 'đọc message của lệnh bị từ chối đầu tiên của X01 và X02', 'message tiếng Việt có dấu, không "Vui lòng", không "...", không stack'),
  typeof msg === 'string' && /[ăâđêôơưáàảãạ]/i.test(msg) && !/Vui lòng|\.\.\.|at \w+\./.test(msg) && subRes.every(([, r]) => typeof r.body?.message === 'string' && !/Vui lòng/.test(r.body.message)), `ảnh="${String(msg).slice(0, 120)}"; tên miền phụ="${String(subRes[0][1].body?.message).slice(0, 100)}"`, 'API');
await done();
