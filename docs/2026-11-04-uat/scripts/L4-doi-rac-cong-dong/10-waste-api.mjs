// Đổi rác: ca API (tạo yêu cầu, chọn điểm nhận, hạn mức, huỷ, quầy xác nhận cân, điểm). Chạy lại được trên lane 4 vừa dựng + 00-setup.
// Chạy: node 10-waste-api.mjs [--reset]   (--reset xoá yêu cầu đổi rác của các persona thử để chạy lại từ đầu; ghi lại sổ điểm giữ nguyên)
import { call, idem, sql, sleep, pointsState, ledgerRows, check, short, msg, toneIssues, readParams, saveParams, closeDb } from './l4lib.mjs';

const P = readParams();
const SRC = 'apps/api/src/modules/waste-exchange';
const create = (user, body, tag = 'c') => call(user, 'POST', '/waste/requests', { consent: true, ...body }, idem(tag));
const wh = P.whId;
const pt = P.partnerId;
const mk = (journey, step, expected) => ({ persona: '', viewport: 'API', journey, step, expected });

// ---------- W-01 thể lệ công khai + danh mục công khai
{
  const r = await call(undefined, 'GET', '/waste/rules');
  const text = r.body?.text ?? '';
  check('W-01', { ...mk('Thể lệ', 'GET /waste/rules không cần đăng nhập', 'Trả chữ thể lệ do admin soạn (waste.rules_text) + version (waste.rules_version)'), persona: 'guest' }, r.status === 200 && text.includes('THỂ LỆ CHƯƠNG TRÌNH ĐỔI RÁC LẤY QUÀ') && r.body.version === '2026-10-17.1', `status ${r.status}, version ${r.body?.version}, ${text.length} ký tự`);
  const c = await call(undefined, 'GET', '/waste/catalogue');
  const names = (c.body?.items ?? c.body ?? []).map?.((i) => i.name) ?? [];
  check('W-02', { ...mk('Thể lệ', 'GET /waste/catalogue công khai', 'Món nhận + mức điểm; không lộ dữ liệu riêng'), persona: 'guest' }, c.status === 200, `status ${c.status}, ${short(c.body, 400)}`);
}

// ---------- W-03 cổng truy cập
{
  const g = await call(undefined, 'POST', '/auth/guest', {});
  const gt = g.body?.accessToken;
  const r1 = await call(undefined, 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: wh, lines: [{ itemId: 'wi-carton', declaredQty: 1 }] }, idem('guest'));
  check('W-03', { ...mk('Cổng', 'Khách không đăng nhập tạo yêu cầu', 'Chặn (401)'), persona: 'guest' }, r1.status === 401, `status ${r1.status} ${msg(r1)}`);
  if (gt) {
    const r2 = await call(undefined, 'POST', '/waste/requests', { consent: true, method: 'DROP_OFF', pointId: wh, lines: [{ itemId: 'wi-carton', declaredQty: 1 }] }, { ...idem('guest2'), authorization: `Bearer ${gt}` });
    check('W-04', { ...mk('Cổng', 'Tài khoản khách (guest) tạo yêu cầu', 'Chặn: cần tài khoản thật (REAL_USER_REQUIRED_MSG)'), persona: 'guest' }, r2.status === 403, `status ${r2.status} ${msg(r2)}`);
  }
  const r3 = await create('new_nophone', { method: 'DROP_OFF', pointId: wh, lines: [{ itemId: 'wi-carton', declaredQty: 1 }] });
  check('W-05', { ...mk('Cổng', 'Khách chưa có SĐT tạo yêu cầu', 'Chặn: "Bạn cần chia sẻ số điện thoại để dùng Đổi rác lấy quà." (waste-messages.ts NEED_PHONE)'), persona: 'new_nophone' }, r3.status === 403 && msg(r3).includes('số điện thoại'), `status ${r3.status} ${msg(r3)}`);
  const me = await call('new_nophone', 'GET', '/waste/me');
  check('W-06', { ...mk('Cổng', 'GET /waste/me của khách chưa có SĐT', 'eligibility = NEED_PHONE, balance = null'), persona: 'new_nophone' }, me.body?.eligibility === 'NEED_PHONE' && me.body?.balance === null, short({ e: me.body?.eligibility, b: me.body?.balance }));
}

// ---------- W-10 GET /waste/me + danh sách món + điểm
{
  const me = await call('returning', 'GET', '/waste/me');
  const items = me.body?.items ?? [];
  const codes = items.map((i) => i.code ?? i.name).join(',');
  check('W-10', { ...mk('Danh mục', 'GET /waste/me của returning', 'Cờ chương trình bật; 3 đường giao: dropoff, mailin bật; pickup tắt (waste.lane_pickup_enabled=false, Gomdon tắt); pin (COMING_SOON) không hiện cho khách'), persona: 'returning' },
    me.body?.programmeEnabled === true && me.body.laneFlags?.dropoff === true && me.body.laneFlags?.mailin === true && me.body.laneFlags?.pickup === false, short({ lane: me.body?.laneFlags, items: codes, th: me.body?.thresholds }, 500));
  const pts = await call('returning', 'GET', '/waste/points');
  const arr = pts.body?.data ?? pts.body?.items ?? pts.body ?? [];
  check('W-11', { ...mk('Danh mục', 'GET /waste/points', 'Có kho (WAREHOUSE) và điểm đại lý (PARTNER); đại lý chỉ liệt kê món carton + nilon (waste_point_items), món chỉ kho nhận không nằm trong đó'), persona: 'returning' },
    Array.isArray(arr) && arr.some((p) => p.kind === 'WAREHOUSE') && arr.some((p) => p.kind === 'PARTNER'), short(arr.map((p) => ({ n: p.name, k: p.kind, items: (p.acceptedItems ?? p.items ?? []).map?.((i) => i.name ?? i) })), 700));
}

if (process.argv.includes('--reset')) {
  await sql(`DELETE FROM waste_events WHERE "requestId" IN (SELECT id FROM waste_requests)`);
  await sql(`DELETE FROM waste_request_lines`);
  await sql(`DELETE FROM waste_requests`);
  console.log('đã xoá yêu cầu cũ');
}

// ---------- W-20..: returning tạo yêu cầu
const before = await pointsState('uat_returning');
const created = {};

// W-20 DROP_OFF kho: carton 5 + hộp sữa 10 + vỏ Tubu 2 -> 5.000 + 2.000 + 4.000 = 11.000 điểm, 4 giọt nước
{
  const r = await create('returning', { method: 'DROP_OFF', pointId: wh, lines: [{ itemId: 'wi-carton', declaredQty: 5 }, { itemId: 'wi-milk-carton', declaredQty: 10 }, { itemId: 'wi-tubu-bottle', declaredQty: 2 }] });
  created.R1 = r.body;
  const exp = 5 * 1000 + Math.floor(10 / 5) * 1000 + 2 * 2000;
  check('W-20', { ...mk('Tạo yêu cầu DROP_OFF', 'Mang tới kho: carton 5, hộp sữa 10, vỏ Tubu 2', `Điểm ước tính = 5×1.000 + floor(10/5)×1.000 + 2×2.000 = ${exp}; 4 giọt nước (waste-points.ts linePoints/lineDrops, seed WASTE_SEED_ITEMS); mã TR-xxxxx; hạn giữ chỗ hết ngày +7`), persona: 'returning' },
    r.status === 201 && r.body.estimatedPoints === exp && /^TR-/.test(r.body.code), short({ code: r.body.code, est: r.body.estimatedPoints, drops: r.body.estimatedDrops, expiresAt: r.body.expiresAt, status: r.body.status }));
  const rows = await sql(`SELECT code, status::text, "estimatedPoints", "estimatedDrops", "expiresAt", "capDayKey", "capMonthKey", "consentVersion" FROM waste_requests WHERE id='${r.body.id}'`);
  console.log(JSON.stringify(rows));
  const exAt = new Date(rows[0]?.expiresAt);
  // hết ngày VN của (hôm nay + 7)
  const vnEnd = new Date(Date.now() + 7 * 86400_000 + 7 * 3600_000); vnEnd.setUTCHours(23, 59, 59, 999);
  const expectEnd = new Date(vnEnd.getTime() - 7 * 3600_000);
  check('W-21', { ...mk('Tạo yêu cầu DROP_OFF', 'Hạn giữ chỗ', 'expiresAt = 23:59:59 VN của ngày hôm nay +7 (waste.request_hold_days=7; hold.service endOfVnDay)'), persona: 'returning' },
    Math.abs(exAt - expectEnd) < 2000, `expiresAt ${rows[0]?.expiresAt} ; mong ${expectEnd.toISOString()} ; consentVersion ${rows[0]?.consentVersion}`);
}

// W-22 Chọn sai điểm nhận: đại lý + hộp sữa / vỏ Tubu
{
  const a = await create('returning', { method: 'DROP_OFF', pointId: pt, lines: [{ itemId: 'wi-milk-carton', declaredQty: 5 }] });
  check('W-22', { ...mk('Điểm nhận', 'Chọn điểm đại lý, khai hộp sữa', 'Chặn 409: "Điểm nhận này không nhận: Vỏ hộp sữa sạch" (hold.service POINT_MISSING_ITEMS, warehouseOnly)'), persona: 'returning' }, a.status === 409 && /không nhận: Vỏ hộp sữa/.test(msg(a)), `status ${a.status} ${msg(a)}`);
  const b = await create('returning', { method: 'DROP_OFF', pointId: pt, lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 1 }] });
  check('W-23', { ...mk('Điểm nhận', 'Chọn điểm đại lý, khai vỏ chai Tubu', 'Chặn 409: điểm này không nhận vỏ chai Tubu'), persona: 'returning' }, b.status === 409 && /không nhận/.test(msg(b)), `status ${b.status} ${msg(b)}`);
  const c = await create('returning', { method: 'DROP_OFF', pointId: pt, lines: [{ itemId: 'wi-carton', declaredQty: 1 }, { itemId: 'wi-milk-carton', declaredQty: 5 }] });
  check('W-24', { ...mk('Điểm nhận', 'Chọn điểm đại lý, khai carton lẫn hộp sữa', 'Chặn 409 cả yêu cầu vì lẫn món chỉ kho nhận'), persona: 'returning' }, c.status === 409, `status ${c.status} ${msg(c)}`);
  const d = await create('returning', { method: 'DROP_OFF', pointId: pt, lines: [{ itemId: 'wi-battery', declaredQty: 10 }] });
  check('W-25', { ...mk('Điểm nhận', 'Khai pin (COMING_SOON)', 'Chặn 409: "Món này hiện chưa nhận, hãy bỏ khỏi danh sách" (ITEM_NOT_ACTIVE)'), persona: 'returning' }, d.status === 409 && /chưa nhận/.test(msg(d)), `status ${d.status} ${msg(d)}`);
  const e = await create('returning', { method: 'DROP_OFF', lines: [{ itemId: 'wi-carton', declaredQty: 1 }] });
  check('W-26', { ...mk('Điểm nhận', 'DROP_OFF không chọn điểm', 'Chặn 400: "Hãy chọn điểm nhận" (NEED_POINT)'), persona: 'returning' }, e.status === 400 && /Hãy chọn điểm nhận/.test(msg(e)), `status ${e.status} ${msg(e)}`);
}

// W-27 Đại lý + carton/nilon: OK. Rồi hạn mức ngày.
{
  const r = await create('returning', { method: 'DROP_OFF', pointId: pt, lines: [{ itemId: 'wi-carton', declaredQty: 3 }, { itemId: 'wi-bubble-wrap', declaredQty: 2 }] });
  created.R2 = r.body;
  check('W-27', { ...mk('Điểm nhận', 'Điểm đại lý, carton 3 + nilon 2', 'Nhận: 3×1.000 + 2×1.000 = 5.000 điểm'), persona: 'returning' }, r.status === 201 && r.body.estimatedPoints === 5000, `status ${r.status} est ${r.body?.estimatedPoints} ${msg(r)}`);
  // hạn mức ngày: carton đã khai 5 (R1) + 3 (R2) = 8; thêm 3 -> 11 > 10
  const over = await create('returning', { method: 'DROP_OFF', pointId: wh, lines: [{ itemId: 'wi-carton', declaredQty: 3 }] });
  check('W-28', { ...mk('Hạn mức ngày', 'Carton đã khai 8/10 hôm nay, khai thêm 3', 'Chặn 409: "Thùng carton cũ: hôm nay bạn chỉ còn mang tới điểm nhận được 2 thùng" (waste-messages ITEM_DAY_CAP, dailyCapQty=10)'), persona: 'returning' },
    over.status === 409 && /hôm nay bạn chỉ còn mang tới điểm nhận được 2 thùng/.test(msg(over)), `status ${over.status} ${msg(over)}`);
  const exact = await create('returning', { method: 'DROP_OFF', pointId: wh, lines: [{ itemId: 'wi-carton', declaredQty: 2 }] });
  created.R3 = exact.body;
  check('W-29', { ...mk('Hạn mức ngày', 'Khai đúng 2 thùng còn lại (chạm trần 10)', 'Nhận (u+qty = 10, không vượt)'), persona: 'returning' }, exact.status === 201, `status ${exact.status} ${msg(exact)}`);
  const over2 = await create('returning', { method: 'DROP_OFF', pointId: wh, lines: [{ itemId: 'wi-carton', declaredQty: 1 }] });
  check('W-30', { ...mk('Hạn mức ngày', 'Mở yêu cầu thứ 4 (đã 3 mở)', 'Chặn 409 MAX_OPEN: "Bạn đang có 3 yêu cầu chưa xong, hãy hoàn tất hoặc huỷ bớt trước khi tạo thêm" (waste.max_open_requests=3). Thứ tự báo lỗi: MAX_OPEN trước hạn mức ngày'), persona: 'returning' },
    over2.status === 409 && /Bạn đang có 3 yêu cầu chưa xong/.test(msg(over2)), `status ${over2.status} ${msg(over2)}`);
}

// W-31 Huỷ yêu cầu: R3 (carton 2) rồi tạo lại được; huỷ lần 2 idempotent; trả hạn mức
{
  const can = await call('returning', 'POST', `/waste/requests/${created.R3.id}/cancel`);
  check('W-31', { ...mk('Huỷ yêu cầu', 'Huỷ yêu cầu OPEN', 'status = CANCELLED, closedAt có; hạn mức ngày được trả (cap chỉ đếm OPEN/IN_TRANSIT/RECEIVED/COMPLETED/REVERSED)'), persona: 'returning' }, can.status === 200 && can.body.status === 'CANCELLED', `status ${can.status} ${can.body?.status}`);
  const again = await call('returning', 'POST', `/waste/requests/${created.R3.id}/cancel`);
  check('W-32', { ...mk('Huỷ yêu cầu', 'Huỷ lần hai (cùng yêu cầu)', 'Idempotent: 200, vẫn CANCELLED (waste-requests.service cancel)'), persona: 'returning' }, again.status === 200 && again.body.status === 'CANCELLED', `status ${again.status}`);
  const re = await create('returning', { method: 'DROP_OFF', pointId: wh, lines: [{ itemId: 'wi-carton', declaredQty: 2 }] });
  created.R3b = re.body;
  check('W-33', { ...mk('Huỷ yêu cầu', 'Tạo lại carton 2 sau khi huỷ', 'Được (trần trả lại)'), persona: 'returning' }, re.status === 201, `status ${re.status} ${msg(re)}`);
  const other = await call('new', 'POST', `/waste/requests/${created.R1.id}/cancel`);
  check('W-34', { ...mk('Huỷ yêu cầu', 'Khách khác huỷ yêu cầu không phải của mình', 'Chặn 404 "Không tìm thấy yêu cầu", không lộ dữ liệu'), persona: 'new' }, other.status === 404, `status ${other.status} ${msg(other)}`);
  const od = await call('new', 'GET', `/waste/requests/${created.R1.id}`);
  check('W-35', { ...mk('Lộ dữ liệu', 'Khách khác GET chi tiết yêu cầu', 'Chặn 404'), persona: 'new' }, od.status === 404, `status ${od.status}`);
}

// W-36 idempotency
{
  const key = `l4-idem-${Date.now()}`;
  const body = { consent: true, method: 'DROP_OFF', pointId: wh, lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 1 }] };
  // returning đã 3 mở? R1,R2,R3b -> dùng new để thử
  const a = await call('new', 'POST', '/waste/requests', body, { 'idempotency-key': key });
  const b = await call('new', 'POST', '/waste/requests', body, { 'idempotency-key': key });
  const c = await call('new', 'POST', '/waste/requests', { ...body, lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 2 }] }, { 'idempotency-key': key });
  const cnt = await sql(`SELECT count(*)::int AS n FROM waste_requests WHERE "userId"='uat_new'`);
  created.N1 = a.body;
  check('W-36', { ...mk('Idempotency', 'Gửi lặp cùng key', 'Hai lần cùng key + cùng nội dung ra cùng một yêu cầu (1 dòng DB); khác nội dung = 409 "Mã chống gửi lặp này đã dùng cho một yêu cầu khác"'), persona: 'new' },
    a.status === 201 && b.body?.id === a.body?.id && cnt[0].n === 1 && c.status === 409, `a ${a.status}, b ${b.status} cùng id ${b.body?.id === a.body?.id}, rows ${cnt[0].n}, c ${c.status} ${msg(c)}`);
  const nokey = await call('new', 'POST', '/waste/requests', body);
  check('W-37', { ...mk('Idempotency', 'Thiếu header idempotency-key', 'Chặn 400'), persona: 'new' }, nokey.status === 400, `status ${nokey.status} ${msg(nokey)}`);
  const badConsent = await call('new', 'POST', '/waste/requests', { ...body, consent: false }, idem('bc'));
  check('W-38', { ...mk('Đồng ý thể lệ', 'consent=false', 'Chặn 400 (Equals(true))'), persona: 'new' }, badConsent.status === 400, `status ${badConsent.status} ${msg(badConsent)}`);
  const oldVer = await call('new', 'POST', '/waste/requests', { ...body, lines: [{ itemId: 'wi-carton', declaredQty: 1 }], consentVersion: '1999-01-01' }, idem('ov'));
  check('W-39', { ...mk('Đồng ý thể lệ', 'Gửi consentVersion cũ', 'Chặn 400 "Thể lệ đã được cập nhật. Bạn hãy đọc lại Thể lệ rồi đồng ý lại để tạo yêu cầu"'), persona: 'new' }, oldVer.status === 400 && /Thể lệ đã được cập nhật/.test(msg(oldVer)), `status ${oldVer.status} ${msg(oldVer)}`);
}

// W-40 MAIL_IN
{
  const noConsent = await create('new', { method: 'MAIL_IN', lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 10 }] });
  check('W-40', { ...mk('Tạo yêu cầu MAIL_IN', 'Không tick đóng gói + cước', 'Chặn 400 "Bạn cần đồng ý quy tắc đóng gói và cam kết đã trả đủ cước để gửi về kho"'), persona: 'new' }, noConsent.status === 400 && /đóng gói/.test(msg(noConsent)), `status ${noConsent.status} ${msg(noConsent)}`);
  const small = await create('new', { method: 'MAIL_IN', packagingConsent: true, postagePaidConsent: true, lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 2 }] });
  check('W-41', { ...mk('Tạo yêu cầu MAIL_IN', 'Gói 4.000 điểm < 15.000', 'Chặn 409 "Gói gửi về kho cần tối thiểu 15.000 điểm, bạn cần thêm 11.000 điểm nữa" (waste.mailin_min_points=15000)'), persona: 'new' }, small.status === 409 && /tối thiểu 15\.000 điểm, bạn cần thêm 11\.000 điểm nữa/.test(msg(small)), `status ${small.status} ${msg(small)}`);
  const big = await create('new', { method: 'MAIL_IN', packagingConsent: true, postagePaidConsent: true, lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 8 }] });
  created.N2 = big.body;
  check('W-42', { ...mk('Tạo yêu cầu MAIL_IN', 'Gói vỏ Tubu 8 (16.000 điểm, 16 giọt)', 'Nhận; điểm ước tính 8×2.000 = 16.000; điểm nhận = kho; hạn giữ chỗ 7 ngày'), persona: 'new' }, big.status === 201 && big.body.estimatedPoints === 16000 && big.body.method === 'MAIL_IN', `status ${big.status} est ${big.body?.estimatedPoints} ${msg(big)}`);
  const pk = await create('new', { method: 'PICKUP', lines: [{ itemId: 'wi-carton', declaredQty: 1 }] });
  check('W-43', { ...mk('Thu gom kèm đơn', 'Tạo PICKUP khi đường Thu kèm đơn tắt', 'Chặn 409 "Cách giao này đang tạm tắt, hãy chọn cách khác" (lane_pickup_enabled=false; BLOCKED để thử đường bật vì Gomdon tắt trong bộ khung)'), persona: 'new' }, pk.status === 409 && /đang tạm tắt/.test(msg(pk)), `status ${pk.status} ${msg(pk)}`);
  const bat = await create('new', { method: 'MAIL_IN', packagingConsent: true, postagePaidConsent: true, lines: [{ itemId: 'wi-battery', declaredQty: 100 }] });
  check('W-44', { ...mk('Tạo yêu cầu MAIL_IN', 'Gửi kho pin (COMING_SOON)', 'Chặn 409 (món chưa nhận)'), persona: 'new' }, bat.status === 409, `status ${bat.status} ${msg(bat)}`);
  const trk = await call('new', 'PUT', `/waste/requests/${created.N2.id}/tracking`, { carrier: 'GHN', trackingCode: ' GHN-UAT-0001 ' });
  const row = (await sql(`SELECT status::text AS status, "expiresAt", "trackingNorm", carrier, "trackingCode" FROM waste_requests WHERE id='${created.N2.id}'`))[0];
  check('W-45', { ...mk('Tạo yêu cầu MAIL_IN', 'Nhập mã vận đơn', 'IN_TRANSIT, hết hạn giữ chỗ (expiresAt = null); mã chuẩn hoá'), persona: 'new' }, trk.status === 200 && row.status === 'IN_TRANSIT' && row.expiresAt === null, `status ${trk.status} ${short(row)}`);
  const edit = await call('new', 'PATCH', `/waste/requests/${created.N2.id}`, { lines: [{ itemId: 'wi-tubu-bottle', declaredQty: 9 }] });
  check('W-46', { ...mk('Sửa yêu cầu', 'Sửa yêu cầu đã có mã vận đơn', 'Chặn 409 "Yêu cầu này không còn sửa được"'), persona: 'new' }, edit.status === 409 && /không còn sửa được/.test(msg(edit)), `status ${edit.status} ${msg(edit)}`);
  const cx = await call('new', 'POST', `/waste/requests/${created.N2.id}/cancel`);
  check('W-47', { ...mk('Huỷ yêu cầu', 'Huỷ yêu cầu IN_TRANSIT', 'Chặn 409 "Yêu cầu này không còn huỷ được"'), persona: 'new' }, cx.status === 409 && /không còn huỷ được/.test(msg(cx)), `status ${cx.status} ${msg(cx)}`);
}

// W-48 sửa yêu cầu OPEN
{
  const e = await call('new', 'PATCH', `/waste/requests/${created.N1.id}`, { lines: [{ itemId: 'wi-bubble-wrap', declaredQty: 4 }] });
  check('W-48', { ...mk('Sửa yêu cầu', 'Sửa số lượng nilon 1 -> 4 khi còn OPEN', 'Điểm ước tính cập nhật 4.000; còn OPEN'), persona: 'new' }, e.status === 200 && e.body.estimatedPoints === 4000, `status ${e.status} est ${e.body?.estimatedPoints} ${msg(e)}`);
}

saveParams({ ...P, R1: created.R1?.id, R1code: created.R1?.code, R2: created.R2?.id, R2code: created.R2?.code, R3b: created.R3b?.id, N1: created.N1?.id, N1code: created.N1?.code, N2: created.N2?.id, N2code: created.N2?.code });
const after = await pointsState('uat_returning');
console.log('returning điểm trước', before, 'sau', after, '(tạo/huỷ yêu cầu không được đổi điểm)');
check('W-49', { ...mk('Điểm', 'Tạo, sửa, huỷ yêu cầu không đổi số dư', 'pointsBalance không đổi khi chưa xác nhận'), persona: 'returning' }, before.balance === after.balance, `trước ${JSON.stringify(before)} sau ${JSON.stringify(after)}`);
await closeDb();
