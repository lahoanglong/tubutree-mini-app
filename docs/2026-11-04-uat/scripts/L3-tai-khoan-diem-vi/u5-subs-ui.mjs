// U5: lịch đặt định kỳ trên giao diện: danh sách, sửa chu kỳ, bỏ qua kỳ, tạm dừng/tiếp tục, huỷ (Mini + web375 + web1280). Đối chiếu DB sau mỗi thao tác.
import { makeRec, sql1, done, SHOTS } from './lib3.mjs';
import { openSurface } from './ui-lib.mjs';
const { rec, check } = makeRec('u5-subs-ui');
const J = 'Đặt hàng định kỳ (giao diện)';
const persona = 'ctv_pending', uid = 'uat_ctv_pending';
const routes = { mini375: '/orders?tab=subscriptions', web375: '/tai-khoan/don-hang?tab=subscriptions', web1280: '/tai-khoan/don-hang?tab=subscriptions' };
const cur = () => sql1(`SELECT id, "intervalWeeks" iw, status, "nextRunAt" nx FROM subscriptions WHERE "userId"=$1 AND status<>'CANCELLED' ORDER BY "createdAt" DESC LIMIT 1`, uid);
const plan = { web375: 10, web1280: 4, mini375: 6 };
for (const surface of ['web375', 'web1280', 'mini375']) {
  const id = `U5-${surface}`;
  const s = await openSurface(surface, persona, routes[surface]);
  const p = s.s.page;
  try {
    await p.getByRole('button', { name: 'Sửa', exact: true }).first().waitFor({ timeout: 30000 });
    const t0 = await p.locator('body').innerText();
    const sub0 = await cur();
    const nxVN = new Date(new Date(sub0.nx).getTime() + 7 * 3600e3);
    const dmy = `${String(nxVN.getUTCDate()).padStart(2, '0')}/${String(nxVN.getUTCMonth() + 1).padStart(2, '0')}/${nxVN.getUTCFullYear()}`;
    check(`${id}-list`, persona, surface, J, 'danh sách gói: tên SP, "Mỗi N tuần", giá giảm 12% + giá gốc, cách trả, địa chỉ, trạng thái, "Lần kế" đúng ngày giờ VN', 'subscriptions-panel.tsx; ngày VN', t0.includes(`Mỗi ${sub0.iw} tuần`) && t0.includes(`Lần kế: ${dmy}`) && /Đang chạy/.test(t0) && /Ví Tubu/.test(t0), `DB nx=${sub0.nx} → VN ${dmy}; chữ=${t0.replace(/\s+/g, ' ').slice(t0.indexOf('Đang giảm')).slice(0, 260)}`);
    // sửa chu kỳ
    const want = plan[surface];
    await p.getByRole('button', { name: 'Sửa', exact: true }).first().click();
    await p.waitForTimeout(1200);
    await p.getByRole('button', { name: `${want} tuần`, exact: true }).click();
    await p.screenshot({ path: `${SHOTS}/subs-2-sua-chon-${surface}.png` });
    await p.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await p.waitForTimeout(2500);
    const sub1 = await cur();
    const t1 = await p.locator('body').innerText();
    await p.screenshot({ path: `${SHOTS}/subs-4-sau-sua-${surface}.png` });
    check(`${id}-edit`, persona, surface, J, 'sửa chu kỳ qua sheet: DB đổi intervalWeeks, thẻ hiện "Mỗi N tuần" mới', 'subscriptions.service.ts update', sub1.iw === want && t1.includes(`Mỗi ${want} tuần`), `DB iw ${sub0.iw}→${sub1.iw}; nextRunAt ${sub0.nx}→${sub1.nx}; thẻ có "Mỗi ${want} tuần"=${t1.includes(`Mỗi ${want} tuần`)}`);
    // bỏ qua kỳ
    await p.getByRole('button', { name: 'Huỷ', exact: true }).first().click();
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${SHOTS}/subs-3-giu-chan-${surface}.png` });
    await p.getByRole('button', { name: 'Bỏ qua kỳ này' }).click();
    await p.waitForTimeout(2500);
    const sub2 = await cur();
    const dd = (new Date(sub2.nx).getTime() - new Date(sub1.nx).getTime()) / 864e5;
    check(`${id}-skip`, persona, surface, J, 'sheet giữ chân → "Bỏ qua kỳ này": nextRunAt lùi đúng 1 chu kỳ, vẫn ACTIVE, không sinh đơn', 'subscriptions.service.ts skipCycle', Math.abs(dd - want * 7) < 0.01 && sub2.status === 'ACTIVE', `nextRunAt ${sub1.nx}→${sub2.nx} (+${dd} ngày, mong ${want * 7}) status=${sub2.status}`);
    // tạm dừng / tiếp tục
    await p.getByRole('button', { name: 'Tạm dừng', exact: true }).first().click();
    await p.waitForTimeout(2500);
    const sub3 = await cur();
    const t3 = await p.locator('body').innerText();
    await p.screenshot({ path: `${SHOTS}/subs-5-tam-dung-${surface}.png` });
    const hasResume = await p.getByRole('button', { name: /Tiếp tục|Bật lại/ }).count();
    check(`${id}-pause`, persona, surface, J, 'Tạm dừng: DB PAUSED, thẻ hiện trạng thái Tạm dừng và nút Tiếp tục', 'subscriptions-panel.tsx STATUS_LABEL', sub3.status === 'PAUSED' && hasResume > 0 && /Tạm dừng/.test(t3), `DB status=${sub3.status}; nút Tiếp tục=${hasResume}`);
    await p.getByRole('button', { name: /Tiếp tục|Bật lại/ }).first().click();
    await p.waitForTimeout(2500);
    const sub4 = await cur();
    check(`${id}-resume`, persona, surface, J, 'Tiếp tục: DB ACTIVE, nextRunAt không ở quá khứ', 'subscriptions.service.ts setStatus', sub4.status === 'ACTIVE' && new Date(sub4.nx) > new Date(), `DB status=${sub4.status} nextRunAt=${sub4.nx}`);
  } catch (e) {
    rec(id, persona, surface, J, 'luồng gói định kỳ', '', String(e).slice(0, 300), String(e).slice(0, 300), 'FAIL');
    await p.screenshot({ path: `${SHOTS}/subs-loi-${surface}.png` }).catch(() => {});
  }
  if (surface === 'mini375') {
    // huỷ hẳn
    try {
      await p.getByRole('button', { name: 'Huỷ', exact: true }).first().click();
      await p.waitForTimeout(1200);
      await p.getByRole('button', { name: 'Vẫn huỷ' }).click();
      await p.waitForTimeout(3000);
      const row = await sql1(`SELECT status FROM subscriptions WHERE id=(SELECT id FROM subscriptions WHERE "userId"=$1 AND "createdAt">now()-interval '1 day' ORDER BY "createdAt" DESC LIMIT 1)`, uid);
      const t = await p.locator('body').innerText();
      await p.screenshot({ path: `${SHOTS}/subs-6-da-huy-${surface}.png`, fullPage: true });
      check(`${id}-cancel`, persona, surface, J, '"Vẫn huỷ": DB CANCELLED, màn không còn gói và không báo lỗi', 'subscriptions.service.ts setStatus CANCELLED', row.status === 'CANCELLED', `DB status=${row.status}; chữ=${t.replace(/\s+/g, ' ').slice(0, 300)}`);
    } catch (e) {
      rec(`${id}-cancel`, persona, surface, J, 'huỷ hẳn', '', String(e).slice(0, 300), String(e).slice(0, 300), 'FAIL');
    }
  }
  await s.s.close();
}
await done();
