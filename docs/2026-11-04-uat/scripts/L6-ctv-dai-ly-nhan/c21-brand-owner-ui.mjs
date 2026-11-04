// C21: chủ nhãn sửa hồ sơ thương hiệu bằng giao diện (Mini 375 và web 375): điền câu giới thiệu, nguồn gốc, câu chuyện (có ký tự HTML), bấm Lưu thông tin;
// đối chiếu SQL (bảng brands) và trang công khai của nhãn (khách thấy chữ vừa lưu, ký tự HTML hiện thành chữ, không thành thẻ). Cuối script trả hồ sơ cũ và gỡ đăng nhãn.
// Luật: brand.service.ts (chủ nhãn chỉ sửa logo, ảnh bìa, tagline, story, origin; công khai khi isPublished), AGENTS.md (chữ không bị chèn thẻ).
// Chạy sau c6: node c21-brand-owner-ui.mjs (từ gốc worktree uat-1104).
import fs from 'node:fs';
import path from 'node:path';
import { H, SHOTS, call, short, sql, check, done, sleep } from './common.mjs';
const { open } = await import(`${H}/miniapp-session.mjs`);
const { openWeb } = await import(`${H}/web-session.mjs`);

const BRAND = '75ae0443eea88aa90f3c2bec9bc3ece1';
const T = (title, size, step, expect) => ({ title, persona: 'brand', size, journey: title, step, expect });
const field = (page, label) => page.locator(`xpath=//*[normalize-space(text())="${label}"]/following::*[self::input or self::textarea][1]`).first();
const sess = (surface, persona, route) => (surface === 'mini375'
  ? open(6, persona, { path: route, viewport: { width: 375, height: 812, isMobile: true } })
  : openWeb(6, persona, { path: route, viewport: { width: 375, height: 812, isMobile: true } }));
const ownerRoute = { mini375: '/brand-owner', web375: '/chu-thuong-hieu' };

const [orig] = await sql(`SELECT slug, "isPublished" pub, tagline, origin, story FROM brands WHERE id=$1`, BRAND);
const pub = await call('admin', 'PATCH', `/admin/brands/${BRAND}`, { isPublished: true });
await sleep(1500);
const seen = {};
try {
  for (const surface of ['mini375', 'web375']) {
    const tag = `Giới thiệu UAT ${surface}`;
    const origin = `Xứ UAT ${surface}`;
    const story = `Chuyện UAT ${surface} <b>đậm</b> & "trích dẫn" <script>x</script>`;
    const info = { surface, tag, origin, story };
    const s = await sess(surface, 'brand', ownerRoute[surface]);
    try {
      await s.page.waitForTimeout(3500);
      await field(s.page, 'Câu giới thiệu ngắn').fill(tag);
      await field(s.page, 'Nguồn gốc').fill(origin);
      await field(s.page, 'Câu chuyện thương hiệu').fill(story);
      await s.page.screenshot({ path: path.join(SHOTS, `${surface}-chu-nhan-da-dien.png`), fullPage: surface === 'web375' });
      await s.page.getByRole('button', { name: 'Lưu thông tin' }).first().click({ timeout: 8000 });
      await s.page.waitForTimeout(1500);
      info.after = await s.page.evaluate(() => document.body.innerText);
      await s.page.screenshot({ path: path.join(SHOTS, `${surface}-chu-nhan-sau-luu.png`) });
    } catch (e) { info.error = String(e.message).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 400); } finally { await s.close(); }
    await sleep(1500);
    const [row] = await sql(`SELECT tagline t, origin o, story s FROM brands WHERE id=$1`, BRAND);
    info.row = row;
    const g = await sess(surface, 'new', '/brand/fuwa3e');
    try {
      await g.page.waitForTimeout(4000);
      info.public = await g.page.evaluate(() => {
        const main = document.querySelector('main') ?? document.body;
        return { text: main.innerText, boldTags: main.querySelectorAll('b').length, scriptInMain: main.querySelectorAll('script:not([src])').length };
      });
      await g.page.screenshot({ path: path.join(SHOTS, `${surface}-nhan-cong-khai-sau-sua.png`) });
    } catch (e) { info.error = `${info.error ?? ''} public: ${String(e.message).slice(0, 200)}`; } finally { await g.close(); }
    seen[surface] = info;
    const size = surface === 'mini375' ? 'Mini 375' : 'web 375';
    const saved = row?.t === tag && row?.o === origin && row?.s === story;
    const shows = !!info.public && info.public.text.includes(tag) && info.public.text.includes('<script>x</script>') && info.public.boldTags === 0;
    check(surface === 'mini375' ? 'L6-H25' : 'L6-H26', T(`Chủ nhãn sửa hồ sơ bằng giao diện ${size}: lưu đúng vào SQL, trang công khai hiện chữ, ký tự HTML không thành thẻ`, size, 'điền ba ô, bấm Lưu thông tin, mở /brand/fuwa3e bằng khách', 'brands.tagline/origin/story = chữ vừa nhập; trang công khai có câu giới thiệu và nguyên chuỗi "<script>x</script>" như chữ; không thẻ <b> thật'),
      !info.error && saved && shows, `${info.error ? `lỗi: ${info.error}; ` : ''}SQL=${short(row, 300)}; công khai: có câu giới thiệu=${!!info.public?.text.includes(tag)}, có chuỗi script như chữ=${!!info.public?.text.includes('<script>x</script>')}, thẻ b=${info.public?.boldTags}`, `shots/L6-ctv-dai-ly-nhan/${surface}-chu-nhan-da-dien.png, ${surface}-nhan-cong-khai-sau-sua.png + SQL brands`);
  }
} finally {
  await call('brand', 'PATCH', '/brand/owner/me', { tagline: orig.tagline ?? '', origin: orig.origin ?? '', story: orig.story ?? '' }).catch(() => undefined);
  await call('admin', 'PATCH', `/admin/brands/${BRAND}`, { isPublished: orig.pub }).catch(() => undefined);
}
fs.writeFileSync(path.join(SHOTS, 'chu-nhan-sua-ho-so.json'), JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, { ...v, after: undefined, public: v.public ? { boldTags: v.public.boldTags, scriptInMain: v.public.scriptInMain } : null }])), null, 2));
const [back] = await sql(`SELECT "isPublished" pub, tagline t, origin o FROM brands WHERE id=$1`, BRAND);
check('L6-H27', T('Chủ nhãn: sau khi thử, hồ sơ cũ được trả và nhãn gỡ đăng như ban đầu', 'API', 'PATCH /brand/owner/me và PATCH /admin/brands/:id', `isPublished=${orig.pub}; tagline/origin như trước`), pub.ok && back.pub === orig.pub && (back.t ?? '') === (orig.tagline ?? '') && (back.o ?? '') === (orig.origin ?? ''), `đăng nhãn=${pub.status}; sau trả=${short(back)}; trước=${short({ pub: orig.pub, t: orig.tagline, o: orig.origin })}`, 'SQL brands');
await done();
