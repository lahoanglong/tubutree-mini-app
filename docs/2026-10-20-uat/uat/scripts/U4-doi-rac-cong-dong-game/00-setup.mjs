#!/usr/bin/env node
// U4-01..U4-04: chương trình đổi rác lúc tắt, thể lệ, admin đăng ký kho HCMC + đại lý qua API thật, guard món của đại lý.
// Chạy trên lane vừa copy từ mẫu (waste.enabled=false, chưa có điểm nhận). Chạy lại: lane-up.sh 4 --fresh trước.
// Dùng: node 00-setup.mjs [lane] [--headed]
import fs from 'node:fs';
import { open } from '../../../tools/uat-harness/miniapp-session.mjs';
import { Case, L, call, closePrisma, idem, log, q, relShot, runCase, saveResults, setConfig, shot, short, sleep, headless } from './u4-lib.mjs';

const RULES_FILE = '/Users/longla/Desktop/doi-rac-ban-nhap/01-the-le-waste.rules_text.txt';
const cases = [];
const HCM = { provinceCode: '79', provinceName: 'Thành phố Hồ Chí Minh' };

function rulesText() {
  // Bản nháp thể lệ chủ dự án đã duyệt (phần giữa BẮT ĐẦU/HẾT); thiếu file thì dùng đoạn ngắn để vẫn kiểm được luồng.
  try {
    const raw = fs.readFileSync(RULES_FILE, 'utf8');
    const m = raw.match(/=== BẮT ĐẦU NỘI DUNG DÁN VÀO ADMIN ===\n([\s\S]*?)\n=== HẾT NỘI DUNG DÁN VÀO ADMIN ===/);
    if (m) return m[1].replace('[NGÀY BẮT ĐẦU]', '20/10/2026').trim();
  } catch {
    /* dùng bản ngắn */
  }
  return 'THỂ LỆ CHƯƠNG TRÌNH ĐỔI RÁC LẤY QUÀ (UAT)\nVỏ hộp sữa và vỏ chai Tubu chỉ nhận ở kho Tubu Tree TP.HCM. Điểm nhận đối tác chỉ nhận thùng carton và nilon chống sốc.';
}

// ---------- U4-01: chương trình đang tắt
cases.push(
  await runCase(
    new Case('U4-01', {
      role: 'KHÁCH (uat_returning)',
      journey: 'Đổi rác khi chương trình tắt',
      steps: 'waste.enabled=false (mặc định mẫu). Mini App mở /recycle; gọi GET /waste/me, POST /waste/requests',
      expected: 'Thẻ "Chương trình đang tạm dừng"; API tạo yêu cầu bị chặn 403, không ghi dòng waste_requests',
    }),
    async (c) => {
      const [cfg] = await q(`SELECT value FROM system_configs WHERE key = 'waste.enabled'`);
      c.check('DB: waste.enabled = false', cfg?.value === false, cfg);
      const me = await call('GET', '/waste/me', 'returning');
      c.check('GET /waste/me → programmeEnabled=false', me.status === 200 && me.body?.programmeEnabled === false, { status: me.status, programmeEnabled: me.body?.programmeEnabled });
      const cr = await call('POST', '/waste/requests', 'returning', { method: 'DROP_OFF', lines: [{ itemId: 'wi-carton', declaredQty: 2 }], consent: true }, idem());
      c.check('POST /waste/requests → 403', cr.status === 403, { status: cr.status, message: cr.body?.message });
      const [n] = await q(`SELECT count(*)::int AS n FROM waste_requests`);
      c.check('DB: không có waste_requests', n.n === 0, n);
      const s = await open(L.n, 'returning', { headless, path: '/recycle' });
      try {
        const paused = s.page.getByText('Chương trình đang tạm dừng');
        await paused.first().waitFor({ timeout: 20_000 });
        c.check('Mini App /recycle: hiện "Chương trình đang tạm dừng"', await paused.first().isVisible());
        await s.page.screenshot({ path: shot('U4-01-recycle-paused') });
      } finally {
        await s.close();
      }
      c.actual(`programmeEnabled=${me.body?.programmeEnabled}; tạo yêu cầu → ${cr.status} "${cr.body?.message}"; UI hiện thẻ tạm dừng.`);
      c.ev(relShot('U4-01-recycle-paused'));
      c.ev(`POST /waste/requests → ${cr.status} ${short(cr.body?.message, 120)}`);
      c.ev(`SELECT count(*) FROM waste_requests → ${n.n}`);
    },
  ),
);

// ---------- U4-02: thể lệ
cases.push(
  await runCase(
    new Case('U4-02', {
      role: 'KHÁCH (uat_returning), ADMIN',
      journey: 'Thể lệ đổi rác (/recycle/rules)',
      steps: 'Mở /recycle/rules khi waste.rules_text rỗng; admin PUT /admin/config waste.rules_text = bản nháp thể lệ; mở lại trang',
      expected: 'Rỗng: "Thể lệ đang được cập nhật". Sau khi admin lưu: trang hiện đúng văn bản (gồm câu hộp sữa/vỏ chai chỉ kho HCMC, đại lý chỉ carton + nilon)',
    }),
    async (c) => {
      const before = await call('GET', '/waste/rules', 'returning');
      c.check('GET /waste/rules khi rỗng → text null', before.status === 200 && before.body?.text === null, before.body);
      let s = await open(L.n, 'returning', { headless, path: '/recycle/rules' });
      try {
        const empty = s.page.getByText('Thể lệ đang được cập nhật');
        await empty.waitFor({ timeout: 20_000 });
        c.check('UI rỗng: "Thể lệ đang được cập nhật"', await empty.isVisible());
        await s.page.screenshot({ path: shot('U4-02-rules-empty') });
      } finally {
        await s.close();
      }
      const text = rulesText();
      await setConfig('waste.rules_text', text);
      const after = await call('GET', '/waste/rules', 'returning');
      c.check('GET /waste/rules sau khi lưu = văn bản admin', after.body?.text === text, { len: after.body?.text?.length, want: text.length });
      s = await open(L.n, 'returning', { headless, path: '/recycle/rules' });
      try {
        const line = s.page.getByText(/Vỏ hộp sữa và vỏ chai hoặc hộp Tubu Tree chỉ nhận ở kho Tubu Tree TP\.HCM|chỉ nhận ở kho Tubu Tree TP\.HCM/);
        await line.first().waitFor({ timeout: 20_000 });
        c.check('UI hiện câu hộp sữa/vỏ chai chỉ kho HCMC', await line.first().isVisible());
        const dealerLine = s.page.getByText(/chỉ nhận thùng carton và nilon/);
        c.check('UI hiện câu đại lý chỉ nhận carton và nilon', (await dealerLine.count()) > 0);
        await s.page.screenshot({ path: shot('U4-02-rules-text'), fullPage: true });
      } finally {
        await s.close();
      }
      c.actual(`Trước: text=null, UI "Thể lệ đang được cập nhật". Sau: /waste/rules trả ${after.body?.text?.length} ký tự, UI hiện đúng câu về điểm nhận.`);
      c.ev(relShot('U4-02-rules-empty'));
      c.ev(relShot('U4-02-rules-text'));
    },
  ),
);

// ---------- U4-03: admin đăng ký kho HCMC + đại lý
let warehouse;
let partner;
cases.push(
  await runCase(
    new Case('U4-03', {
      role: 'ADMIN',
      journey: 'Bật đổi rác: đăng ký kho HCMC và đại lý (checklist mục 2)',
      steps:
        'PUT waste.enabled=true; POST /admin/waste/points WAREHOUSE (4 món, SĐT kho); POST /admin/storefronts/:id/partner (gian hàng uatctv); POST /admin/waste/points PARTNER (carton + nilon, hạn mức 200.000); thêm OWNER uat_ctv; PATCH ACTIVE; khách GET /waste/points',
      expected: 'Kho ACTIVE nhận 4 món; đại lý ACTIVE chỉ nhận carton + nilon; khách thấy 2 điểm với acceptedItemIds đúng',
    }),
    async (c) => {
      await setConfig('waste.enabled', true);
      const existing = await call('GET', '/admin/waste/points', 'admin');
      warehouse = existing.body?.find?.((p) => p.kind === 'WAREHOUSE');
      if (!warehouse) {
        const r = await call('POST', '/admin/waste/points', 'admin', {
          kind: 'WAREHOUSE',
          name: 'Kho Tubu Tree HCM',
          addressLine: '12 Nguyễn Huệ',
          ...HCM,
          communeCode: '84_VN7926734',
          communeName: 'Phường Sài Gòn',
          phone: '0281234567',
          itemIds: ['wi-carton', 'wi-bubble-wrap', 'wi-milk-carton', 'wi-tubu-bottle'],
        });
        c.check('POST WAREHOUSE → 201', r.status === 201, { status: r.status, body: short(r.body, 200) });
        warehouse = r.body;
      }
      const [store] = await q(`SELECT id FROM storefronts WHERE slug = 'uatctv'`);
      const sp = await call('POST', `/admin/storefronts/${store.id}/partner`, 'admin', { isPartner: true });
      c.check('POST /admin/storefronts/:id/partner → 2xx', sp.ok, { status: sp.status, body: short(sp.body, 200) });
      partner = existing.body?.find?.((p) => p.kind === 'PARTNER');
      if (!partner) {
        const r = await call('POST', '/admin/waste/points', 'admin', {
          kind: 'PARTNER',
          name: 'Đại lý Xanh Quận 3',
          addressLine: '45 Võ Văn Tần',
          ...HCM,
          communeCode: '84_VN7926758',
          communeName: 'Phường Tân Định',
          phone: '0909000111',
          monthlyQuotaPoints: 200000,
          itemIds: ['wi-carton', 'wi-bubble-wrap'],
        });
        c.check('POST PARTNER → 201 (PENDING)', r.status === 201 && r.body?.status === 'PENDING', { status: r.status, st: r.body?.status, msg: r.body?.message });
        partner = r.body;
        const add = await call('POST', `/admin/waste/points/${partner.id}/staff`, 'admin', { userId: 'uat_ctv', role: 'OWNER' });
        c.check('Thêm OWNER uat_ctv → 200', add.status === 200, { status: add.status, msg: add.body?.message });
        const act = await call('PATCH', `/admin/waste/points/${partner.id}`, 'admin', { status: 'ACTIVE' });
        c.check('PATCH đại lý ACTIVE → 200', act.status === 200 && act.body?.status === 'ACTIVE', { status: act.status, st: act.body?.status, msg: act.body?.message });
      }
      const pts = await call('GET', '/waste/points', 'returning');
      const wh = pts.body?.find?.((p) => p.kind === 'WAREHOUSE');
      const pa = pts.body?.find?.((p) => p.kind === 'PARTNER');
      c.check('Khách thấy kho, nhận 4 món', wh && ['wi-carton', 'wi-bubble-wrap', 'wi-milk-carton', 'wi-tubu-bottle'].every((i) => wh.acceptedItemIds.includes(i)), wh && { id: wh.id, accepted: wh.acceptedItemIds });
      c.check('Khách thấy đại lý, chỉ carton + nilon', pa && pa.acceptedItemIds.length === 2 && pa.acceptedItemIds.includes('wi-carton') && pa.acceptedItemIds.includes('wi-bubble-wrap'), pa && { id: pa.id, accepted: pa.acceptedItemIds });
      const db = await q(`SELECT p.kind, p.status, p.name, array_agg(i."itemId" ORDER BY i."itemId") AS items FROM waste_points p LEFT JOIN waste_point_items i ON i."pointId" = p.id GROUP BY p.id ORDER BY p.kind`);
      c.check('DB waste_points: 2 điểm ACTIVE', db.length === 2 && db.every((r) => r.status === 'ACTIVE'), db);
      fs.writeFileSync(new URL('./results/points.json', import.meta.url), JSON.stringify({ warehouseId: wh?.id, partnerId: pa?.id }, null, 2));
      c.actual(`Kho ${wh?.id} nhận ${wh?.acceptedItemIds?.join(',')}; đại lý ${pa?.id} nhận ${pa?.acceptedItemIds?.join(',')}.`);
      c.ev(`SQL waste_points ⨝ waste_point_items → ${short(db.map((r) => `${r.kind}/${r.status}: ${r.items.join(',')}`).join(' | '), 300)}`);
    },
  ),
);

// ---------- U4-04: admin tick hộp sữa cho đại lý (luật: đại lý chỉ carton + nilon)
cases.push(
  await runCase(
    new Case('U4-04', {
      role: 'ADMIN',
      journey: 'Guard món của đại lý khi đăng ký/sửa điểm nhận',
      steps: 'PATCH /admin/waste/points/<đại lý> itemIds += wi-milk-carton, wi-tubu-bottle; rồi trả về carton + nilon',
      expected: 'Luật đã chốt: đại lý chỉ nhận carton + nilon, nên API từ chối gắn hộp sữa / vỏ chai Tubu cho điểm PARTNER',
    }),
    async (c) => {
      const { partnerId } = JSON.parse(fs.readFileSync(new URL('./results/points.json', import.meta.url), 'utf8'));
      const r = await call('PATCH', `/admin/waste/points/${partnerId}`, 'admin', { itemIds: ['wi-carton', 'wi-bubble-wrap', 'wi-milk-carton', 'wi-tubu-bottle'] });
      const [row] = await q(`SELECT array_agg("itemId" ORDER BY "itemId") AS items FROM waste_point_items WHERE "pointId" = $1`, partnerId);
      c.check('API từ chối gắn hộp sữa/vỏ chai cho đại lý (4xx)', r.status >= 400 && r.status < 500, { status: r.status, msg: r.body?.message });
      c.check('DB: đại lý vẫn chỉ carton + nilon', row.items.length === 2, row);
      const pts = await call('GET', '/waste/points', 'returning');
      const pa = pts.body?.find?.((p) => p.id === partnerId);
      c.actual(`PATCH → ${r.status}; DB đại lý nhận ${row.items.join(',')}; khách thấy đại lý nhận ${pa?.acceptedItemIds?.join(',')}.`);
      c.ev(`PATCH /admin/waste/points/${partnerId} {itemIds:[carton,bubble,milk,tubu]} → ${r.status}`);
      c.ev(`SELECT array_agg("itemId") FROM waste_point_items WHERE "pointId"=đại lý → ${row.items.join(',')}`);
      const back = await call('PATCH', `/admin/waste/points/${partnerId}`, 'admin', { itemIds: ['wi-carton', 'wi-bubble-wrap'] });
      const [row2] = await q(`SELECT array_agg("itemId" ORDER BY "itemId") AS items FROM waste_point_items WHERE "pointId" = $1`, partnerId);
      c.ev(`trả lại carton + nilon → ${back.status}, DB ${row2.items.join(',')}`);
      log('U4-04 dọn: đại lý nhận', row2.items);
    },
  ),
);

await closePrisma();
saveResults('00-setup', cases);
await sleep(100);
