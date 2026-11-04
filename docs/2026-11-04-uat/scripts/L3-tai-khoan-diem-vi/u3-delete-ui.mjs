// U3: Xoá tài khoản trên giao diện khi Ví còn tiền: chữ cảnh báo, ô đồng ý, nút khoá tới khi tick, body gửi đi có đồng ý đúng số dư.
import { makeRec, sql, sql1, A, done, SHOTS, walletLedger } from './lib3.mjs';
import { openSurface } from './ui-lib.mjs';
const { rec, check } = makeRec('u3-delete-ui');
const J = 'Xoá tài khoản trên giao diện';
const persona = 'returning', uid = 'uat_returning';
for (const [surface, route] of [['mini375', '/settings'], ['web375', '/tai-khoan/cai-dat'], ['web1280', '/tai-khoan/cai-dat']]) {
  const id = `U3-${surface}`;
  await sql(`UPDATE account_deletion_requests SET status='RESOLVED', "adminNote"='UAT: đóng tay để thử lại' WHERE "userId"=$1 AND status='PENDING' RETURNING id`, uid);
  const sess = await openSurface(surface, persona, route);
  const p = sess.s.page;
  try {
    await p.getByText('Xoá tài khoản', { exact: true }).first().waitFor({ timeout: 30000 });
    await p.getByText('Xoá tài khoản', { exact: true }).first().click();
    await p.waitForTimeout(1500);
    const dlg = await p.locator('body').innerText();
    await p.screenshot({ path: `${SHOTS}/xoa-1-canh-bao-${surface}.png` });
    const bal = (await walletLedger(uid)).bal;
    const hasNotice = new RegExp(`Ví Tubu còn ${bal.toLocaleString('vi-VN')}đ`).test(dlg) && /không hoàn lại/.test(dlg);
    const submit = p.getByRole('button', { name: 'Gửi yêu cầu xoá' });
    const disabledBefore = await submit.isDisabled();
    const reqs = [];
    p.on('request', (r) => { if (r.url().includes('/deletion-request')) reqs.push(r.postData()); });
    await p.getByRole('checkbox').first().check().catch(async () => { await p.getByText('Tôi đồng ý bỏ số dư').first().click(); });
    await p.waitForTimeout(400);
    const disabledAfter = await submit.isDisabled();
    await p.screenshot({ path: `${SHOTS}/xoa-2-da-tick-${surface}.png` });
    check(`${id}a`, persona, surface, J, 'ví còn tiền: hộp xoá hiện số dư + "không hoàn lại"; nút Gửi yêu cầu xoá khoá tới khi tick đồng ý', 'account-deletion-copy.ts canSubmitDeletion', hasNotice && disabledBefore && !disabledAfter, `ví=${bal} hasNotice=${hasNotice} nút khoá trước tick=${disabledBefore} sau tick=${disabledAfter}`);
    await submit.click();
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${SHOTS}/xoa-3-da-gui-${surface}.png` });
    const body = JSON.parse(reqs[0] ?? '{}');
    const row = await sql1(`SELECT status, "walletForfeitAmount"::int fa FROM account_deletion_requests WHERE "userId"=$1 AND status='PENDING'`, uid);
    const after = await p.locator('body').innerText();
    check(`${id}b`, persona, surface, J, 'bấm Gửi: body có acknowledgedWalletBalance = số dư + acceptWalletForfeit; DB có yêu cầu PENDING; tài khoản chưa xoá', 'users.service.ts; account-deletion-copy.ts walletForfeitConsent', body.acknowledgedWalletBalance === bal && body.acceptWalletForfeit === true && row?.fa === bal, `body=${JSON.stringify(body)} SQL=${JSON.stringify(row)} chữ sau gửi: "${after.split('\n').filter((l) => /yêu cầu|CHƯA|xoá/i.test(l)).slice(0, 4).join(' | ')}"`);
  } catch (e) {
    rec(id, persona, surface, J, 'Xoá tài khoản', '', String(e).slice(0, 300), String(e).slice(0, 300), 'FAIL');
    await p.screenshot({ path: `${SHOTS}/xoa-loi-${surface}.png` }).catch(() => {});
  }
  await sess.s.close();
}
// Ví 0đ: không có cảnh báo ví
await sql(`UPDATE account_deletion_requests SET status='RESOLVED' WHERE "userId"='uat_ctv' AND status='PENDING' RETURNING id`);
const s2 = await openSurface('mini375', 'ctv', '/settings');
const p2 = s2.s.page;
await p2.getByText('Xoá tài khoản', { exact: true }).first().click();
await p2.waitForTimeout(1500);
const t2 = await p2.locator('body').innerText();
await p2.screenshot({ path: `${SHOTS}/xoa-4-vi-0d-mini375.png` });
const submit2 = p2.getByRole('button', { name: 'Gửi yêu cầu xoá' });
check('U3-vi0', 'ctv', 'mini375', J, 'ví 0đ: không có cảnh báo ví / ô đồng ý, nút Gửi dùng được ngay', 'canSubmitDeletion(0,false)=true', !/Ví Tubu còn/.test(t2) && !(await submit2.isDisabled()), `có chữ ví=${/Ví Tubu còn/.test(t2)} nút khoá=${await submit2.isDisabled()}`);
await s2.s.close();
await done();
