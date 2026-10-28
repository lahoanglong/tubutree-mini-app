// Luồng 4: Điểm Xanh, hạng, đổi quà/nhận mã, Vườn Xanh tưới cây, điểm danh hôm nay (persona returning), đi từ thẻ điểm ở trang chủ.
// Thiết lập (SQL trên DB lane 6): xoá điểm danh + dữ liệu Vườn Xanh của returning, nạp điểm để số dư = 60.000 (ghi một dòng sổ UAT_TOPUP).
// Lưu ý: lane 6 dùng chung với agent luồng web; nếu họ cũng chạy persona returning cùng lúc thì số liệu có thể lệch.
import { Flow, run, sql, sqlTry } from './_lib.mjs';

const U = `'uat_returning'`;
for (const t of ['game_water_events', 'planted_trees', 'garden_plots', 'game_spins', 'game_quiz_attempts', 'game_profiles', 'loyalty_check_ins']) {
  const r = sqlTry(`DELETE FROM ${t} WHERE "userId"=${U}`);
  if (typeof r === 'string') console.log(t, r);
}
sqlTry(`DELETE FROM points_transactions WHERE "userId"=${U} AND (reason LIKE 'DAILY_CHECKIN%' OR reason LIKE 'GAME_%' OR reason='UAT_TOPUP' OR reason LIKE 'LOYALTY_REDEEM%')`);
const cur = sql(`SELECT COALESCE(SUM(delta),0)::int AS b FROM points_transactions WHERE "userId"=${U}`)[0].b;
if (cur < 60000) {
  sql(`INSERT INTO points_transactions (id, "userId", delta, reason, lot, "createdAt", "expiresAt") VALUES ('uat_topup_${Date.now()}', ${U}, ${60000 - cur}, 'UAT_TOPUP', 'STANDARD', now(), now() + interval '300 days')`);
}
sql(`UPDATE users SET "pointsBalance"=(SELECT COALESCE(SUM(delta),0) FROM points_transactions WHERE "userId"=${U}) WHERE id=${U}`);
console.log('số dư lúc bắt đầu', sql(`SELECT "pointsBalance"::int AS b FROM users WHERE id=${U}`)[0].b);

const f = await Flow.start('4-diem-xanh-hang-vuon-diem-danh', 'returning');
await run(f, async () => {
  const p = f.page;
  await f.step('Trang chủ: thẻ điểm, hạng, tiến độ', null, { note: 'trang chủ khách quay lại có sẵn điểm, hạng, tiến độ, nút Điểm danh và Đổi quà' });
  await f.step('Điểm danh hôm nay (nút ở trang chủ)', () => f.tapLoc(p.getByRole('button', { name: /^(Đã )?[Đđ]iểm danh/ }).first(), 'Điểm danh (trang chủ)'), { note: 'một lần bấm nhận điểm + giọt nước' });
  await f.step('Chạm Đổi quà', () => f.tap(/^Đổi quà/, { nth: 0 }));
  await f.step('Kho quà: xem các mã đổi được', null);
  await f.step('Chạm Đổi ở mã đầu tiên đủ điểm', async () => {
    const btn = p.getByRole('button', { name: 'Đổi', exact: true }).first();
    await f.tapLoc(btn, 'Đổi (mã giảm giá đầu tiên)');
  });
  const dlg = await p.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 400));
  f.note('Sau chạm Đổi: ' + dlg);
  const confirm = p.getByRole('button', { name: /^Xác nhận đổi$/ });
  if (await confirm.count()) await f.step('Xác nhận đổi', () => f.tapLoc(confirm.first(), 'Xác nhận đổi'));
  await f.step('Sau khi đổi: số dư điểm và mã nhận được', null);
  await f.step('Chạm Xem ví mã', () => f.tap('Xem ví mã'));
  await f.step('Ví mã: mã vừa nhận', null);
  await f.step('Chạm tab Vườn Xanh', () => f.tap('Vườn Xanh', { nth: 0 }));
  await f.step('Vườn Xanh sau khi điểm danh ở trang chủ', null, { note: 'điểm danh ở trang chủ có tính sang Vườn Xanh không' });
  const water = p.getByRole('button', { name: /^Tưới/ });
  if (await water.count()) {
    await f.step('Tưới cây', () => f.tapLoc(water.first(), 'Tưới cây'));
    await f.step('Sau khi tưới: màn thu hoạch', null, { note: 'tưới hết nước thì cây lớn và thu hoạch ngay' });
    if (await p.getByRole('button', { name: 'Tuyệt vời!' }).count()) await f.step('Đóng màn thu hoạch (Tuyệt vời!)', () => f.tap('Tuyệt vời!'));
  } else {
    f.note('Không có nút Tưới trên màn Vườn Xanh hôm nay');
  }
  const ck = p.getByRole('button', { name: /^Điểm danh/ });
  f.note('Nút điểm danh trong Vườn Xanh hiện: ' + ((await ck.allTextContents()).join(' / ') || 'không thấy'));
  await f.step('Chạm tab Vườn (cây đã trồng)', () => f.tapLoc(p.getByText('Vườn', { exact: true }).first(), 'tab Vườn'));
});
