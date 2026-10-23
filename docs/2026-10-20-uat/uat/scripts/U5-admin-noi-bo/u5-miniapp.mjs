#!/usr/bin/env node
// U5 màn nội bộ trong Mini App (390x844) + kiểm duyệt cộng đồng trên web admin:
//   U5-50 /staff, /my-payroll theo vai trò · U5-51 /admin (Quản trị nhân sự) theo vai trò · U5-52 đăng ký ca → ADMIN "Duyệt ca" trên Mini App
//   U5-53 /admin/community: ADMIN duyệt bài, CSKH bị chặn · U5-54 web Cộng đồng: CSKH duyệt bài + thử "Ghim" (luật B8: chỉ ADMIN ghim)
//   U5-55 Checkin/Checkout ca (BLOCKED: vị trí giải mã qua graph.zalo.me)
// Dùng: node u5-miniapp.mjs [--only=U5-50,…]
import { api, apiOk, brief, done, exec, openMini, openWebSession, q, recorder, runCase, shot } from './u5lib.mjs';

const rec = recorder('u5-miniapp');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const want = (id) => !only.length || only.includes(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mở Mini App ở `path` cho user, đợi tiêu đề trang; trả {text, apis, ev}. */
async function miniVisit(user, path, heading, shotName) {
  const s = await openMini(user, path);
  try {
    const p = s.page;
    await p.getByText(heading).first().waitFor({ timeout: 60_000 });
    await p.waitForLoadState('networkidle').catch(() => undefined);
    await p.waitForTimeout(600);
    const text = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    const ev = await shot(p, shotName);
    const apis = s.apiLog().filter((r) => !/^GET \/(home|catalog|products|categories|config|feature|banners|notifications|cart|me\b)/.test(`${r.method} ${r.path}`)).map((r) => `${r.method} ${r.path.split('?')[0]} ${r.status}`);
    return { text, apis: [...new Set(apis)], ev, errors: s.errors.slice(0, 3) };
  } finally {
    await s.close();
  }
}

// ---------- U5-50 /staff, /my-payroll
if (want('U5-50')) {
  await runCase(rec, { id: 'U5-50', role: 'NHÂN VIÊN / KẾ TOÁN / KHÁCH', journey: 'Mini App "Ca làm của tôi" (/staff) và "Lương của tôi" (/my-payroll)', steps: 'Mở /staff và /my-payroll bằng uat_staff, uat_ketoan (STAFF có nhóm) và uat_returning (khách)', expected: 'STAFF (mọi nhóm) vào được hai trang, API /staff/* và lương của tôi trả 2xx; khách thấy "Trang dành cho nhân viên…" và không gọi API nhân viên (staff.tsx:62-73, my-payroll.tsx:44-55)' }, async () => {
    const out = {};
    const evs = [];
    for (const user of ['staff', 'ketoan', 'returning']) {
      const a = await miniVisit(user, '/staff', 'Ca làm của tôi', `mini-staff-${user}-390`);
      const b = await miniVisit(user, '/my-payroll', 'Lương của tôi', `mini-my-payroll-${user}-390`);
      evs.push(a.ev, b.ev);
      const staffApis = [...a.apis, ...b.apis].filter((x) => /\/(staff|attendance|payroll)/.test(x));
      out[user] = {
        staffGate: a.text.includes('Trang dành cho nhân viên'),
        payGate: b.text.includes('Trang dành cho nhân viên'),
        staffApis,
        bad: staffApis.filter((x) => !/ 2\d\d$/.test(x)),
      };
    }
    const okStaff = ['staff', 'ketoan'].every((u) => !out[u].staffGate && !out[u].payGate && out[u].staffApis.length > 0 && out[u].bad.length === 0);
    const okCust = out.returning.staffGate && out.returning.payGate && out.returning.staffApis.length === 0;
    return {
      actual: Object.entries(out).map(([u, v]) => `${u}: chặn /staff=${v.staffGate}, chặn /my-payroll=${v.payGate}, API ${v.staffApis.join('; ') || '(không gọi)'}`).join(' | '),
      evidence: evs.join(', '),
      verdict: okStaff && okCust ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-51 /admin
if (want('U5-51')) {
  await runCase(rec, { id: 'U5-51', role: 'ADMIN / KẾ TOÁN / NHÂN VIÊN', journey: 'Mini App "Quản trị nhân sự" (/admin)', steps: 'Mở /admin bằng uat_admin, uat_ketoan, uat_staff; ADMIN bấm tab "Duyệt ca" và "Lương"', expected: 'ADMIN thấy 3 tab Nhân sự / Duyệt ca / Lương, API admin 2xx; KẾ TOÁN và NHÂN VIÊN thấy "Chỉ quản trị viên mới truy cập được trang này." (admin.tsx:61-70), không gọi API admin' }, async () => {
    const out = {};
    const evs = [];
    const s = await openMini('admin', '/admin');
    try {
      const p = s.page;
      await p.getByText('Quản trị nhân sự').first().waitFor({ timeout: 60_000 });
      await p.waitForLoadState('networkidle').catch(() => undefined);
      evs.push(await shot(p, 'mini-admin-admin-staff-390'));
      for (const [label, name] of [['Duyệt ca', 'shifts'], ['Lương', 'payroll']]) {
        await p.getByRole('tab', { name: label }).or(p.getByRole('button', { name: label, exact: true })).first().click();
        await p.waitForLoadState('networkidle').catch(() => undefined);
        await p.waitForTimeout(600);
        evs.push(await shot(p, `mini-admin-admin-${name}-390`));
      }
      const apis = [...new Set(s.apiLog(/\/admin\//).map((r) => `${r.method} ${r.path.split('?')[0]} ${r.status}`))];
      out.admin = { gate: (await p.locator('body').innerText()).includes('Chỉ quản trị viên'), apis, bad: apis.filter((x) => !/ 2\d\d$/.test(x)) };
    } finally {
      await s.close();
    }
    for (const user of ['ketoan', 'staff']) {
      const v = await miniVisit(user, '/admin', 'Quản trị nhân sự', `mini-admin-${user}-390`);
      evs.push(v.ev);
      const adminApis = v.apis.filter((x) => /\/admin\//.test(x));
      out[user] = { gate: v.text.includes('Chỉ quản trị viên mới truy cập được trang này.'), apis: adminApis };
    }
    const ok = !out.admin.gate && out.admin.apis.length >= 3 && out.admin.bad.length === 0 && out.ketoan.gate && out.staff.gate && !out.ketoan.apis.length && !out.staff.apis.length;
    return {
      actual: `ADMIN: chặn=${out.admin.gate}, API ${out.admin.apis.join('; ')}. KẾ TOÁN: chặn=${out.ketoan.gate}, API admin ${out.ketoan.apis.join('; ') || '(không)'}. NHÂN VIÊN: chặn=${out.staff.gate}, API admin ${out.staff.apis.join('; ') || '(không)'}`,
      evidence: evs.join(', '),
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-52 đăng ký ca → ADMIN duyệt trên Mini App
if (want('U5-52')) {
  await runCase(rec, { id: 'U5-52', role: 'NHÂN VIÊN → ADMIN', journey: 'Nhân viên đăng ký ca, ADMIN "Duyệt ca" trên Mini App', steps: 'uat_staff POST /staff/shifts (ca thứ Tư tuần này 08:00–12:00 giờ VN, như nút "Thêm ca"); ADMIN mở Mini App /admin → "Duyệt ca" → bấm "Duyệt ca <tên> <thứ>"; NHÂN VIÊN mở /staff xem trạng thái; KẾ TOÁN gọi POST /admin/shifts/:id/approve', expected: 'Ca PENDING → APPROVED, approvedBy uat_admin; /staff hiện "Đã duyệt"; KẾ TOÁN 403' }, async () => {
    const [u] = await q(`SELECT "fullName" FROM users WHERE id = 'uat_staff'`);
    const now = new Date(Date.now() + 7 * 3600e3);
    const dow = (now.getUTCDay() + 6) % 7;
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
    const wed = new Date(monday.getTime() + 2 * 86400e3).toISOString().slice(0, 10);
    const startAt = new Date(`${wed}T01:00:00.000Z`);
    const endAt = new Date(`${wed}T05:00:00.000Z`);
    let [sh] = await q(`SELECT id, status FROM shifts WHERE "staffId" = 'uat_staff' AND "startAt" = $1`, startAt);
    if (sh && sh.status !== 'PENDING') {
      await q(`DELETE FROM shifts WHERE id = $1 RETURNING id`, sh.id);
      sh = null;
    }
    let created = 'đã có từ lần chạy trước';
    if (!sh) {
      const r = await api('POST', '/staff/shifts', { user: 'staff', body: { items: [{ workDate: wed, startAt: startAt.toISOString(), endAt: endAt.toISOString() }] } });
      created = `${r.status} ${brief(r.body, 120)}`;
      [sh] = await q(`SELECT id, status FROM shifts WHERE "staffId" = 'uat_staff' AND "startAt" = $1`, startAt);
    }
    if (!sh) throw new Error(`không tạo được ca: ${created}`);
    const kt = await api('POST', `/admin/shifts/${sh.id}/approve`, { user: 'ketoan', body: {} });
    const evs = [];
    let st = 0;
    let s = await openMini('admin', '/admin');
    try {
      const p = s.page;
      await p.getByText('Quản trị nhân sự').first().waitFor({ timeout: 60_000 });
      await p.getByRole('tab', { name: 'Duyệt ca' }).or(p.getByRole('button', { name: 'Duyệt ca', exact: true })).first().click();
      const btn = p.getByRole('button', { name: new RegExp(`^Duyệt ca ${u.fullName}`) }).first();
      await btn.waitFor({ timeout: 30_000 });
      evs.push(await shot(p, 'mini-admin-shift-pending-390'));
      const resp = p.waitForResponse((r) => /\/admin\/shifts\/[^/]+\/approve$/.test(new URL(r.url()).pathname), { timeout: 30_000 });
      await btn.click();
      st = (await resp).status();
      await p.waitForLoadState('networkidle').catch(() => undefined);
      await p.waitForTimeout(500);
      evs.push(await shot(p, 'mini-admin-shift-approved-390'));
    } finally {
      await s.close();
    }
    const [after] = await q(`SELECT status, "approvedBy" FROM shifts WHERE id = $1`, sh.id);
    s = await openMini('staff', '/staff');
    let staffSees = false;
    try {
      await s.page.getByText('Ca làm của tôi').first().waitFor({ timeout: 60_000 });
      await s.page.waitForLoadState('networkidle').catch(() => undefined);
      await s.page.waitForTimeout(600);
      staffSees = (await s.page.locator('body').innerText()).includes('Đã duyệt');
      evs.push(await shot(s.page, 'mini-staff-shift-approved-390'));
    } finally {
      await s.close();
    }
    const ok = kt.status === 403 && st < 300 && after.status === 'APPROVED' && after.approvedBy === 'uat_admin' && staffSees;
    return {
      actual: `Đăng ký ca ${wed} 08:00–12:00: ${created}. KẾ TOÁN approve → ${kt.status}. ADMIN bấm "Duyệt ca ${u.fullName} …" → ${st}; DB ${brief(after, 100)}. NHÂN VIÊN /staff thấy "Đã duyệt": ${staffSees}`,
      evidence: `${evs.join(', ')}; SQL shifts WHERE id='${sh.id}'`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

/** Khách chưa mua (không isTrusted) đăng bài → PENDING (community-feed.service.ts:574-580; khách đã mua thì PUBLISHED thẳng). */
async function newPendingPost(tag) {
  // Tác giả chưa được tin (không đơn DELIVERED, communityProfile.isTrusted khác true): bài một khách đã được duyệt có thể làm khách
  // đó thành "tin cậy", nên mỗi lần chọn lại trong các persona khách thay vì cố định một người.
  // AFFILIATE nằm trong TRUSTED_ROLES (community-feed.service.ts:153) nên bài CTV lên PUBLISHED thẳng, không vào hàng chờ duyệt: chỉ chọn CUSTOMER.
  // Trả cờ tin cậy về false cho các persona khách để chạy lại script trên cùng lane vẫn có người đăng bài PENDING.
  await exec(`UPDATE community_profiles SET "isTrusted" = false WHERE "userId" IN ('uat_new_nophone','uat_brand','uat_new')`);
  const [a] = await q(
    `SELECT u.id FROM users u LEFT JOIN community_profiles cp ON cp."userId" = u.id
      WHERE u.id IN ('uat_new_nophone','uat_brand','uat_new') AND u.role = 'CUSTOMER'
        AND COALESCE(cp."isTrusted", false) = false AND NOT EXISTS (SELECT 1 FROM orders o WHERE o."userId" = u.id AND o.status = 'DELIVERED')
      ORDER BY u.id LIMIT 1`,
  );
  if (!a) throw new Error('hết persona khách chưa được tin để đăng bài chờ duyệt');
  const r = await apiOk('POST', '/feed', { user: a.id, body: { kind: 'QUESTION', title: `UAT ${tag}`, body: `Bài thử kiểm duyệt ${tag} ${Date.now()}: cây vạn niên thanh tưới mấy lần một tuần?` } });
  const [p] = await q(`SELECT id, status, "userId" FROM feed_posts WHERE id = $1`, r.id);
  return p;
}

// ---------- U5-53 /admin/community
if (want('U5-53')) {
  await runCase(rec, { id: 'U5-53', role: 'ADMIN (CSKH bị chặn)', journey: 'Mini App "Kiểm duyệt cộng đồng" (/admin/community)', steps: 'uat_new_nophone (chưa mua) đăng bài (PENDING); CSKH mở /admin/community trên Mini App; ADMIN mở /admin/community → bấm "Duyệt" trên bài', expected: 'CSKH thấy "Chỉ quản trị viên mới truy cập được trang này." (community-moderation.tsx:68-76); ADMIN duyệt → feed_posts PUBLISHED, hộp việc communityPending giảm 1' }, async () => {
    const post = await newPendingPost('U5-53');
    const before = (await apiOk('GET', '/admin/ops/inbox', { user: 'admin' })).items.find((i) => i.key === 'communityPending')?.count;
    const c = await miniVisit('cskh', '/admin/community', 'Kiểm duyệt cộng đồng', 'mini-community-cskh-390');
    const cskhGate = c.text.includes('Chỉ quản trị viên mới truy cập được trang này.');
    const evs = [c.ev];
    let st = 0;
    const s = await openMini('admin', '/admin/community');
    try {
      const p = s.page;
      await p.getByText('Kiểm duyệt cộng đồng').first().waitFor({ timeout: 60_000 });
      const card = p.locator('div').filter({ hasText: 'UAT U5-53' }).filter({ has: p.getByRole('button', { name: 'Duyệt', exact: true }) }).last();
      await card.waitFor({ timeout: 30_000 });
      evs.push(await shot(p, 'mini-community-admin-pending-390'));
      const resp = p.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/feed/admin/${post.id}/approve`), { timeout: 30_000 });
      await card.getByRole('button', { name: 'Duyệt', exact: true }).click();
      st = (await resp).status();
      await p.waitForTimeout(600);
      evs.push(await shot(p, 'mini-community-admin-approved-390'));
    } finally {
      await s.close();
    }
    const [after] = await q(`SELECT status FROM feed_posts WHERE id = $1`, post.id);
    const end = (await apiOk('GET', '/admin/ops/inbox', { user: 'admin' })).items.find((i) => i.key === 'communityPending')?.count;
    const ok = post.status === 'PENDING' && cskhGate && st < 300 && after.status === 'PUBLISHED' && end === before - 1;
    return {
      actual: `Bài ${post.id} tạo ở ${post.status}. CSKH Mini App: chặn=${cskhGate}. ADMIN "Duyệt" → ${st}; DB ${after.status}; communityPending ${before}→${end}`,
      evidence: `${evs.join(', ')}; SQL feed_posts.status; GET /admin/ops/inbox`,
      verdict: ok ? 'PASS' : 'FAIL',
    };
  });
}

// ---------- U5-54 web Cộng đồng: CSKH duyệt + ghim
if (want('U5-54')) {
  await runCase(rec, { id: 'U5-54', role: 'CSKH', journey: 'Web admin tab Cộng đồng: CSKH duyệt bài rồi thử "Ghim"', steps: 'uat_new_nophone (chưa mua) đăng bài; CSKH mở /admin?tab=community → "Chờ duyệt" → "Duyệt"; sang "Đã đăng" → bấm "Ghim" trên bài vừa duyệt; gọi thẳng POST /feed/admin/:id/pin {pinned:true} bằng token MARKETING', expected: 'CSKH duyệt được (B8: CSKH/MARKETING kiểm duyệt); "Ghim" chỉ ADMIN (B8): CSKH không thấy nút hoặc bị 403, feed_posts.isPinned vẫn false; MARKETING 403' }, async () => {
    const post = await newPendingPost('U5-54');
    const evs = [];
    const out = {};
    const s = await openWebSession('cskh', '/admin?tab=community');
    try {
      const p = s.page;
      await p.getByRole('group', { name: 'Mục kiểm duyệt cộng đồng' }).waitFor({ timeout: 90_000 });
      const row = p.locator(`li[data-post="${post.id}"]`);
      await row.waitFor({ timeout: 30_000 });
      const r1 = p.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/feed/admin/${post.id}/approve`), { timeout: 30_000 });
      await row.getByRole('button', { name: 'Duyệt', exact: true }).click();
      out.approve = (await r1).status();
      await p.getByRole('group', { name: 'Mục kiểm duyệt cộng đồng' }).getByRole('button', { name: 'Đã đăng', exact: true }).click();
      const prow = p.locator(`li[data-post="${post.id}"]`);
      await prow.waitFor({ timeout: 30_000 });
      const pinBtn = prow.getByRole('button', { name: 'Ghim', exact: true });
      out.pinVisible = await pinBtn.isVisible();
      if (out.pinVisible) {
        const r2 = p.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/feed/admin/${post.id}/pin`), { timeout: 30_000 });
        await pinBtn.click();
        out.pin = (await r2).status();
        await p.waitForTimeout(800);
      }
      evs.push(await shot(p, 'community-cskh-pin-1440'));
    } finally {
      await s.close();
    }
    const [mid] = await q(`SELECT status, "isPinned" FROM feed_posts WHERE id = $1`, post.id);
    const mk = await api('POST', `/feed/admin/${post.id}/pin`, { user: 'marketing', body: { pinned: true } });
    const unpin = await api('POST', `/feed/admin/${post.id}/pin`, { user: 'admin', body: { pinned: false } });
    const [end] = await q(`SELECT "isPinned" FROM feed_posts WHERE id = $1`, post.id);
    const ok = out.approve < 300 && mid.status === 'PUBLISHED' && !mid.isPinned && mk.status === 403;
    return {
      actual: `CSKH "Duyệt" → ${out.approve}, DB ${mid.status}. Nút "Ghim" hiện cho CSKH: ${out.pinVisible}; bấm → ${out.pin ?? '(không bấm)'}; DB isPinned=${mid.isPinned}. MARKETING gọi pin → ${mk.status}. (Dọn: ADMIN bỏ ghim → ${unpin.status}, isPinned=${end.isPinned})`,
      evidence: `${evs.join(', ')}; SQL feed_posts.isPinned; apps/api/src/modules/feed/community-feed.controller.ts:317-321`,
      verdict: ok ? 'PASS' : 'FAIL',
      note: mid.isPinned || mk.status !== 403 ? 'Xác nhận D2-02 (chưa sửa)' : '',
    };
  });
}

// ---------- U5-55 Checkin/Checkout
if (want('U5-55')) {
  await runCase(rec, { id: 'U5-55', role: 'NHÂN VIÊN', journey: 'Checkin / Checkout ca theo vị trí cửa hàng', steps: 'Mini App /staff → "Checkin" (ca đã duyệt ở U5-52)', expected: 'Checkin ghi giờ vào ca khi ở trong bán kính cửa hàng; ngoài bán kính bị đếm ra ngoài', onError: 'BLOCKED' }, async () => {
    return {
      actual: `Không chạy được đầu-cuối: vị trí lấy bằng getLocation (token) rồi API đổi token qua https://graph.zalo.me/v2.0/me/info (apps/api/src/modules/staff/attendance/zalo-location.ts:21, attendance.controller.ts:65-67). Lời gọi này đi từ tiến trình API ra Zalo thật; bộ khung chỉ chặn/giả được request từ trình duyệt, nên không giả được toạ độ. Đường dự phòng (định vị trình duyệt gửi lat/lng, attendance-api.ts:55-67, attendance.controller.ts:70-72) cũng không chạy: DB lane chưa có attendance.office_lat/office_lng và office_ips rỗng, nên verifyPresence trả NOT_CONFIGURED (verify.ts:20-22); toạ độ công ty cố ý không seed, admin nhập khi go-live (docs/2026-10-18-launch-review/impl/refseed.md:87). Không gọi API checkin để API lane không gửi token giả ra Zalo thật.`,
      evidence: 'zalo-location.ts:21; tools/uat-harness/miniapp-session.mjs:38 (getLocation chỉ trả token)',
      verdict: 'BLOCKED',
    };
  });
}

rec.save();
await done();
