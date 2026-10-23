#!/usr/bin/env node
// Tái hiện U3-B02 (cần chủ quyết): CTV bị ADMIN hạ về CUSTOMER tự bấm đăng ký CTV lại ngay trên Mini App, không cần ai duyệt;
// vai trò về AFFILIATE, gian hàng đã duyệt hiện lại công khai, mã giới thiệu lại ghi công đơn mới.
// Cần 03-gian-hang.mjs chạy trước (lấy CTV mới nhất bị hạ ở U3-21). Ghi kết quả vào out/08-ctv-bi-ha-dang-ky-lai.json, không tính vào bảng ca.
// Dùng: node 08-ctv-bi-ha-dang-ky-lai.mjs
import fs from 'node:fs';
import path from 'node:path';
import { L, OUT, api, closeDb, commissionsOf, ensureUser, openMini, orderRow, placeOrderApi, shot, sql, variationBySku } from './u3lib.mjs';

const RUN = Date.now().toString(36).slice(-5);
let mini;
const out = { at: new Date().toISOString() };
try {
  const row = (await sql(
    `SELECT u.id, u.role::text role, u."referralCode" code, s.slug, s."approvedAt" FROM users u JOIN storefronts s ON s."ownerUserId" = u.id
      WHERE u.id LIKE 'uat_u3ctv%' AND u.role = 'CUSTOMER' AND s."approvedAt" IS NOT NULL ORDER BY u."createdAt" DESC LIMIT 1`,
  ))[0];
  if (!row) throw new Error('không thấy CTV bị hạ — chạy 03-gian-hang.mjs trước');
  out.before = { ...row, publicApi: (await api(L, 'GET', `/storefront/public/${row.slug}`, { bypass: true })).status };
  mini = await openMini(row.id, { path: '/affiliate' });
  const p = mini.page;
  await p.getByRole('checkbox').first().check();
  const reg = p.waitForResponse((r) => r.url().endsWith('/api/affiliate/register') && r.request().method() === 'POST', { timeout: 20_000 });
  await p.getByRole('button', { name: 'Đăng ký miễn phí ngay' }).click();
  out.registerHttp = (await reg).status();
  await p.waitForTimeout(2000);
  out.shot = await shot(p, 'U3-B02-ctv-bi-ha-tu-dang-ky-lai');
  await mini.close();
  mini = null;
  await new Promise((r) => setTimeout(r, 6000));
  out.after = {
    role: (await sql(`SELECT role::text r FROM users WHERE id = $1`, row.id))[0].r,
    publicApi: (await api(L, 'GET', `/storefront/public/${row.slug}`, { bypass: true })).status,
  };
  const BUY = `uat_u3rrg${RUN}`;
  await ensureUser(BUY, { phone: `0903${String(Date.now()).slice(-6)}` });
  const v = await variationBySku('FUWA-DW-1L');
  const o = await placeOrderApi(BUY, [{ variationId: v.id, quantity: 1 }], { referralCode: row.code });
  out.newOrder = { code: o.code, ref: (await orderRow(o.code)).referrerUserId, commissions: (await commissionsOf(o.code)).map((c) => [c.affiliateUserId, c.status, c.amount]) };
  out.adminTrail = await sql(`SELECT action, "createdAt" FROM audit_logs WHERE "targetId" = $1 ORDER BY "createdAt" DESC LIMIT 5`, row.id).catch((e) => e.meta?.message ?? 'không đọc được audit_logs');
} catch (e) {
  out.error = String(e?.message ?? e).slice(0, 600);
} finally {
  await mini?.close().catch(() => undefined);
  fs.writeFileSync(path.join(OUT, '08-ctv-bi-ha-dang-ky-lai.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  await closeDb();
}
