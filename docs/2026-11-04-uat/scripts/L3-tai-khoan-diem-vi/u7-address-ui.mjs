// U7: Sổ địa chỉ trên giao diện: thêm (điền sẵn tên/SĐT?), kiểm lỗi, sửa, đặt mặc định, xoá. Đối chiếu DB (user_addresses).
import { makeRec, sql, sql1, A, done, SHOTS } from './lib3.mjs';
import { openSurface } from './ui-lib.mjs';
const { rec, check } = makeRec('u7-address-ui');
const J = 'Sổ địa chỉ (giao diện)';
const persona = 'ctv', uid = 'uat_ctv';
const routes = { mini375: '/addresses', web375: '/tai-khoan/dia-chi', web1280: '/tai-khoan/dia-chi' };
const tbl = (await sql1(`SELECT table_name t FROM information_schema.tables WHERE table_name IN ('addresses','user_addresses') LIMIT 1`)).t;
const rows = () => sql(`SELECT id, recipient, phone, street, ward, province, "isDefault" d FROM ${tbl} WHERE "userId"=$1 ORDER BY "isDefault" DESC, id`, uid);
const clearAll = async () => { for (const a of (await rows())) await A(persona, 'DELETE', `/me/addresses/${a.id}`); };

for (const surface of ['mini375', 'web375', 'web1280']) {
  const id = `U7-${surface}`;
  await clearAll();
  const s = await openSurface(surface, persona, routes[surface]);
  const p = s.s.page;
  try {
    await p.getByText('Thêm địa chỉ mới').first().waitFor({ timeout: 30000 });
    const t0 = await p.locator('body').innerText();
    await p.screenshot({ path: `${SHOTS}/addr-0-trong-${surface}.png`, fullPage: true });
    check(`${id}-empty`, persona, surface, J, 'chưa có địa chỉ: màn trống có lời mời thêm địa chỉ', 'addresses.tsx', /chưa có địa chỉ/i.test(t0) && /Thêm địa chỉ mới/.test(t0), `chữ=${t0.replace(/\s+/g, ' ').slice(0, 160)}`);
    await p.getByText('Thêm địa chỉ mới').first().click();
    await p.waitForTimeout(1500);
    // điền sẵn?
    const vals = await p.locator('input[type=text], input:not([type])').evaluateAll((els) => els.filter((e) => e.id !== 'site-search-q').map((e) => e.value));
    const prefilled = vals.slice(0, 2);
    check(`${id}-prefill`, persona, surface, J, 'Thêm địa chỉ đầu tiên: Người nhận / SĐT điền sẵn từ hồ sơ như Mini (web 375 phải giống Mini)', 'apps/miniapp/src/components/address-form.tsx:72-75 (điền sẵn) vs apps/web/src/components/address-form.tsx:43 (rỗng)', prefilled[0] !== '' && prefilled[1] !== '', `điền sẵn=${JSON.stringify(prefilled)}`, `ô nhập=${JSON.stringify(vals)}`);
    // điền
    const inputs = p.locator('input[type=text], input:not([type])').filter({ hasNot: p.locator('#site-search-q') });
    const names = surface === 'mini375' ? null : null;
    const textInputs = await p.locator('input').evaluateAll((els) => els.map((e, i) => ({ i, id: e.id, type: e.type })));
    const real = textInputs.filter((x) => x.id !== 'site-search-q' && (x.type === 'text' || x.type === ''));
    const nth = (k) => p.locator('input').nth(real[k].i);
    await nth(0).fill('Phạm Văn CTV');
    await nth(1).fill('0901000004');
    // địa phương
    if (surface === 'mini375') {
      await p.getByText('Chọn tỉnh/thành', { exact: true }).first().click();
      await p.getByRole('option', { name: 'Thành phố Hồ Chí Minh' }).click();
      await p.waitForTimeout(1200);
      await p.getByText('Chọn phường/xã', { exact: true }).first().click();
      await p.waitForTimeout(800);
      await p.getByRole('option').first().click();
    } else {
      await p.locator('select').nth(0).selectOption({ label: 'Thành phố Hồ Chí Minh' });
      await p.waitForTimeout(1500);
      await p.locator('select').nth(1).selectOption({ index: 1 });
    }
    await p.waitForTimeout(600);
    await nth(2).fill('12 Lê Lợi');
    await p.screenshot({ path: `${SHOTS}/addr-4-da-dien-${surface}.png` });
    await p.getByRole('button', { name: /^Lưu( địa chỉ)?$/ }).click();
    await p.waitForTimeout(2500);
    const r1 = await rows();
    await p.screenshot({ path: `${SHOTS}/addr-5-da-luu-${surface}.png`, fullPage: true });
    check(`${id}-add`, persona, surface, J, 'lưu địa chỉ đầu tiên: có 1 dòng DB, tự là Mặc định, đúng người nhận/SĐT/đường/tỉnh', 'users.service.ts createAddress', r1.length === 1 && r1[0].d === true && r1[0].street === '12 Lê Lợi' && r1[0].province.includes('Hồ Chí Minh') && r1[0].phone === '0901000004', `DB=${JSON.stringify(r1)}`);
    // thêm địa chỉ thứ hai để thử mặc định + xoá
    const a2 = await A(persona, 'POST', '/me/addresses', { recipient: 'Phạm Văn CTV', phone: '0901000004', province: 'Thành phố Hồ Chí Minh', district: '', ward: 'Phường Bến Thành', street: '5 Tràng Tiền', provinceCode: '84_VN79', districtCode: '', wardCode: '84_VN7926743' });
    if (!a2.ok) throw new Error('tạo địa chỉ 2 bằng API lỗi ' + a2.status + ' ' + JSON.stringify(a2.body));
    await s.s.goto(routes[surface]);
    await p.waitForTimeout(2500);
    // sửa địa chỉ 1
    await p.getByRole('button', { name: /^Sửa/ }).first().click().catch(async () => { await p.getByText('Sửa', { exact: true }).first().click(); });
    await p.waitForTimeout(1500);
    const real2 = (await p.locator('input').evaluateAll((els) => els.map((e, i) => ({ i, id: e.id, type: e.type })))).filter((x) => x.id !== 'site-search-q' && (x.type === 'text' || x.type === ''));
    await p.locator('input').nth(real2[2].i).fill('99 Nguyễn Huệ');
    await p.screenshot({ path: `${SHOTS}/addr-6-sua-${surface}.png` });
    await p.getByRole('button', { name: /^(Lưu|Lưu thay đổi)$/ }).click();
    await p.waitForTimeout(2500);
    const r2 = await rows();
    check(`${id}-edit`, persona, surface, J, 'sửa số nhà tên đường: DB đổi đúng dòng, các dòng khác không đổi', 'users.service.ts updateAddress', r2.some((x) => x.street === '99 Nguyễn Huệ') && r2.length === 2, `DB=${JSON.stringify(r2.map((x) => [x.street, x.d]))}`);
    // xoá địa chỉ 2 (không mặc định)
    const target = r2.find((x) => x.street === '5 Tràng Tiền');
    const cards = p.locator('li, [role=listitem], div').filter({ hasText: '5 Tràng Tiền' });
    await p.getByText('5 Tràng Tiền', { exact: false }).first().scrollIntoViewIfNeeded();
    const delBtns = p.getByText('Xoá', { exact: true });
    const n = await delBtns.count();
    // nút Xoá của thẻ thứ hai (thẻ không mặc định): thẻ mặc định đứng đầu
    await delBtns.nth(Math.min(1, n - 1)).click();
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${SHOTS}/addr-7-xac-nhan-xoa-${surface}.png` });
    const confirmTxt = await p.locator('body').innerText();
    await p.getByRole('button', { name: /^Xoá$|^Xoá địa chỉ$/ }).last().click();
    await p.waitForTimeout(2500);
    const r3 = await rows();
    check(`${id}-delete`, persona, surface, J, 'xoá địa chỉ qua hộp xác nhận "Xoá địa chỉ này?": mất đúng 1 dòng, địa chỉ mặc định còn', 'addresses.tsx confirmDel; users.service.ts deleteAddress', /Xoá địa chỉ này\?/.test(confirmTxt) && r3.length === 1 && r3[0].street === '99 Nguyễn Huệ', `hộp xác nhận=${/Xoá địa chỉ này\?/.test(confirmTxt)} DB=${JSON.stringify(r3.map((x) => [x.street, x.d]))}`);
  } catch (e) {
    rec(id, persona, surface, J, 'luồng sổ địa chỉ', '', String(e).slice(0, 400), String(e).slice(0, 400), 'FAIL');
    await p.screenshot({ path: `${SHOTS}/addr-loi-${surface}.png` }).catch(() => {});
  }
  await s.s.close();
}
await done();
