// C6: chủ nhãn Fuwa3e (persona brand, Brand.ownerUserId) — trang nhãn công khai, tự quản thông tin, khuyến mãi, doanh thu, quyền.
// Luật: brand.service.ts (getPublicBySlug, updateOwnedBrand chỉ logo/cover/tagline/story/origin, assertOwnedPromotion, getOwnedSales loại PENDING_PAYMENT/CANCELLED/RETURNED + REFUNDED/FAILED).
// Chạy sau c1..c5 (có đơn Fuwa3e để đối soát doanh thu): node c6-brand.mjs (từ gốc worktree uat-1104).
import { call, short, sql, exec, check, done, sleep } from './common.mjs';

const T = (title, persona, step, expect) => ({ title, persona, size: 'API', journey: title, step, expect });
const BRAND_ID = '75ae0443eea88aa90f3c2bec9bc3ece1';
const SLUG = 'fuwa3e';
const PROMO_BASE = { title: 'UAT khuyến mãi L6', subtitle: 'Giảm 10% tuần này', themeColor: '#1E7B3A', startAt: new Date(Date.now() - 3600e3).toISOString(), endAt: new Date(Date.now() + 7 * 86400e3).toISOString() };

// ---- quyền: khách thường không phải chủ nhãn ----
{
  const me = await call('new', 'GET', '/brand/owner/me');
  check('L6-H01', T('Khách thường gọi quản lý nhãn: không thấy nhãn nào, không lỗi đỏ', 'new', 'GET /brand/owner/me', '200 và body rỗng (null), không lộ nhãn khác'), me.status === 200 && (me.body === null || me.body === ''), `${me.status} ${short(me.body, 200)}`, 'API');
  const up = await call('new', 'PATCH', '/brand/owner/me', { tagline: 'hack' });
  const sa = await call('new', 'GET', '/brand/owner/me/sales');
  const pr = await call('new', 'POST', '/brand/owner/me/promotions', PROMO_BASE);
  const [t] = await sql(`SELECT tagline FROM brands WHERE id=$1`, BRAND_ID);
  check('L6-H02', T('Khách thường không sửa được nhãn, không xem doanh thu, không tạo khuyến mãi', 'new', 'PATCH owner/me, GET owner/me/sales, POST owner/me/promotions', 'cả ba 404 "Bạn chưa được cấp quyền quản lý nhãn nào."; tagline nhãn không đổi'), [up.status, sa.status, pr.status].every((s) => s === 404) && t.tagline !== 'hack', `${up.status}/${sa.status}/${pr.status}; ${short(up.body, 140)}; tagline="${t.tagline}"`, 'API + SQL');
  const adm = await call('brand', 'GET', '/admin/brands');
  const adm2 = await call('brand', 'PATCH', `/admin/brands/${BRAND_ID}`, { isVerified: true, name: 'Hack' });
  const adm3 = await call('new', 'GET', '/admin/brands');
  check('L6-H03', T('Chủ nhãn và khách không vào được API quản trị nhãn', 'brand', 'GET /admin/brands, PATCH /admin/brands/:id', '403'), [adm.status, adm2.status, adm3.status].every((s) => s === 403), `${adm.status}/${adm2.status}/${adm3.status}`, 'API');
}

// ---- trang nhãn công khai: chưa đăng thì 404, admin đăng thì xem được, không lộ dữ liệu nội bộ ----
{
  const before = await call(null, 'GET', `/brand/public/${SLUG}`);
  check('L6-H04', T('Nhãn chưa đăng: trang công khai 404', null, `GET /brand/public/${SLUG} khi isPublished=false`, '404 "Thương hiệu không tồn tại hoặc chưa đăng."'), before.status === 404, `${before.status} ${short(before.body, 160)}`, 'API');
  const pub = await call('admin', 'PATCH', `/admin/brands/${BRAND_ID}`, { isPublished: true });
  const view = await call(null, 'GET', `/brand/public/${SLUG}`);
  const text = JSON.stringify(view.body ?? {});
  const leaks = ['ownerUserId', 'affiliateRate', 'commission', 'hoa hồng', 'uat_brand', '0901000011'].filter((k) => text.includes(k));
  const [cnt] = await sql(`SELECT count(*)::int n FROM products WHERE "brandId"=$1 AND "isActive"=true AND "approvalStatus"::text='APPROVED'`, BRAND_ID).catch(async () => sql(`SELECT count(*)::int n FROM products WHERE "brandId"=$1 AND "isActive"=true`, BRAND_ID));
  check('L6-H05', T('Admin đăng nhãn: khách (không đăng nhập) xem được, không lộ chủ nhãn / % hoa hồng / SĐT', null, 'PATCH isPublished=true rồi GET public', '200; productCount khớp SQL; không có ownerUserId, affiliateRate, hoa hồng, SĐT chủ'), pub.ok && view.status === 200 && leaks.length === 0 && view.body?.productCount === cnt.n && view.body?.products?.length > 0, `${view.status}; productCount=${view.body?.productCount} (SQL ${cnt.n}); lộ=[${leaks}]; khoá=${Object.keys(view.body ?? {}).join(',')}`, 'API + SQL');
  const hidden = await sql(`SELECT p.slug FROM products p WHERE p."brandId"=$1 AND p."isActive"=false`, BRAND_ID);
  const listed = new Set((view.body?.products ?? []).map((p) => p.slug));
  check('L6-H06', T('Sản phẩm đang tắt không xuất hiện trên trang nhãn', null, 'so sánh products.slug isActive=false với trang công khai', 'không SP tắt nào có trên trang'), hidden.every((h) => !listed.has(h.slug)), `tắt=${hidden.length}; trên trang=${listed.size}`, 'SQL');
}

// ---- chủ nhãn tự quản ----
{
  const own = await call('brand', 'GET', '/brand/owner/me');
  check('L6-H07', T('Chủ nhãn xem nhãn của mình', 'brand', 'GET /brand/owner/me', '200, đúng nhãn Fuwa3e, có danh sách promotions'), own.status === 200 && own.body?.id === BRAND_ID && own.body?.slug === SLUG && Array.isArray(own.body?.promotions), `${own.status} id=${own.body?.id} slug=${own.body?.slug}`, 'API');
  const up = await call('brand', 'PATCH', '/brand/owner/me', { tagline: 'UAT tagline L6', story: 'Câu chuyện UAT L6', origin: 'Đà Lạt' });
  const [row] = await sql(`SELECT tagline, story, origin, name, slug, "isPublished", "isVerified", "ownerUserId" FROM brands WHERE id=$1`, BRAND_ID);
  check('L6-H08', T('Chủ nhãn sửa tagline, câu chuyện, xuất xứ', 'brand', 'PATCH /brand/owner/me', '200; SQL thấy 3 trường mới'), up.ok && row.tagline === 'UAT tagline L6' && row.story === 'Câu chuyện UAT L6' && row.origin === 'Đà Lạt', `${up.status}; ${short(row, 260)}`, 'SQL');
  const bad1 = await call('brand', 'PATCH', '/brand/owner/me', { name: 'Hack', slug: 'hack', isVerified: false, isPublished: false, ownerUserId: 'uat_new' });
  const [row2] = await sql(`SELECT name, slug, "isPublished", "isVerified", "ownerUserId" FROM brands WHERE id=$1`, BRAND_ID);
  check('L6-H09', T('Chủ nhãn không tự đổi tên, slug, xác minh, đăng/gỡ, chủ nhãn', 'brand', 'PATCH /brand/owner/me gửi name/slug/isVerified/isPublished/ownerUserId', '400 (trường không nhận); SQL không đổi'), bad1.status === 400 && row2.name === row.name && row2.slug === SLUG && row2.isPublished === true && row2.ownerUserId === 'uat_brand', `${bad1.status} ${short(bad1.body, 200)}; sau=${short(row2)}`, 'API + SQL');
  const img1 = await call('brand', 'PATCH', '/brand/owner/me', { logoUrl: 'javascript:alert(1)' });
  const img2 = await call('brand', 'PATCH', '/brand/owner/me', { coverUrl: 'http://example.com/x.png' });
  const [row3] = await sql(`SELECT "logoUrl","coverUrl" FROM brands WHERE id=$1`, BRAND_ID);
  check('L6-H10', T('Ảnh logo/bìa chỉ nhận https hoặc ảnh tải lên', 'brand', 'PATCH logoUrl=javascript:..., coverUrl=http://...', '400 cả hai; SQL không ghi'), img1.status === 400 && img2.status === 400 && !/javascript|^http:/.test(`${row3.logoUrl ?? ''} ${row3.coverUrl ?? ''}`), `${img1.status}/${img2.status} ${short(img1.body, 140)}; ${short(row3)}`, 'API + SQL');
  const view = await call(null, 'GET', `/brand/public/${SLUG}`);
  check('L6-H11', T('Trang công khai phản ánh nội dung chủ nhãn vừa sửa', null, 'GET public sau PATCH', 'tagline/story/origin mới'), view.body?.tagline === 'UAT tagline L6' && view.body?.story === 'Câu chuyện UAT L6' && view.body?.origin === 'Đà Lạt', `${short({ t: view.body?.tagline, s: view.body?.story, o: view.body?.origin })}`, 'API');
}

// ---- khuyến mãi của nhãn ----
{
  const bad = [
    await call('brand', 'POST', '/brand/owner/me/promotions', { ...PROMO_BASE, themeColor: 'red;position:fixed' }),
    await call('brand', 'POST', '/brand/owner/me/promotions', { ...PROMO_BASE, startAt: 'khong-phai-ngay' }),
    await call('brand', 'POST', '/brand/owner/me/promotions', { ...PROMO_BASE, startAt: PROMO_BASE.endAt, endAt: PROMO_BASE.startAt }),
    await call('brand', 'POST', '/brand/owner/me/promotions', { ...PROMO_BASE, couponCode: 'KHONGCOMA' }),
  ];
  check('L6-H12', T('Khuyến mãi sai dữ liệu bị chặn (màu không phải hex, ngày hỏng, kết thúc trước bắt đầu, mã giảm giá không tồn tại)', 'brand', 'POST owner/me/promotions ×4 payload xấu', 'cả bốn 400'), bad.every((r) => r.status === 400), bad.map((r) => `${r.status} ${short(r.body?.message, 90)}`).join(' | '), 'API');
  const ok = await call('brand', 'POST', '/brand/owner/me/promotions', PROMO_BASE);
  const pv = await call(null, 'GET', `/brand/public/${SLUG}`);
  check('L6-H13', T('Chủ nhãn tạo khuyến mãi hợp lệ, hiện trên trang công khai', 'brand', 'POST owner/me/promotions rồi GET public', '201; promotions công khai có tiêu đề'), ok.status === 201 && (pv.body?.promotions ?? []).some((p) => p.id === ok.body?.id), `${ok.status} ${short(ok.body, 160)}; công khai ${pv.body?.promotions?.length} KM`, 'API');
  const upd = await call('brand', 'PATCH', `/brand/owner/me/promotions/${ok.body?.id}`, { title: 'UAT KM sửa', isActive: false });
  const pv2 = await call(null, 'GET', `/brand/public/${SLUG}`);
  check('L6-H14', T('Tắt khuyến mãi thì biến khỏi trang công khai', 'brand', 'PATCH isActive=false', '200; không còn trên public'), upd.ok && !(pv2.body?.promotions ?? []).some((p) => p.id === ok.body?.id), `${upd.status}; còn ${(pv2.body?.promotions ?? []).length}`, 'API');
  // khuyến mãi của nhãn khác (do admin tạo) chủ nhãn không đụng được
  const other = await sql(`SELECT id FROM brands WHERE id <> $1 ORDER BY name LIMIT 1`, BRAND_ID);
  const foreign = await call('admin', 'POST', `/admin/brands/${other[0].id}/promotions`, { ...PROMO_BASE, title: 'KM nhãn khác' });
  const f1 = await call('brand', 'PATCH', `/brand/owner/me/promotions/${foreign.body?.id}`, { title: 'Hack' });
  const f2 = await call('brand', 'DELETE', `/brand/owner/me/promotions/${foreign.body?.id}`);
  const [fr] = await sql(`SELECT title FROM brand_promotions WHERE id=$1`, foreign.body?.id);
  check('L6-H15', T('Chủ nhãn không sửa/xoá khuyến mãi của nhãn khác', 'brand', 'PATCH + DELETE owner/me/promotions/<id nhãn khác>', '403 cả hai; SQL tiêu đề không đổi'), foreign.ok && f1.status === 403 && f2.status === 403 && fr?.title === 'KM nhãn khác', `${f1.status}/${f2.status}; title="${fr?.title}"`, 'API + SQL');
  const del = await call('brand', 'DELETE', `/brand/owner/me/promotions/${ok.body?.id}`);
  const [gone] = await sql(`SELECT count(*)::int n FROM brand_promotions WHERE id=$1`, ok.body?.id);
  check('L6-H16', T('Chủ nhãn xoá khuyến mãi của mình', 'brand', 'DELETE owner/me/promotions/:id', '200; SQL không còn'), del.ok && gone.n === 0, `${del.status}; còn ${gone.n}`, 'API + SQL');
}

// ---- doanh thu nhãn: đối soát SQL ----
{
  const sales = await call('brand', 'GET', '/brand/owner/me/sales?period=30d');
  const [agg] = await sql(`
    SELECT COUNT(DISTINCT o.id)::int orders, COALESCE(SUM(oi.quantity),0)::int units, COALESCE(SUM(oi.total),0)::int revenue,
           COUNT(DISTINCT o.id) FILTER (WHERE o.status::text='DELIVERED')::int d_orders,
           COALESCE(SUM(oi.total) FILTER (WHERE o.status::text='DELIVERED'),0)::int d_rev
    FROM orders o JOIN order_items oi ON oi."orderId"=o.id JOIN variations v ON v.id=oi."variationId" JOIN products p ON p.id=v."productId"
    WHERE p."brandId"=$1 AND o."createdAt" >= now() - interval '30 days'
      AND o.status::text NOT IN ('PENDING_PAYMENT','CANCELLED','RETURNED') AND o."paymentStatus"::text NOT IN ('REFUNDED','FAILED')`, BRAND_ID);
  const [partial] = await sql(`SELECT count(*)::int n FROM return_requests WHERE status::text='APPROVED' AND "fullReturn"=false`);
  const b = sales.body;
  check('L6-H17', T('Doanh thu 30 ngày của nhãn khớp SQL (không tính chờ thanh toán, huỷ, trả hàng, hoàn tiền)', 'brand', 'GET owner/me/sales?period=30d so với SQL order_items', 'orderCount, unitsSold, revenue, delivered khớp'), sales.status === 200 && b.orderCount === agg.orders && b.unitsSold === agg.units && b.revenue === agg.revenue && b.delivered.orderCount === agg.d_orders && b.delivered.revenue === agg.d_rev && partial.n === 0, `API ${b?.orderCount}/${b?.unitsSold}/${b?.revenue}/${b?.delivered?.orderCount}/${b?.delivered?.revenue}; SQL ${agg.orders}/${agg.units}/${agg.revenue}/${agg.d_orders}/${agg.d_rev}; trả một phần ${partial.n}`, 'SQL');
  const keys = JSON.stringify(b);
  const leaked = ['userId', 'phone', 'recipient', 'address', 'customer', 'email', 'zalo'].filter((k) => new RegExp(`"${k}`, 'i').test(keys));
  check('L6-H18', T('Báo cáo doanh thu chỉ có số tổng hợp, không có thông tin khách', 'brand', 'đọc khoá JSON của owner/me/sales', 'không có userId, phone, recipient, address, customer'), leaked.length === 0, `khoá lộ=[${leaked}]; ${short(Object.keys(b ?? {}))}; top=${short((b?.topProducts ?? []).map((t) => `${t.slug}:${t.quantity}/${t.revenue}`), 220)}`, 'API');
  const periods = [];
  for (const p of ['7d', '30d', '90d', 'month', 'prev_month']) periods.push(`${p}=${(await call('brand', 'GET', `/brand/owner/me/sales?period=${p}`)).status}`);
  const badP = await call('brand', 'GET', '/brand/owner/me/sales?period=1y');
  check('L6-H19', T('Kỳ báo cáo chỉ nhận danh sách cố định', 'brand', 'GET sales?period=7d|30d|90d|month|prev_month|1y', 'năm kỳ hợp lệ 200, 1y 400'), periods.every((s) => s.endsWith('=200')) && badP.status === 400, `${periods.join(' ')}; 1y=${badP.status}`, 'API');
  const topSum = (b?.topProducts ?? []).reduce((s, t) => s + t.revenue, 0);
  check('L6-H20', T('Tổng doanh thu các SP top không vượt tổng doanh thu', 'brand', 'so topProducts với revenue', 'Σ top ≤ revenue'), topSum <= b.revenue, `Σtop=${topSum} ≤ revenue=${b?.revenue}`, 'API');
}

// ---- share-to-earn và theo dõi nhãn ----
{
  const ctv = await call('ctv', 'GET', `/brand/${SLUG}/share-to-earn`);
  const cus = await call('new', 'GET', `/brand/${SLUG}/share-to-earn`);
  const dl = await call('dealer', 'GET', `/brand/${SLUG}/share-to-earn`);
  const [mx] = await sql(`SELECT COALESCE(MAX(v."affiliateRate"),0)::int m FROM variations v JOIN products p ON p.id=v."productId" WHERE p."brandId"=$1 AND p."isActive"=true AND p."affiliateBlocked"=false`, BRAND_ID);
  check('L6-H21', T('Banner chia sẻ nhận hoa hồng: CTV/đại lý thấy %, khách thường không', 'ctv', 'GET /brand/fuwa3e/share-to-earn ba persona', 'ctv + dealer eligible=true, maxAffiliateRate ≥ 8 (mặc định) và ≥ SQL max; khách eligible=false, không có rate'), ctv.body?.eligible === true && ctv.body.maxAffiliateRate >= Math.max(8, mx.m) && dl.body?.eligible === true && cus.body?.eligible === false && !('maxAffiliateRate' in (cus.body ?? {})), `ctv=${short(ctv.body, 160)}; dealer=${dl.body?.eligible}; khách=${short(cus.body)}; SQL max rate=${mx.m}`, 'API + SQL');
  const f1 = await call('new', 'POST', `/brand/${SLUG}/follow`);
  const f2 = await call('new', 'POST', `/brand/${SLUG}/follow`);
  const st = await call('new', 'GET', `/brand/${SLUG}/follow-state`);
  const [cnt] = await sql(`SELECT count(*)::int n FROM brand_follows WHERE "brandId"=$1`, BRAND_ID);
  const [bf] = await sql(`SELECT "followerCount" c FROM brands WHERE id=$1`, BRAND_ID);
  check('L6-H22', T('Theo dõi nhãn hai lần chỉ tính một, số người theo dõi khớp SQL', 'new', 'POST follow ×2, GET follow-state', 'following=true, followerCount = số dòng brand_follows'), f1.ok && f2.ok && st.body?.following === true && bf.c === cnt.n, `${f1.status}/${f2.status}; state=${short(st.body)}; followerCount=${bf.c}; dòng=${cnt.n}`, 'SQL');
  const u1 = await call('new', 'DELETE', `/brand/${SLUG}/follow`);
  const u2 = await call('new', 'DELETE', `/brand/${SLUG}/follow`);
  const [bf2] = await sql(`SELECT "followerCount" c FROM brands WHERE id=$1`, BRAND_ID);
  const [cnt2] = await sql(`SELECT count(*)::int n FROM brand_follows WHERE "brandId"=$1`, BRAND_ID);
  check('L6-H23', T('Bỏ theo dõi hai lần không làm số đếm âm', 'new', 'DELETE follow ×2', 'followerCount = số dòng, không âm'), u1.ok && u2.ok && bf2.c === cnt2.n && bf2.c >= 0, `${u1.status}/${u2.status}; followerCount=${bf2.c}; dòng=${cnt2.n}`, 'SQL');
  const guest = await call(null, 'POST', `/brand/${SLUG}/follow`);
  check('L6-H24', T('Chưa đăng nhập không theo dõi được', null, 'POST follow không token', '401'), guest.status === 401, `${guest.status}`, 'API');
}

// trả nhãn về trạng thái seed (chưa đăng) để lần chạy sau lặp lại được
await call('admin', 'PATCH', `/admin/brands/${BRAND_ID}`, { isPublished: false });
await sleep(100);
await done();
