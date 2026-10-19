// Nạp dữ liệu thử vào DB tubutree_perf (cụm 25434 của nhánh D9) theo hai mức để so số truy vấn mỗi request.
//   DATABASE_URL=postgresql://tubu@127.0.0.1:25434/tubutree_perf?schema=public node seed-perf.cjs small|large
// Mọi dòng có id bắt đầu bằng "perf-". Chạy lại được (ON CONFLICT DO NOTHING). Không dùng cho DB khác.
const path = require('path');
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [path.resolve(__dirname, '../../../../apps/api')] }));

const stage = process.argv[2];
const SCALE = {
  small: { sfItems: 2, users: 30, custOrders: 2, itemsPerOrder: 2, adminOrders: 40, cartItems: 1, wishlist: 2, subs: 1, notifs: 3, posts: 5, reactions: 2, comments: 1, commissions: 2, points: 3, reviews: 1 },
  large: { sfItems: 12, users: 200, custOrders: 25, itemsPerOrder: 4, adminOrders: 600, cartItems: 8, wishlist: 20, subs: 8, notifs: 45, posts: 60, reactions: 15, comments: 5, commissions: 40, points: 60, reviews: 12 },
}[stage];
if (!SCALE) { console.error('dùng: seed-perf.cjs small|large'); process.exit(2); }
if (!/tubutree_perf/.test(process.env.DATABASE_URL || '')) { console.error('DATABASE_URL phải trỏ tubutree_perf'); process.exit(2); }

(async () => {
  const p = new PrismaClient();
  const run = (sql) => p.$executeRawUnsafe(sql);
  const S = SCALE;
  const cust = (await p.$queryRawUnsafe(`select id from users where "zaloId"='dev-test-user'`))[0];
  if (!cust) throw new Error('chưa có dev-test-user: chạy dev-token.ts trước');
  const C = cust.id;
  await run(`insert into users (id,"zaloId",phone,"fullName",role,"referralCode","updatedAt") values ('perf-admin','dev-admin-user','0900000099','Perf Admin','ADMIN'::"UserRole",'PERFADM',now()) on conflict do nothing`);
  // Khách thử cũng là CTV để màn affiliate có dữ liệu
  await run(`update users set role='AFFILIATE'::"UserRole" where id='${C}'`);
  await run(`insert into users (id,"zaloId",phone,"fullName",role,"referralCode","updatedAt","createdAt")
    select 'perf-u-'||g,'perf-z-'||g,'08'||lpad(g::text,8,'0'),'Khách Perf '||g,'CUSTOMER'::"UserRole",'PERF'||lpad(g::text,5,'0'),now(),now()-(g||' hours')::interval
    from generate_series(1,${S.users}) g on conflict do nothing`);
  await run(`insert into addresses (id,"userId",recipient,phone,province,district,ward,street,"isDefault","provinceCode","districtCode","wardCode")
    values ('perf-addr-1','${C}','Người Nhận','0900000001','TP. Hồ Chí Minh','Quận 1','Phường Bến Nghé','1 Lê Lợi',true,'84_VN79','','84_VN7926743') on conflict do nothing`);
  // Gian hàng CTV của khách thử: 3 bộ sưu tập, mỗi bộ sfItems sản phẩm
  await run(`insert into storefronts (id,type,slug,"ownerUserId",title,"isPublished","publishedAt","approvedAt","updatedAt")
    select 'perf-sf-1','CTV'::"StorefrontType",lower(u."referralCode"),u.id,'Cửa hàng thử',true,now(),now(),now() from users u where u.id='${C}' on conflict do nothing`);
  await run(`insert into storefront_collections (id,"storefrontId",title,"sortOrder") select 'perf-sc-'||g,'perf-sf-1','Bộ sưu tập '||g,g from generate_series(1,3) g on conflict do nothing`);
  await run(`with pr as (select id, row_number() over (order by id) rn from products where "isActive")
    insert into storefront_items (id,"collectionId","productId","sortOrder") select 'perf-si-'||c.g||'-'||pr.rn,'perf-sc-'||c.g,pr.id,pr.rn from generate_series(1,3) c(g) join pr on pr.rn<=${S.sfItems} on conflict do nothing`);

  const addr = `'{"recipient":"Người Nhận","phone":"0900000001","province":"TP. Hồ Chí Minh","district":"Quận 1","ward":"Phường Bến Nghé","street":"1 Lê Lợi","provinceCode":"84_VN79","districtCode":"","wardCode":"84_VN7926743"}'::jsonb`;
  const statusExpr = (g) => `(ARRAY['DELIVERED','CONFIRMED','SHIPPING','PENDING_PAYMENT','DELIVERED','CANCELLED'])[1 + (${g}) % 6]::"OrderStatus"`;
  // Đơn của khách thử
  await run(`insert into orders (id,code,"userId",type,status,subtotal,total,"paymentMethod","paymentStatus","shippingAddress","updatedAt","createdAt","recipientSearch")
    select 'perf-oc-'||g,'PERFC'||lpad(g::text,6,'0'),'${C}','RETAIL'::"OrderType",${statusExpr('g')},0,0,'COD'::"PaymentMethod",'UNPAID'::"PaymentStatus",${addr},now(),now()-(g||' hours')::interval,'nguoi nhan'
    from generate_series(1,${S.custOrders}) g on conflict do nothing`);
  // Đơn của mọi khách (cho admin)
  await run(`insert into orders (id,code,"userId",type,status,subtotal,total,"paymentMethod","paymentStatus","shippingAddress","updatedAt","createdAt","recipientSearch")
    select 'perf-oa-'||g,'PERFA'||lpad(g::text,6,'0'),'perf-u-'||(1+g%${S.users}),'RETAIL'::"OrderType",${statusExpr('g')},0,0,
      (ARRAY['COD','BANK_TRANSFER','ZALOPAY'])[1+g%3]::"PaymentMethod",(ARRAY['UNPAID','PAID'])[1+g%2]::"PaymentStatus",${addr},now(),now()-((g*7)||' minutes')::interval,'nguoi nhan'
    from generate_series(1,${S.adminOrders}) g on conflict do nothing`);
  // Dòng hàng: mỗi đơn itemsPerOrder dòng (đơn thứ 3 của khách thử có 8 dòng ở mức large)
  await run(`with v as (select v.id vid, v.name vname, v."retailPrice" price, p.name pname, p.slug pslug, row_number() over (order by v.id) rn, count(*) over () cnt
      from variations v join products p on p.id=v."productId" where v."isActive" and p."isActive"),
    o as (select id from orders where id like 'perf-o%')
    insert into order_items (id,"orderId","variationId","productName","productSlug","variationName","unitPrice",quantity,total)
    select o.id||'-i'||k, o.id, v.vid, v.pname, v.pslug, v.vname, v.price, 1+k%2, v.price*(1+k%2)
    from o cross join generate_series(1,${S.itemsPerOrder}) k
    join v on v.rn = 1 + ((abs(hashtext(o.id))+k) % v.cnt)
    on conflict do nothing`);
  await run(`update orders o set subtotal=s.t, total=s.t from (select "orderId", sum(total) t from order_items group by 1) s where s."orderId"=o.id and o.id like 'perf-o%' and o.subtotal=0`);
  // Giỏ
  await run(`insert into carts (id,"userId","updatedAt") values ('perf-cart-1','${C}',now()) on conflict do nothing`);
  await run(`with v as (select v.id vid, row_number() over (order by v.id) rn from variations v join products p on p.id=v."productId" where v."isActive" and p."isActive" and v.stock>5)
    insert into cart_items (id,"cartId","variationId",quantity) select 'perf-ci-'||v.rn,'perf-cart-1',v.vid,1 from v where v.rn<=${S.cartItems} on conflict do nothing`);
  // Yêu thích, đăng ký giao định kỳ
  await run(`with pr as (select id, row_number() over (order by id) rn from products where "isActive")
    insert into wishlists (id,"userId","productId") select 'perf-w-'||rn,'${C}',id from pr where rn<=${S.wishlist} on conflict do nothing`);
  await run(`with v as (select v.id vid, row_number() over (order by v.id) rn from variations v where v."isActive")
    insert into subscriptions (id,"userId","variationId",quantity,"intervalWeeks","addressId","nextRunAt","updatedAt")
    select 'perf-s-'||rn,'${C}',vid,1,4,'perf-addr-1',now()+interval '10 days',now() from v where rn<=${S.subs} on conflict do nothing`);
  // Thông báo trong app
  await run(`insert into notification_logs (id,"userId","templateCode",channel,payload,status,"sentAt")
    select 'perf-n-'||g,'${C}','ORDER_CONFIRMED','INAPP','{"title":"Thông báo thử","body":"nội dung"}'::jsonb,'SENT',now()-(g||' minutes')::interval from generate_series(1,${S.notifs}) g on conflict do nothing`);
  // Điểm
  await run(`insert into points_transactions (id,"userId",delta,reason,"expiresAt","createdAt")
    select 'perf-pt-'||g,'${C}',1000,'ORDER_EARN',now()+interval '300 days',now()-(g||' hours')::interval from generate_series(1,${S.points}) g on conflict do nothing`);
  await run(`update users set "pointsBalance" = (select coalesce(sum(delta),0) from points_transactions where "userId"='${C}') where id='${C}'`);
  // Hoa hồng CTV của khách thử trên các đơn của người khác
  await run(`insert into commissions (id,"affiliateUserId","orderId","orderTotal",rate,amount,status,"createdAt")
    select 'perf-cm-'||g,'${C}','perf-oa-'||g,100000,0.08,8000,(ARRAY['PENDING','APPROVED','PAID'])[1+g%3]::"CommissionStatus",now()-(g||' hours')::interval
    from generate_series(1,${S.commissions}) g on conflict do nothing`);
  // Feed
  await run(`insert into feed_posts (id,"userId",body,title,"createdAt","likeCount")
    select 'perf-p-'||g,'perf-u-'||(1+g%${S.users}),'Nội dung bài thử số '||g,'Bài thử '||g,now()-(g||' hours')::interval,${S.reactions} from generate_series(1,${S.posts}) g on conflict do nothing`);
  await run(`insert into feed_reactions (id,"postId","userId")
    select 'perf-fr-'||p.g||'-'||u.g,'perf-p-'||p.g,'perf-u-'||(1+((p.g+u.g) % ${S.users})) from generate_series(1,${S.posts}) p(g) cross join generate_series(1,${S.reactions}) u(g) on conflict do nothing`);
  await run(`insert into feed_comments (id,"postId","userId",body)
    select 'perf-fc-'||p.g||'-'||u.g,'perf-p-'||p.g,'perf-u-'||(1+((p.g*3+u.g) % ${S.users})),'Bình luận thử '||u.g from generate_series(1,${S.posts}) p(g) cross join generate_series(1,${S.comments}) u(g) on conflict do nothing`);
  // Đánh giá
  await run(`with pr as (select o."id" oid, oi."variationId" vid, v."productId" pid, row_number() over (order by oi.id) rn from orders o join order_items oi on oi."orderId"=o.id join variations v on v.id=oi."variationId" where o.id like 'perf-oa-%')
    insert into reviews (id,"userId",\"productId\",\"orderId\",rating,comment) select 'perf-rv-'||rn,'perf-u-'||(1+rn%${S.users}),pid,oid,4,'Tốt' from pr where rn<=${S.reviews} on conflict do nothing`).catch((e) => console.error('reviews bỏ qua:', e.message.split('\n')[0]));

  const c = await p.$queryRawUnsafe(`select (select count(*) from users) users,(select count(*) from orders) orders,(select count(*) from order_items) items,(select count(*) from feed_posts) posts,(select count(*) from feed_reactions) reactions,(select count(*) from feed_comments) comments,(select count(*) from notification_logs) notifs,(select count(*) from cart_items) cart,(select count(*) from commissions) commissions`);
  console.log(stage, JSON.stringify(c, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
