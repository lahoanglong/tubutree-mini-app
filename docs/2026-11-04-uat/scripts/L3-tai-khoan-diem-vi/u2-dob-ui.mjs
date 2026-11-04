// U2: nhập ngày sinh trên giao diện (Mini 375, web 375, web 1280), xác nhận, đối chiếu SQL (giờ VN, 00:00 UTC cùng ngày), ô bị khoá sau khi đặt.
import { makeRec, sql1, A, done, SHOTS } from './lib3.mjs';
import { openSurface } from './ui-lib.mjs';
const { rec, check } = makeRec('u2-dob-ui');
const J = 'Hồ sơ: ngày sinh trên giao diện';
const plan = [
  ['mini375', 'returning', '/edit-profile', '15/08/1990', '1990-08-15'],
  ['web375', 'new', '/tai-khoan/ho-so', '31/12/1999', '1999-12-31'],
  ['web1280', 'ctv', '/tai-khoan/ho-so', '01/01/2001', '2001-01-01'],
];
for (const [surface, persona, route, typed, iso] of plan) {
  const id = `U2-${surface}`;
  const sess = await openSurface(surface, persona, route);
  const p = sess.s.page;
  try {
    await p.waitForSelector('input[placeholder="dd/mm/yyyy"]', { timeout: 30000 });
    await p.screenshot({ path: `${SHOTS}/dob-1-trong-${surface}.png` });
    await p.fill('input[placeholder="dd/mm/yyyy"]', '');
    await p.locator('input[placeholder="dd/mm/yyyy"]').pressSequentially(typed.replace(/\//g, ''), { delay: 60 });
    const shown = await p.inputValue('input[placeholder="dd/mm/yyyy"]');
    await p.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await p.waitForTimeout(600);
    const dialog = await p.getByRole('alertdialog').innerText().catch(() => null);
    await p.screenshot({ path: `${SHOTS}/dob-2-xac-nhan-${surface}.png` });
    await p.getByRole('button', { name: 'Xác nhận' }).click();
    await p.waitForTimeout(2000);
    const row = await sql1(`SELECT dob::text d FROM users WHERE id=$1`, `uat_${persona}`);
    const api = (await A(persona, 'GET', '/me')).body.dob;
    check(id, persona, surface, J, `gõ ${typed} -> hộp xác nhận -> Xác nhận: lưu đúng ${iso}, không lệch múi giờ`, 'users.service.ts updateMe; dob-input.ts', row.d.startsWith(iso) && api === iso && /chỉ đặt được một lần/.test(dialog ?? ''), `ô hiện "${shown}"; hộp="${dialog}"; SQL dob=${row.d}; GET /me.dob=${api}; ảnh dob-2-xac-nhan-${surface}.png`);
    // mở lại: ô bị khoá, chữ giải thích
    await sess.s.goto(route);
    await p.waitForTimeout(1200);
    const ro = await p.evaluate(() => { const i = [...document.querySelectorAll('input')].find((x) => /^\d{2}\/\d{2}\/\d{4}$/.test(x.value)); return i ? { value: i.value, readOnly: i.readOnly } : null; });
    const hint = await p.locator('text=Ngày sinh chỉ đặt được một lần').count();
    await p.screenshot({ path: `${SHOTS}/dob-3-da-khoa-${surface}.png` });
    check(`${id}b`, persona, surface, J, 'mở lại hồ sơ: ngày sinh hiện dd/mm/yyyy, chỉ đọc, có chữ "chỉ đặt được một lần, ... liên hệ CSKH"', 'edit-profile.tsx dobEditable', ro?.readOnly === true && ro.value === typed && hint > 0, `ô=${JSON.stringify(ro)} hint=${hint}`);
  } catch (e) {
    rec(id, persona, surface, J, 'nhập ngày sinh', '', String(e).slice(0, 300), String(e).slice(0, 300), 'FAIL');
  }
  await sess.s.close();
}
await done();
