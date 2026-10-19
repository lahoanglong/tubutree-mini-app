// Nạp khối lượng lớn vào tubutree_perf để đo độ trễ ở quy mô thật hơn (sau seed-perf.cjs large).
//   DATABASE_URL=...tubutree_perf node seed-bulk.cjs
// 5.000 khách, 50.000 đơn (100.000 dòng hàng), 10.000 bài feed (50.000 tim, 20.000 bình luận), 20.000 coupon cá nhân, 50.000 thông báo.
const path = require('path');
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.resolve(__dirname, '../../../../apps/api')] }));
if (!/tubutree_perf/.test(process.env.DATABASE_URL || '')) { console.error('DATABASE_URL phải trỏ tubutree_perf'); process.exit(2); }
(async () => {
  const p = new PrismaClient();
  const run = async (name, sql) => { const t = Date.now(); await p.$executeRawUnsafe(sql); console.log(name, ((Date.now() - t) / 1000).toFixed(1) + 's'); };
  await run('users', `insert into users (id,"zaloId",phone,"fullName",role,"referralCode","updatedAt","createdAt","firstTouchSource","firstTouchAt")
    select 'perf-ub-'||g,'perf-zb-'||g,'07'||lpad(g::text,8,'0'),'Khách Bulk '||g,'CUSTOMER'::"UserRole",'PB'||lpad(g::text,6,'0'),now(),now()-((g%29*24+g%24)||' hours')::interval,
      (ARRAY['shopee','card-A','oa','organic','tiktok'])[1+g%5], now()-((g%29*24+g%24)||' hours')::interval from generate_series(1,5000) g on conflict do nothing`);
  const addr = `'{"recipient":"Bulk","phone":"0700000001","province":"TP. Hồ Chí Minh","district":"","ward":"Phường Bến Nghé","street":"1 Lê Lợi","provinceCode":"84_VN79","districtCode":"","wardCode":"84_VN7926743"}'::jsonb`;
  await run('orders', `insert into orders (id,code,"userId",type,status,subtotal,total,"paymentMethod","paymentStatus","shippingAddress","updatedAt","createdAt","recipientSearch",platform)
    select 'perf-ob-'||g,'PERFB'||lpad(g::text,7,'0'),'perf-ub-'||(1+g%5000),'RETAIL'::"OrderType",
      (ARRAY['DELIVERED','CONFIRMED','SHIPPING','PENDING_PAYMENT','DELIVERED','CANCELLED','DELIVERED','PACKED'])[1+g%8]::"OrderStatus",200000,200000,
      (ARRAY['COD','BANK_TRANSFER','ZALOPAY'])[1+g%3]::"PaymentMethod",(ARRAY['UNPAID','PAID'])[1+g%2]::"PaymentStatus",${addr},now(),now()-((g%1400)||' hours')::interval,'bulk',(ARRAY['miniapp','web'])[1+g%2]
    from generate_series(1,50000) g on conflict do nothing`);
  await run('order_items', `with v as (select v.id vid, v.name vname, v."retailPrice" price, p.name pname, p.slug pslug, row_number() over (order by v.id) rn, count(*) over () cnt
      from variations v join products p on p.id=v."productId" where v."isActive" and p."isActive")
    insert into order_items (id,"orderId","variationId","productName","productSlug","variationName","unitPrice",quantity,total)
    select 'perf-ob-'||g||'-i'||k,'perf-ob-'||g, v.vid, v.pname, v.pslug, v.vname, v.price, 1, v.price
    from generate_series(1,50000) g cross join generate_series(1,2) k join v on v.rn = 1 + ((g+k) % v.cnt) on conflict do nothing`);
  await run('feed_posts', `insert into feed_posts (id,"userId",body,title,"createdAt","likeCount")
    select 'perf-pb-'||g,'perf-ub-'||(1+g%5000),'Nội dung bài bulk '||g,'Bài bulk '||g,now()-(g||' minutes')::interval,g%7 from generate_series(1,10000) g on conflict do nothing`);
  await run('feed_reactions', `insert into feed_reactions (id,"postId","userId") select 'perf-frb-'||p.g||'-'||u.g,'perf-pb-'||p.g,'perf-ub-'||(1+((p.g*7+u.g) % 5000)) from generate_series(1,10000) p(g) cross join generate_series(1,5) u(g) on conflict do nothing`);
  await run('feed_comments', `insert into feed_comments (id,"postId","userId",body) select 'perf-fcb-'||p.g||'-'||u.g,'perf-pb-'||p.g,'perf-ub-'||(1+((p.g*3+u.g) % 5000)),'Bình luận bulk' from generate_series(1,10000) p(g) cross join generate_series(1,2) u(g) on conflict do nothing`);
  await run('coupons', `insert into coupons (id,code,type,value,"startAt","endAt",scope,"scopeMeta","usageLimit")
    select 'perf-cb-'||g,'PERFCB'||g,'AMOUNT'::"CouponType",20000,now()-interval '1 day',now()+interval '30 days','USER_GROUP'::"CouponScope",
      jsonb_build_object('userId','perf-ub-'||(1+g%5000)),1 from generate_series(1,20000) g on conflict do nothing`);
  await run('notif', `insert into notification_logs (id,"userId","templateCode",channel,payload,status,"sentAt")
    select 'perf-nb-'||g,'perf-ub-'||(1+g%5000),'ORDER_CONFIRMED',(ARRAY['INAPP','ZNS'])[1+g%2],'{"title":"bulk"}'::jsonb,'SENT',now()-(g||' seconds')::interval from generate_series(1,50000) g on conflict do nothing`);
  await run('analyze', 'analyze');
  const c = await p.$queryRawUnsafe(`select (select count(*) from users) users,(select count(*) from orders) orders,(select count(*) from order_items) items,(select count(*) from feed_posts) posts,(select count(*) from feed_reactions) reactions,(select count(*) from coupons) coupons,(select count(*) from notification_logs) notifs`);
  console.log(JSON.stringify(c, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
