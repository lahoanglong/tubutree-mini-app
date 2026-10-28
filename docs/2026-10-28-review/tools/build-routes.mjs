#!/usr/bin/env node
// Dựng routes.json từ packages/app-core/src/route-map.json (nguồn route Mini App/web) và params-lN.json (dữ liệu lane N, mặc định 5).
// Dùng: node build-routes.mjs [--lane N]   (chạy lại sau khi seed-data.mjs đổi params-lN.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const rm = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/app-core/src/route-map.json'), 'utf8'));
const li = process.argv.indexOf('--lane');
const LANE_N = li >= 0 ? Number(process.argv[li + 1]) : 5;
const P = JSON.parse(fs.readFileSync(path.join(HERE, `params-l${LANE_N}.json`), 'utf8'));
const ORDER_CODE = P.orderCode;
if (!ORDER_CODE) throw new Error('params thiếu orderCode: chạy seed-data.mjs extra');

const PARAM = {
  slug: 'nuoc-rua-chen-fuwa3e',
  code: ORDER_CODE,
  courseId: P.courseId,
  id: null,
};
const byPath = (p) => {
  const sub = (name) => {
    if (name === 'slug') {
      if (p.startsWith('/brand/')) return 'fuwa3e';
      if (p.startsWith('/s/')) return 'uatctv';
      return PARAM.slug;
    }
    if (name === 'code') return p.includes('bank-payment') || p.includes('chuyen-khoan') ? P.bankOrderCode : ORDER_CODE;
    if (name === 'courseId') return P.courseId;
    if (name === 'id') {
      if (p.includes('group-buy') || p.includes('mua-chung')) return P.groupBuyId;
      if (p.includes('feed') || p.includes('cong-dong')) return P.postId;
      if (p.includes('done') || p.includes('xong')) return P.wasteDoneId;
      return P.wasteRequestId;
    }
    return null;
  };
  return p.replace(/:(\w+)|\[(\w+)\]/g, (_m, a, b) => sub(a ?? b) ?? 'THIEU');
};
const keyOf = (p) => {
  const [pathOnly] = p.split('?');
  const segs = pathOnly.split('/').filter(Boolean).map((s) => (s.startsWith(':') ? s.slice(1).toLowerCase() : s));
  return segs.length ? segs.join('-') : 'home';
};

const ROLE = {
  '/affiliate': 'ctv', '/storefront': 'ctv', '/academy': 'ctv', '/academy/:courseId': 'ctv',
  '/dealer': 'dealer', '/staff': 'staff', '/my-payroll': 'staff', '/recycle/desk': 'staff',
  '/admin': 'admin', '/admin/community': 'admin', '/brand-owner': 'brand',
};
const OWNED = new Set(['/order/:code', '/bank-payment/:code', '/recycle/r/:id', '/recycle/r/:id/edit', '/recycle/done/:id']);
const CUSTOMER_PERSONAS = ['returning', 'new', 'guest'];

const routes = [];
const skips = [];
const dataMissing = (p) => /THIEU/.test(p);
for (const lane of rm.routes) {
  for (const it of lane.items) {
    if (it.skip) {
      const mini = it.miniapp;
      if (mini === '/points/scan') {
        routes.push({ key: 'points-scan', lane: lane.lane, mini: '/points/scan', web: null, miniPersonas: ['returning', 'new', 'guest'], webPersonas: [], note: 'route-map ghi skip (Q2), nhưng Mini App có route này nên vẫn chụp phía Mini App' });
      } else {
        skips.push({ key: keyOf(mini), app: 'miniapp', path: mini, skip: it.skip });
      }
      continue;
    }
    const key = keyOf(it.miniapp);
    const role = ROLE[it.miniapp];
    const owned = OWNED.has(it.miniapp);
    const personas = role ? ['returning', role] : owned ? ['returning'] : CUSTOMER_PERSONAS;
    const mini = byPath(it.miniapp);
    const web = byPath(it.web);
    const r = { key, lane: lane.lane, mini, web, miniPersonas: personas, webPersonas: personas, private: it.private };
    if (dataMissing(mini) || dataMissing(web)) {
      skips.push({ key, app: 'both', path: `${it.miniapp} | ${it.web}`, skip: 'không có dữ liệu cho tham số động trong DB lane 4 và không tạo được qua API' });
      continue;
    }
    routes.push(r);
  }
}
// Biến thể có dữ liệu động: danh mục, nhãn hàng
routes.push({ key: 'browse-category', lane: 'shop', mini: '/browse?category=cat-cleaning', web: '/san-pham?category=cat-cleaning', miniPersonas: CUSTOMER_PERSONAS, webPersonas: CUSTOMER_PERSONAS, extra: true });
routes.push({ key: 'browse-brand', lane: 'shop', mini: '/browse?brand=Fuwa3e', web: '/san-pham?brand=Fuwa3e', miniPersonas: CUSTOMER_PERSONAS, webPersonas: CUSTOMER_PERSONAS, extra: true });
routes.push({ key: 'browse-search', lane: 'shop', mini: '/browse?focus=search&q=nuoc', web: '/san-pham?q=nuoc', miniPersonas: ['returning'], webPersonas: ['returning'], extra: true });
// Trang không có trong route-map
routes.push({ key: '404', lane: 'core', mini: '/khong-co-trang-nay', web: '/khong-co-trang-nay', miniPersonas: ['returning', 'guest'], webPersonas: ['returning', 'guest'], extra: true });
routes.push({ key: 'dang-nhap', lane: 'account', mini: null, web: '/dang-nhap', miniPersonas: [], webPersonas: ['guest', 'returning'], extra: true });
for (const s of ['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen']) routes.push({ key: `chinh-sach-${s}`, lane: 'account', mini: null, web: `/chinh-sach/${s}`, miniPersonas: [], webPersonas: ['guest'], extra: true });
routes.push({ key: 'merchant', lane: 'pro', mini: null, web: '/merchant', miniPersonas: [], webPersonas: ['returning'], extra: true });
skips.push({ key: 'khoi-phuc', app: 'web', path: '/khoi-phuc/[hint]', skip: 'trang nội bộ: middleware viết lại / cho khách có cookie phiên, không có link vào' });
skips.push({ key: 'product-redirect', app: 'web', path: '/product/[slug]', skip: 'route handler 307 sang /san-pham/[slug], không có giao diện riêng' });
skips.push({ key: 'dang-nhap-callback', app: 'web', path: '/dang-nhap/callback', skip: 'đích OAuth, không có nội dung riêng và không có link vào' });

const TABS = ['inbox', 'dashboard', 'analytics', 'reports', 'orders', 'externalOrders', 'externalClaims', 'merchantFulfilment', 'returns', 'customerRefunds', 'cashback', 'dealers', 'dealerClaims', 'dealerAccounts', 'dealerPrices', 'commissionRates', 'productCategories', 'payouts', 'merchantProducts', 'storefronts', 'brands', 'users', 'reviews', 'community', 'supportChat', 'subscriptions', 'posCredits', 'waste', 'coupons', 'flashSales', 'engagement', 'faqs', 'contentKit', 'academy', 'quickReplies', 'notificationTemplates', 'staffRoster', 'shiftApproval', 'payroll', 'attendance', 'config', 'opsHealth'];
if (TABS.length !== 42) throw new Error(`cần 42 tab, có ${TABS.length}`);
const admin = TABS.map((t) => ({ key: `tab-${t}`, path: `/admin?tab=${t}` }));
admin.push({ key: 'pos', path: '/admin/pos' });

// Tab admin chủ dùng hằng ngày: Tổng quan chỉ số, Đơn hàng, Người dùng (khách), Chat CSKH, Đổi rác (quầy), Mã giảm giá,
// Đại lý / Gian hàng CTV, Danh mục + duyệt SP (sản phẩm), Việc cần xử lý.
const ADMIN_DAILY = ['inbox', 'dashboard', 'orders', 'merchantProducts', 'productCategories', 'users', 'waste', 'supportChat', 'coupons', 'dealers', 'storefronts'];
const pairs = routes.filter((r) => r.mini && r.web && !r.extra).map((r) => r.key).concat(['404']);

fs.writeFileSync(path.join(HERE, 'routes.json'), JSON.stringify({ builtAt: new Date().toISOString(), lane: LANE_N, params: P, routes, admin, adminDaily: ADMIN_DAILY.map((t) => `tab-${t}`), pairs, skips }, null, 2));
console.log(`routes ${routes.length}, admin ${admin.length}, pairs ${pairs.length}, skips ${skips.length}`);
