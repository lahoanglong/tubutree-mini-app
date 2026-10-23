#!/usr/bin/env node
// U3-38..U3-40: quầy đổi rác ở đại lý (điểm PARTNER, chủ điểm = uat_dealer). Luật đã chốt 2026-10-19: hộp sữa và vỏ chai Tubu
// chỉ kho HCMC nhận; đại lý chỉ nhận thùng carton + nilon chống sốc.
// Bật waste.enabled trong lượt chạy rồi trả lại giá trị cũ. Cần 05-hang-doi-tac-link.mjs chạy trước (uat_dealer có gian hàng đối tác).
// Dùng: node 06-quay-doi-rac-dai-ly.mjs
import {
  L, api, apiOk, closeDb, ensureUser, log, openMini, recorder, short, shot, sql,
} from './u3lib.mjs';

const R = recorder('06-quay-doi-rac-dai-ly');
const RUN = Date.now().toString(36).slice(-5);
const D = 'uat_dealer';
const OK_ITEMS = ['wi-carton', 'wi-bubble-wrap'];
let mini;
let prevEnabled;
try {
  prevEnabled = (await sql(`SELECT value::text v FROM system_configs WHERE key = 'waste.enabled'`))[0]?.v;
  await apiOk(L, 'PUT', '/admin/config', { user: 'uat_admin', body: { key: 'waste.enabled', value: true } });
  await apiOk(L, 'GET', '/merchant/store', { user: D });

  const point = await apiOk(L, 'POST', '/admin/waste/points', {
    user: 'uat_admin',
    body: {
      kind: 'PARTNER', name: `Quầy đại lý UAT ${RUN}`, addressLine: '12 Lê Lợi', provinceCode: '84_VN79', provinceName: 'Thành phố Hồ Chí Minh',
      communeCode: '84_VN7926743', communeName: 'Phường Sài Gòn', phone: '0901000006', monthlyQuotaPoints: 200_000, itemIds: OK_ITEMS,
    },
  });
  const staff = await api(L, 'POST', `/admin/waste/points/${point.id}/staff`, { user: 'uat_admin', body: { userId: D, role: 'OWNER' } });
  const act = await api(L, 'PATCH', `/admin/waste/points/${point.id}`, { user: 'uat_admin', body: { status: 'ACTIVE' } });
  log('điểm', point.id, staff.status, short(staff.body, 200), act.status, short(act.body, 200));

  // ---------- U3-38 admin tick hộp sữa / vỏ chai ở điểm đại lý ----------
  const bad = await api(L, 'PATCH', `/admin/waste/points/${point.id}`, { user: 'uat_admin', body: { itemIds: [...OK_ITEMS, 'wi-milk-carton', 'wi-tubu-bottle'] } });
  const items38 = (await sql(`SELECT "itemId" FROM waste_point_items WHERE "pointId" = $1 ORDER BY "itemId"`, point.id)).map((x) => x.itemId);
  const revert = await api(L, 'PATCH', `/admin/waste/points/${point.id}`, { user: 'uat_admin', body: { itemIds: OK_ITEMS } });
  const items38b = (await sql(`SELECT "itemId" FROM waste_point_items WHERE "pointId" = $1 ORDER BY "itemId"`, point.id)).map((x) => x.itemId);
  R.add({
    id: 'U3-38', role: 'ADMIN', journey: 'Quầy đại lý chỉ nhận carton + nilon', title: 'ADMIN thêm "Vỏ hộp sữa sạch" + "Vỏ chai, hộp Tubu Tree" vào điểm PARTNER',
    steps: `PATCH /admin/waste/points/${point.id} itemIds=[wi-carton, wi-bubble-wrap, wi-milk-carton, wi-tubu-bottle]`,
    expected: 'Luật đã chốt: hai món này chỉ kho HCMC nhận → API 400 khi kind=PARTNER, danh sách món của điểm không đổi',
    actual: { status: bad.status, body: bad.body?.message, itemsAfter: items38, revert: revert.status, itemsReverted: items38b },
    evidence: `HTTP ${bad.status}; SQL waste_point_items ${short(items38)} (sau khi trả lại: ${short(items38b)})`,
    status: bad.status === 400 && !items38.includes('wi-milk-carton') ? 'PASS' : 'FAIL',
    data: { knownId: 'D13-01' },
  });

  // ---------- U3-39 khách gửi hộp sữa / vỏ chai tới quầy đại lý ----------
  const C = `uat_u3wst${RUN}`;
  await ensureUser(C, { phone: `0904${String(Date.now()).slice(-6)}` });
  let seq = 0;
  const mk = (lines) =>
    api(L, 'POST', '/waste/requests', { user: C, headers: { 'idempotency-key': `u3-waste-${RUN}-${++seq}` }, body: { method: 'DROP_OFF', pointId: point.id, consent: true, lines } });
  const milk = await mk([{ itemId: 'wi-milk-carton', declaredQty: 10 }]);
  const bottle = await mk([{ itemId: 'wi-tubu-bottle', declaredQty: 2 }]);
  const reqCount = (await sql(`SELECT count(*)::int n FROM waste_requests WHERE "userId" = $1`, C))[0].n;
  const pts = await apiOk(L, 'GET', '/waste/points?provinceCode=84_VN79', { user: C });
  const pRow = (Array.isArray(pts) ? pts : pts.items ?? []).find((x) => x.id === point.id);
  R.add({
    id: 'U3-39', role: 'Khách', journey: 'Quầy đại lý chỉ nhận carton + nilon', title: 'Khách tạo yêu cầu DROP_OFF hộp sữa / vỏ chai ở quầy đại lý',
    steps: `POST /waste/requests DROP_OFF pointId=${point.id} lines=[wi-milk-carton×10] rồi [wi-tubu-bottle×2]; GET /waste/points`,
    expected: 'Cả hai bị từ chối (4xx, "Điểm nhận này không nhận: <tên món>"), không tạo waste_requests; danh sách điểm công khai chỉ nêu wi-carton, wi-bubble-wrap',
    actual: { milk: [milk.status, milk.body?.message], bottle: [bottle.status, bottle.body?.message], wasteRequests: reqCount, accepted: pRow?.acceptedItemIds },
    evidence: `HTTP ${milk.status} ${short(milk.body, 220)}; HTTP ${bottle.status} ${short(bottle.body, 160)}; SQL waste_requests của khách ${reqCount}; GET /waste/points acceptedItemIds ${short(pRow?.acceptedItemIds)}`,
    status: milk.status >= 400 && milk.status < 500 && /không nhận: Vỏ hộp sữa/.test(milk.body?.message ?? '') && bottle.status >= 400 && bottle.status < 500 && /không nhận: Vỏ chai/.test(bottle.body?.message ?? '') && reqCount === 0 && JSON.stringify([...(pRow?.acceptedItemIds ?? [])].sort()) === JSON.stringify([...OK_ITEMS].sort()) ? 'PASS' : 'FAIL',
  });

  // ---------- U3-40 quầy đại lý nhận carton + nilon, Tubu cộng Điểm Xanh ----------
  const okReq = await mk([{ itemId: 'wi-carton', declaredQty: 3 }, { itemId: 'wi-bubble-wrap', declaredQty: 2 }]);
  const req = okReq.body;
  const bal0 = (await sql(`SELECT "pointsBalance" b FROM users WHERE id = $1`, C))[0].b;
  mini = await openMini(D, { path: '/recycle/desk' });
  const p = mini.page;
  await p.getByLabel('Mã yêu cầu hoặc mã nhận quà').waitFor({ timeout: 30_000 });
  await p.getByLabel('Mã yêu cầu hoặc mã nhận quà').fill(req.code);
  await p.getByRole('button', { name: 'Tra mã' }).click();
  await p.getByRole('button', { name: 'Xác nhận đã nhận' }).waitFor({ timeout: 20_000 });
  const s40a = await shot(p, 'U3-40-quay-dai-ly-tra-ma');
  const conf = p.waitForResponse((r) => /\/api\/waste\/desk\/requests\/[^/]+\/confirm$/.test(new URL(r.url()).pathname), { timeout: 20_000 });
  await p.getByRole('button', { name: 'Xác nhận đã nhận' }).click();
  const cr = await conf;
  await p.waitForTimeout(1200);
  const s40b = await shot(p, 'U3-40-quay-dai-ly-da-nhan');
  await mini.close();
  mini = null;
  const wr = (await sql(`SELECT status::text, "estimatedPoints" est, "pointsAwarded" got FROM waste_requests WHERE id = $1`, req.id))[0];
  const led = await sql(`SELECT delta::int, "refType", "refId" FROM points_transactions WHERE "userId" = $1 AND "refType" = 'RECYCLE'`, C);
  const bal1 = (await sql(`SELECT "pointsBalance" b, (SELECT COALESCE(SUM(delta),0)::int FROM points_transactions WHERE "userId" = $1) led FROM users WHERE id = $1`, C))[0];
  const expect = 3 * 1000 + 2 * 1000;
  R.add({
    id: 'U3-40', role: 'Đại lý (quầy) / khách', journey: 'Quầy đại lý nhận carton + nilon', title: 'Khách hẹn 3 thùng carton + 2 nilon; đại lý tra mã và "Xác nhận đã nhận"',
    steps: `POST /waste/requests DROP_OFF (khách ${C}) → Mini App uat_dealer /recycle/desk → "Mã yêu cầu hoặc mã nhận quà" = ${req.code} → "Tra mã" → "Xác nhận đã nhận"`,
    expected: `Yêu cầu 201; confirm 2xx; waste_requests COMPLETED, pointsAwarded = ${expect} (1 món = 1.000 điểm); points_transactions RECYCLE +${expect}; pointsBalance = SUM sổ`,
    actual: { create: okReq.status, code: req.code, confirm: cr.status(), wr, led, bal: [bal0, bal1] },
    evidence: `${s40a}, ${s40b}; HTTP tạo ${okReq.status}, xác nhận ${cr.status()}; SQL waste_requests ${short(wr)}; points_transactions ${short(led)}; pointsBalance ${bal0}→${bal1.b}, SUM sổ ${bal1.led}`,
    status: okReq.status === 201 && cr.status() < 300 && wr.status === 'COMPLETED' && wr.got === expect && led.length === 1 && led[0].delta === expect && bal1.b === bal0 + expect && bal1.b === bal1.led ? 'PASS' : 'FAIL',
  });
} catch (e) {
  console.error(e);
  R.add({ id: 'U3-38..40', title: 'script lỗi', actual: String(e?.message ?? e).slice(0, 600), status: 'BLOCKED' });
} finally {
  await mini?.close().catch(() => undefined);
  if (prevEnabled !== undefined) await api(L, 'PUT', '/admin/config', { user: 'uat_admin', body: { key: 'waste.enabled', value: JSON.parse(prevEnabled) } }).catch(() => undefined);
  R.save();
  await closeDb();
}
