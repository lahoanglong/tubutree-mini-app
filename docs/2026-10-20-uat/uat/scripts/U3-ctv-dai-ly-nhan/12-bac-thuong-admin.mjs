#!/usr/bin/env node
// U3-52 (ca mới, 2026-10-22 tối): admin đổi bậc thưởng quý đại lý trên web admin thật (gói q8-bac-admin, Q8b).
// Cần lane 3 --web và 04-dai-ly.mjs đã chạy (có bản chụp bảng bậc Q3/2026). Dùng: node 12-bac-thuong-admin.mjs
import { L, closeDb, exec, log, openMini, openWeb, recorder, shot, short, sql } from './u3lib.mjs';

const R = recorder('12-bac-thuong-admin');
const KEY = 'dealer.quarterly_bonus_tiers';
const QUARTER = 'Q3/2026';
const D = 'uat_dealer';
const cfgRow = async () => (await sql(`SELECT value, "updatedBy" FROM system_configs WHERE key = $1`, KEY))[0];
const histCount = async () => (await sql(`SELECT count(*)::int n FROM system_config_history WHERE key = $1`, KEY))[0].n;
const snapshot = async () => (await sql(`SELECT tiers FROM dealer_quarter_bonus_tiers WHERE quarter = $1`, QUARTER))[0]?.tiers ?? null;

let web;
let mini;
let orig;
try {
  orig = await cfgRow();
  const snap0 = await snapshot();
  if (!snap0) throw new Error(`chưa có bản chụp bảng bậc ${QUARTER}: chạy 04-dai-ly.mjs trước`);
  const h0 = await histCount();
  log('giá trị gốc', orig);

  web = await openWeb('admin', { width: 1440, path: '/admin?tab=config' });
  const p = web.page;
  const puts = [];
  p.on('response', async (r) => {
    if (r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/admin/config')) {
      puts.push({ status: r.status(), req: r.request().postData(), body: (await r.text().catch(() => '')).slice(0, 400) });
    }
  });
  const input = p.getByLabel(KEY, { exact: true });
  await input.waitFor({ timeout: 90_000 });
  await input.scrollIntoViewIfNeeded();
  const item = input.locator('xpath=ancestor::div[contains(@class,"rounded-card")][1]');
  const saveBtn = item.getByRole('button', { name: 'Lưu', exact: true });
  const errBox = item.locator('div.text-danger-fg');
  const shown = await input.inputValue();
  log('ô hiện', shown);

  const tryBad = async (value) => {
    const n = puts.length;
    await input.fill(JSON.stringify(value));
    await saveBtn.click();
    // Khoá tiền: hộp xác nhận hiện trước khi gọi API; với giá trị sai API từ chối sau khi xác nhận.
    const dlg = p.getByRole('button', { name: 'Lưu thay đổi', exact: true });
    await dlg.waitFor({ timeout: 8000 }).then(() => dlg.click()).catch(() => undefined);
    await errBox.waitFor({ timeout: 15_000 }).catch(() => undefined);
    await p.waitForTimeout(500);
    return { put: puts[n], err: (await errBox.first().textContent().catch(() => null)) ?? null };
  };

  // (a) bảng % giảm dần
  const a = await tryBad([{ min: 50_000_000, pct: 4 }, { min: 100_000_000, pct: 2 }]);
  const sa = await shot(p, 'U3-52a-pct-giam-bi-tu-choi');
  const rowA = await cfgRow();
  const okA = a.put?.status === 400 && !!a.err && /bậc|thấp hơn|cao hơn/.test(a.err) && JSON.stringify(rowA.value) === JSON.stringify(orig.value);
  R.add({
    id: 'U3-52a', role: 'ADMIN', journey: 'Cấu hình bậc thưởng quý (web admin)', title: 'Bảng % giảm dần bị từ chối bằng câu tiếng Việt, DB không đổi',
    steps: `web admin /admin?tab=config, ô ${KEY} nhập [{50tr,4},{100tr,2}], bấm Lưu (hộp xác nhận → Lưu thay đổi)`,
    expected: 'PUT /admin/config 400; ô báo lỗi ghi bậc sau không được thấp hơn bậc trước; system_configs không đổi',
    actual: { put: a.put, err: a.err, dbUnchanged: JSON.stringify(rowA.value) === JSON.stringify(orig.value) },
    evidence: `${sa}; PUT ${short(a.put)}; chữ lỗi "${a.err}"; SQL system_configs.value ${short(rowA.value)}`,
    status: okA ? 'PASS' : 'FAIL',
  });

  // (b) pct 2 chữ số lẻ
  const b = await tryBad([{ min: 50_000_000, pct: 2.55 }]);
  const sb = await shot(p, 'U3-52b-pct-hai-so-le-bi-tu-choi');
  const rowB = await cfgRow();
  const okB = b.put?.status === 400 && !!b.err && /1 chữ số thập phân/.test(b.err) && JSON.stringify(rowB.value) === JSON.stringify(orig.value);
  R.add({
    id: 'U3-52b', role: 'ADMIN', journey: 'Cấu hình bậc thưởng quý (web admin)', title: 'pct 2,55 (2 chữ số lẻ) bị từ chối bằng câu tiếng Việt, DB không đổi',
    steps: `ô ${KEY} nhập [{50tr,2.55}], bấm Lưu`,
    expected: 'PUT 400; câu "chỉ được tối đa 1 chữ số thập phân"; DB không đổi',
    actual: { put: b.put, err: b.err, dbUnchanged: JSON.stringify(rowB.value) === JSON.stringify(orig.value) },
    evidence: `${sb}; PUT ${short(b.put)}; chữ lỗi "${b.err}"; SQL ${short(rowB.value)}`,
    status: okB ? 'PASS' : 'FAIL',
  });

  // (c) bảng hợp lệ: huỷ rồi xác nhận
  const good = [{ min: 50_000_000, pct: 2.5 }, { min: 100_000_000, pct: 3 }, { min: 200_000_000, pct: 4 }];
  await input.fill(JSON.stringify(good));
  const nBefore = puts.length;
  await saveBtn.click();
  const confirmBtn = p.getByRole('button', { name: 'Lưu thay đổi', exact: true });
  await confirmBtn.waitFor({ timeout: 10_000 });
  const dialogText = await p.getByRole('dialog').or(p.getByRole('alertdialog')).first().innerText().catch(async () => p.locator('body').innerText());
  const sc1 = await shot(p, 'U3-52c-hop-xac-nhan');
  const hasTitle = /Xác nhận đổi cấu hình tiền\/điểm/.test(dialogText);
  const hasNote = /quý chưa trả thưởng/.test(dialogText);
  await p.getByRole('button', { name: /^Huỷ$|^Hủy$/ }).first().click();
  await p.waitForTimeout(1500);
  const afterCancel = { puts: puts.length - nBefore, row: await cfgRow(), hist: await histCount() };
  const sc2 = await shot(p, 'U3-52c-sau-huy');
  await saveBtn.click();
  await confirmBtn.waitFor({ timeout: 10_000 });
  await confirmBtn.click();
  await p.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/admin/config'), { timeout: 20_000 }).catch(() => undefined);
  await p.waitForTimeout(1200);
  const afterOk = { puts: puts.slice(nBefore), row: await cfgRow(), hist: (await sql(`SELECT "oldValue", "newValue", "changedBy" FROM system_config_history WHERE key = $1 ORDER BY "changedAt" DESC LIMIT 1`, KEY))[0], histN: await histCount() };
  const sc3 = await shot(p, 'U3-52c-sau-luu');
  const cancelOk = afterCancel.puts === 0 && JSON.stringify(afterCancel.row.value) === JSON.stringify(orig.value) && afterCancel.hist === h0;
  const saveOk = afterOk.puts.length === 1 && afterOk.puts[0].status === 200 && JSON.stringify(afterOk.row.value) === JSON.stringify(good) &&
    afterOk.histN === h0 + 1 && afterOk.hist?.changedBy === 'uat_admin' && afterOk.row.updatedBy === 'uat_admin';
  R.add({
    id: 'U3-52c', role: 'ADMIN', journey: 'Cấu hình bậc thưởng quý (web admin)', title: 'Bảng hợp lệ: hộp xác nhận tiền/điểm có câu "quý chưa trả thưởng"; Huỷ không lưu; Xác nhận lưu và ghi lịch sử',
    steps: `ô ${KEY} nhập ${JSON.stringify(good)}; Lưu → hộp xác nhận → Huỷ; Lưu lại → Lưu thay đổi`,
    expected: 'Hộp "Xác nhận đổi cấu hình tiền/điểm" có "quý chưa trả thưởng"; Huỷ: không PUT, DB và lịch sử không đổi; Xác nhận: PUT 200, system_configs = bảng mới, system_config_history +1 dòng changedBy uat_admin',
    actual: { hasTitle, hasNote, dialogText: dialogText.slice(0, 400), afterCancel, afterOk },
    evidence: `${sc1}, ${sc2}, ${sc3}; PUT ${short(afterOk.puts)}; SQL system_configs ${short(afterOk.row)}; system_config_history ${short(afterOk.hist)} (${h0}→${afterOk.histN})`,
    status: hasTitle && hasNote && cancelOk && saveOk ? 'PASS' : 'FAIL',
  });
  await web.close();
  web = null;

  // (d) Mini App đại lý
  const snap1 = await snapshot();
  mini = await openMini(D, { path: '/dealer' });
  const mp = mini.page;
  await mp.getByRole('tab', { name: 'Báo cáo' }).or(mp.getByRole('button', { name: 'Báo cáo', exact: true })).first().click();
  await mp.getByText('Bậc thưởng doanh số quý').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  await mp.waitForTimeout(800);
  const ui = await mp.evaluate(() => document.body.innerText);
  const sd = await shot(mp, 'U3-52d-dai-ly-bac-thuong');
  const rep = mini.requests.filter((r) => /dealer\/(report|quarterly|me\/report)/.test(r.path) || /report/.test(r.path));
  const tierLines = ui.split('\n').filter((l) => /thưởng \d/.test(l));
  const dOk = /thưởng 2,5%/.test(ui) && !/2\.5%/.test(ui) && /thưởng 3%/.test(ui) && /thưởng 4%/.test(ui) && JSON.stringify(snap1) === JSON.stringify(snap0);
  R.add({
    id: 'U3-52d', role: 'Đại lý', journey: 'Màn đại lý, tab Báo cáo: bậc thưởng quý', title: 'Mini App ghi bậc "2,5%" kiểu Việt; quý đã chụp bảng bậc (Q3/2026) vẫn giữ bậc cũ',
    steps: `Mini App uat_dealer /dealer → Báo cáo; SQL dealer_quarter_bonus_tiers ${QUARTER} trước/sau khi đổi bậc`,
    expected: 'Giao diện có "thưởng 2,5%", "thưởng 3%", "thưởng 4%", không có "2.5%"; bản chụp Q3/2026 vẫn [2,3,4] (không đổi)',
    actual: { tierLines, hasDot: /2\.5%/.test(ui), snapshotBefore: snap0, snapshotAfter: snap1, reportRequests: rep },
    evidence: `${sd}; dòng bậc ${short(tierLines)}; SQL dealer_quarter_bonus_tiers ${short(snap1)}`,
    status: dOk ? 'PASS' : 'FAIL',
  });
} catch (e) {
  console.error(e);
  R.add({ id: 'U3-52', title: 'script lỗi', status: 'BLOCKED', actual: e instanceof Error ? e.message : String(e) });
  if (web) await shot(web.page, 'U3-52-loi-web').catch(() => undefined);
} finally {
  if (web) await web.close().catch(() => undefined);
  if (mini) await mini.close().catch(() => undefined);
  // Trả về bậc gốc để các script sau không bị ảnh hưởng.
  if (orig) await exec(`UPDATE system_configs SET value = $2::jsonb WHERE key = $1`, KEY, JSON.stringify(orig.value)).catch(() => undefined);
  R.save();
  await closeDb();
}
