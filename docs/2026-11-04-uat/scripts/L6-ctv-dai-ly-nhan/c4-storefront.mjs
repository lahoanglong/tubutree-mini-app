// C4: gian hàng CTV /s/<slug>: duyệt lần đầu (storefront.require_approval=true), công khai sau duyệt, gỡ/khôi phục, ghi công qua slug, đăng ký CTV.
// Luật: storefront-visibility.ts (publicStorefrontWhere, ownerStorefrontState), storefront-publish.ts, storefront-admin.service.ts, affiliate.service.ts register.
// Chạy sau c1-c3: node c4-storefront.mjs (từ gốc worktree uat-1104). Dùng persona returning làm người đăng ký CTV mới.
import { api, L, call, short, sql, exec, buy, orderRow, commissionOf, notifs, check, done, sleep, idk } from './common.mjs';

const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });
const pub = (slug) => api(L, 'GET', `/storefront/public/${slug}`, {});

// ---------- S01-02 gian hàng đã duyệt / chờ duyệt ----------
{
  const r = await pub('uatctv');
  const raw = JSON.stringify(r.body);
  check('L6-F01', T('Gian hàng CTV đã duyệt: khách xem công khai', 'guest', 'GET /storefront/public/uatctv', '200, approved=true, referralCode=UATCTV, có ownerTier; không lộ ngân hàng/ví/điểm/số điện thoại chủ'),
    r.status === 200 && r.body.approved === true && r.body.referralCode === 'UATCTV' && !!r.body.ownerTier && !/bankAccountNo|bankName|walletBalance|pointsBalance|0901000004|monthRevenue/.test(raw), `status=${r.status}; title=${r.body?.title}; approved=${r.body?.approved}; tier=${short(r.body?.ownerTier)}; collections=${r.body?.collections?.length}`, 'API');
  const p = await pub('uatctvpending');
  const mine = await call('ctv_pending', 'GET', '/storefront/me');
  check('L6-F02', T('Gian hàng đăng lần đầu, chờ duyệt: khách chưa thấy, chủ thấy trạng thái chờ duyệt', 'guest', 'GET /storefront/public/uatctvpending; chủ GET /storefront/me', 'khách 404 "Gian hàng không tồn tại hoặc chưa đăng."; chủ status=PENDING_APPROVAL kèm lý do "chờ Tubu Tree duyệt lần đầu"'),
    p.status === 404 && /Gian hàng không tồn tại hoặc chưa đăng/.test(p.body.message) && mine.body?.status === 'PENDING_APPROVAL' && /duyệt lần đầu/.test(mine.body?.statusReason ?? mine.body?.reason ?? JSON.stringify(mine.body)), `khách=${p.status} ${short(p.body, 160)}; chủ status=${mine.body?.status} ${short({ statusReason: mine.body?.statusReason, reason: mine.body?.reason }, 240)}`, 'API');
}

// ---------- S03 ghi công qua slug (không mã giới thiệu) ----------
{
  await exec(`DELETE FROM referral_touches WHERE "userId"='uat_returning'`);
  const a = await buy('returning', [['FUWA-GL-500', 1]], { paymentMethod: 'COD', storefrontSlug: 'uatctv' });
  const oa = await orderRow(a.code);
  const ca = await commissionOf(a.code);
  check('L6-F03', T('Mua trong gian hàng đã duyệt (storefrontSlug, không mã): ghi công chủ gian hàng, có hoa hồng', 'returning', 'place-order storefrontSlug=uatctv', 'đơn ref=uat_ctv, sf=uatctv, hoa hồng floor(79.000×8%)=6.320đ'), a.ok && oa?.ref === 'uat_ctv' && oa?.sf === 'uatctv' && ca.length === 1 && ca[0].amount === 6320, `ref=${oa?.ref} sf=${oa?.sf} commission=${short(ca[0], 200)}`, 'SQL');
  const b = await buy('returning', [['FUWA-GL-500', 1]], { paymentMethod: 'COD', storefrontSlug: 'uatctvpending' });
  const ob = await orderRow(b.code);
  const cb = await commissionOf(b.code);
  check('L6-F04', T('Mua qua gian hàng chưa duyệt: không ghi công, không hoa hồng', 'returning', 'place-order storefrontSlug=uatctvpending', 'đơn không có người giới thiệu, không commission (gian hàng chưa hiện với khách)'), b.ok && !ob?.ref && cb.length === 0, `ref=${ob?.ref} sf=${ob?.sf} commissions=${cb.length}`, 'SQL');
}

// ---------- S05 đăng ký CTV ----------
{
  const g = await api(L, 'POST', '/auth/guest', { body: { deviceId: `d_l6_${Date.now().toString(36)}_guest_device` } });
  const gt = g.body?.accessToken;
  const gr = gt ? await api(L, 'POST', '/affiliate/register', { token: gt, body: {} }) : { status: 0, body: g.body };
  check('L6-F05', T('Khách vãng lai (deviceId) không đăng ký CTV được', 'guest', 'POST /auth/guest rồi POST /affiliate/register', '400 "Cần liên kết Zalo hoặc số điện thoại để đăng ký CTV. …"'), gr.status === 400 && /Cần liên kết Zalo hoặc số điện thoại để đăng ký CTV/.test(gr.body.message), `guest login=${g.status}; register=${gr.status} ${short(gr.body, 260)}`, 'API');
  const dl = await call('dealer', 'POST', '/affiliate/register', {});
  const st = await call('staff', 'POST', '/affiliate/register', {});
  check('L6-F06', T('Đại lý và nhân viên không đăng ký CTV', 'dealer', 'POST /affiliate/register (dealer, staff)', '400 "Tài khoản này không thể đăng ký CTV."'), dl.status === 400 && st.status === 400 && /không thể đăng ký CTV/.test(dl.body.message), `dealer=${dl.status} ${short(dl.body, 120)}; staff=${st.status}`, 'API');
  const r = await call('returning', 'POST', '/affiliate/register', { termsVersion: '2026-11-t1' });
  const [u] = await sql(`SELECT role, metadata->'affiliateTerms' t FROM users WHERE id='uat_returning'`);
  await sleep(6000);
  const me = await call('returning', 'GET', '/affiliate/me');
  check('L6-F07', T('Khách đăng ký CTV: vai trò AFFILIATE, lưu bằng chứng đồng ý điều khoản, vào được công cụ CTV', 'returning', 'POST /affiliate/register termsVersion=2026-11-t1', 'ok, role AFFILIATE, metadata.affiliateTerms.version, GET /affiliate/me isAffiliate=true'), r.status === 201 && u.role === 'AFFILIATE' && u.t?.version === '2026-11-t1' && me.body?.isAffiliate === true, `register=${r.status} ${short(r.body)}; role=${u.role}; terms=${short(u.t)}; me.isAffiliate=${me.body?.isAffiliate}`, 'SQL + API');
}

// ---------- S06 trình dựng + duyệt lần đầu ----------
let sfId;
{
  const mk = await call('returning', 'POST', '/storefront');
  sfId = mk.body?.id;
  check('L6-F08', T('CTV mới tạo gian hàng: slug = mã giới thiệu viết thường, ở trạng thái nháp', 'returning', 'POST /storefront', 'slug = referralCode.toLowerCase() (uatreturning), isPublished=false'), mk.status === 201 && mk.body.slug === 'uatreturning' && mk.body.isPublished === false, `${mk.status} slug=${mk.body?.slug} isPublished=${mk.body?.isPublished} title=${mk.body?.title}`, 'API');
  const empty = await call('returning', 'POST', '/storefront/me/publish', { isPublished: true });
  check('L6-F09', T('Đăng gian hàng rỗng bị chặn', 'returning', 'POST /storefront/me/publish khi chưa có món', '400 "Thêm ít nhất 1 sản phẩm vào gian hàng trước khi đăng."'), empty.status === 400 && empty.body.message === 'Thêm ít nhất 1 sản phẩm vào gian hàng trước khi đăng.', `${empty.status} ${short(empty.body, 200)}`, 'API');
  const badColor = await call('returning', 'PATCH', '/storefront/me', { themeColor: 'xanh' });
  const upd = await call('returning', 'PATCH', '/storefront/me', { title: 'Góc Sạch Của Quay Lại', headerNote: 'Hàng xanh cho nhà sạch', themeColor: '#0f766e' });
  check('L6-F10', T('Sửa thông tin gian hàng: màu sai dạng bị chặn, tên/lời nhắn lưu được', 'returning', 'PATCH /storefront/me', 'màu "xanh" → 400; cập nhật hợp lệ → 200 và đọc lại thấy'), badColor.status === 400 && upd.status === 200 && upd.body.title === 'Góc Sạch Của Quay Lại', `màu sai=${badColor.status} ${short(badColor.body, 140)}; cập nhật=${upd.status} ${short({ title: upd.body?.title, themeColor: upd.body?.themeColor }, 120)}`, 'API');
  const col = await call('returning', 'POST', '/storefront/me/collections', { title: 'Bán chạy', layout: 'GRID' });
  const pr = (await call('returning', 'GET', '/storefront/me/products?search=nuoc-rua')).body;
  const picker = await call('returning', 'GET', '/storefront/me/products?search=Fuwa3e');
  const prod = (await call('returning', 'GET', '/products/nuoc-rua-chen-fuwa3e')).body;
  const add = await call('returning', 'POST', `/storefront/me/collections/${col.body?.id}/items`, { productId: prod.id, note: 'Dùng cả nhà đều thích' });
  const [rate] = (picker.body ?? []).filter((x) => x.slug === 'nuoc-rua-chen-fuwa3e').map((x) => x.maxAffiliateRate);
  check('L6-F11', T('Trình dựng: tạo bộ sưu tập, chọn sản phẩm (hiện % hoa hồng tối đa), thêm món', 'returning', 'POST collections; GET /storefront/me/products; POST items', 'bộ sưu tập 201; picker có maxAffiliateRate=8 cho Nước rửa chén Fuwa3e; thêm món 201'), col.status === 201 && add.status === 201 && rate === 8, `col=${col.status}; picker=${picker.status} maxAffiliateRate(nước rửa chén)=${rate}; add=${add.status} ${short(add.body?.note)}`, 'API');
  const cust = await call('new', 'GET', '/storefront/me/products?search=Fuwa3e');
  check('L6-F12', T('Khách thường không xem được danh sách chọn sản phẩm kèm % hoa hồng', 'new', 'GET /storefront/me/products', '400 "Chỉ CTV mới xem được danh sách sản phẩm để thêm vào gian hàng."'), cust.status === 400 && /Chỉ CTV mới xem được danh sách sản phẩm/.test(cust.body.message), `${cust.status} ${short(cust.body, 200)}`, 'API');
  const custCreate = await call('new', 'POST', '/storefront');
  check('L6-F13', T('Khách thường không tạo được gian hàng', 'new', 'POST /storefront', '400 "Chỉ CTV mới tạo được gian hàng."'), custCreate.status === 400 && custCreate.body.message === 'Chỉ CTV mới tạo được gian hàng.', `${custCreate.status} ${short(custCreate.body, 160)}`, 'API');

  const pubOk = await call('returning', 'POST', '/storefront/me/publish', { isPublished: true });
  const before = await pub('uatreturning');
  check('L6-F14', T('Đăng lần đầu: chờ duyệt, khách chưa thấy', 'returning', 'POST /storefront/me/publish', 'status PENDING_APPROVAL; GET /storefront/public/uatreturning → 404'), pubOk.status === 201 && pubOk.body?.status === 'PENDING_APPROVAL' && before.status === 404, `publish=${pubOk.status} status=${pubOk.body?.status}; công khai=${before.status}`, 'API');
  const list = await call('admin', 'GET', '/admin/storefronts?status=PENDING_APPROVAL');
  check('L6-F15', T('Admin thấy gian hàng trong hàng chờ duyệt', 'admin', 'GET /admin/storefronts?status=PENDING_APPROVAL', 'có uatreturning và uatctvpending'), list.status === 200 && JSON.stringify(list.body).includes('uatreturning') && JSON.stringify(list.body).includes('uatctvpending'), `${list.status} ${short((list.body?.data ?? list.body?.items ?? []).map?.((x) => x.slug), 200)}`, 'API');
  const non = await call('ctv', 'POST', `/admin/storefronts/${sfId}/approval`, { approved: true });
  const ap = await call('admin', 'POST', `/admin/storefronts/${sfId}/approval`, { approved: true });
  await sleep(500);
  const after = await pub('uatreturning');
  const nap = await notifs('uat_returning', 'STOREFRONT_APPROVED');
  check('L6-F16', T('Admin duyệt: gian hàng hiện công khai, chủ nhận tin; CTV khác không duyệt được', 'admin', 'POST /admin/storefronts/:id/approval', 'CTV → 403; admin → 200; công khai 200 approved=true; có tin STOREFRONT_APPROVED'), non.status === 403 && ap.status === 200 && after.status === 200 && after.body.approved === true && nap.length === 1, `ctv=${non.status}; admin=${ap.status}; công khai=${after.status} approved=${after.body?.approved} title=${after.body?.title}; tin=${nap.length}: ${short(nap[0]?.payload?.body, 200)}`, 'API + SQL');
  const owner = await call('returning', 'GET', '/storefront/me');
  check('L6-F17', T('Chủ gian hàng thấy trạng thái LIVE sau duyệt', 'returning', 'GET /storefront/me', 'status=LIVE'), owner.body?.status === 'LIVE', `status=${owner.body?.status}`, 'API');
  const slugBuy = await buy('new', [['FUWA-GL-500', 1]], { paymentMethod: 'COD', storefrontSlug: 'uatreturning' });
  await exec(`DELETE FROM referral_touches WHERE "userId"='uat_new'`);
  const so = await orderRow(slugBuy.code);
  check('L6-F18', T('Sau khi duyệt, mua qua slug mới ghi công cho chủ gian hàng', 'new', 'place-order storefrontSlug=uatreturning', 'đơn ref=uat_returning, có commission 8%'), so?.ref === 'uat_returning' && (await commissionOf(slugBuy.code)).length === 1, `ref=${so?.ref} sf=${so?.sf}; commissions=${(await commissionOf(slugBuy.code)).length}`, 'SQL');

  // đổi nội dung sau duyệt → dấu cho admin xem lại, KHÔNG bắt duyệt lại
  await call('returning', 'PATCH', '/storefront/me', { headerNote: 'Hàng xanh cho nhà sạch, giao nhanh' });
  const [ch] = await sql(`SELECT "approvedAt" IS NOT NULL ap, "contentChangedAt" IS NOT NULL ch FROM storefronts WHERE id=$1`, sfId);
  const still = await pub('uatreturning');
  check('L6-F19', T('Đổi nội dung sau khi được duyệt: giữ trạng thái duyệt, đánh dấu "đổi sau duyệt" cho admin', 'returning', 'PATCH /storefront/me headerNote', 'approvedAt còn, contentChangedAt có giá trị, khách vẫn thấy gian hàng'), ch.ap && ch.ch && still.status === 200, `approved=${ch.ap} contentChanged=${ch.ch} công khai=${still.status}`, 'SQL');
  const seen = await call('admin', 'POST', `/admin/storefronts/${sfId}/content-seen`, {});
  const [ch2] = await sql(`SELECT "contentChangedAt" IS NOT NULL ch FROM storefronts WHERE id=$1`, sfId);
  check('L6-F20', T('Admin bấm "Đã xem" xoá dấu đổi sau duyệt', 'admin', 'POST /admin/storefronts/:id/content-seen', 'contentChangedAt = null'), seen.status === 200 && ch2.ch === false, `${seen.status}; contentChangedAt có=${ch2.ch}`, 'SQL');

  // gỡ / khôi phục
  const td = await call('admin', 'POST', `/admin/storefronts/${sfId}/take-down`, { reason: 'Hình ảnh chưa phù hợp' });
  const gone = await pub('uatreturning');
  const repub = await call('returning', 'POST', '/storefront/me/publish', { isPublished: true });
  const st = await call('returning', 'GET', '/storefront/me');
  check('L6-F21', T('Admin gỡ gian hàng: khách không thấy, chủ không tự đăng lại được và biết lý do', 'admin', 'POST /admin/storefronts/:id/take-down', 'công khai 404; chủ đăng lại → 403 "Gian hàng đang bị Tubu Tree gỡ đăng: Hình ảnh chưa phù hợp. Liên hệ CSKH …"; status=TAKEN_DOWN'), td.status === 200 && gone.status === 404 && repub.status === 403 && /gỡ đăng: Hình ảnh chưa phù hợp/.test(repub.body.message) && st.body?.status === 'TAKEN_DOWN', `gỡ=${td.status}; công khai=${gone.status}; đăng lại=${repub.status} ${short(repub.body, 220)}; status=${st.body?.status}`, 'API');
  const buyGone = await buy('new', [['FUWA-GL-500', 1]], { paymentMethod: 'COD', storefrontSlug: 'uatreturning' });
  const og = await orderRow(buyGone.code);
  check('L6-F22', T('Gian hàng bị gỡ: mua qua slug không còn ghi công', 'new', 'place-order storefrontSlug=uatreturning khi bị gỡ', 'đơn không có người giới thiệu'), buyGone.ok && !og?.ref, `ref=${og?.ref}`, 'SQL');
  const rs = await call('admin', 'POST', `/admin/storefronts/${sfId}/reinstate`, {});
  const back = await pub('uatreturning');
  check('L6-F23', T('Khôi phục gian hàng: khách thấy lại', 'admin', 'POST /admin/storefronts/:id/reinstate', 'công khai 200'), rs.status === 200 && back.status === 200, `${rs.status}; công khai=${back.status}`, 'API');
  // CTV bị hạ vai trò (admin) → ẩn gian hàng
  await exec(`UPDATE users SET role='CUSTOMER' WHERE id='uat_returning'`);
  await sleep(6000);
  const hidden = await pub('uatreturning');
  const own = await call('returning', 'GET', '/storefront/me');
  await exec(`UPDATE users SET role='AFFILIATE' WHERE id='uat_returning'`);
  await sleep(6000);
  check('L6-F24', T('Chủ không còn là CTV (hạ vai trò): gian hàng ẩn với khách', 'guest', 'đổi role CUSTOMER rồi GET /storefront/public/uatreturning', 'khách 404 (publicStorefrontWhere); khôi phục role thì hiện lại'), hidden.status === 404, `công khai khi hạ vai=${hidden.status}; chủ GET /storefront/me=${own.status} ${short(own.body?.status ?? own.body, 120)}`, 'API');
}

// ---------- thống kê gian hàng ----------
{
  const st = await call('ctv', 'GET', '/storefront/me/stats');
  const [o30] = await sql(`SELECT count(*)::int c, COALESCE(SUM(total),0)::int s FROM orders WHERE "storefrontSlug"='uatctv' AND "referrerUserId"='uat_ctv' AND status::text NOT IN ('PENDING_PAYMENT','CANCELLED','RETURNED') AND "paymentStatus"::text NOT IN ('REFUNDED','FAILED') AND "createdAt" > now() - interval '30 days'`);
  const [c30] = await sql(`SELECT COALESCE(SUM(c.amount),0)::int s FROM commissions c JOIN orders o ON o.id=c."orderId" WHERE c."affiliateUserId"='uat_ctv' AND o."storefrontSlug"='uatctv' AND c.status <> 'REJECTED' AND c."createdAt" > now() - interval '30 days'`);
  check('L6-F25', T('Thống kê gian hàng 30 ngày khớp SQL', 'ctv', 'GET /storefront/me/stats', `orders30d=${o30.c}, revenue30d=${o30.s}, commission30d=${c30.s}`), st.status === 200 && st.body.orders30d === o30.c && st.body.commission30d === c30.s, `API=${short({ orders30d: st.body?.orders30d, revenue30d: st.body?.revenue30d, commission30d: st.body?.commission30d }, 200)}; SQL orders=${o30.c} revenue=${o30.s} commission=${c30.s}`, 'API + SQL');
}
await done();
