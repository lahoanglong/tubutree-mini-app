// Lane 5: chat CSKH (khách <-> nhân viên). Cầu nối Zalo (zca-js) không chạy trong lane: phần chuyển tin sang Zalo là BLOCKED, ghi ở "Hạn chế bộ khung".
// Chạy từ gốc worktree uat-1104:  node <đường dẫn>/08-chat.mjs
import { call, sql, rec, check, save, short, sleep, toneProblems, placeOrder } from './_lib.mjs';

const J = 'Chat CSKH';
const NON_CSKH = ['staff', 'kho', 'ketoan', 'marketing'];
const cid = () => `uat-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const [orig] = await sql(`SELECT value v FROM system_configs WHERE key='chat.enabled'`);
const wasEnabled = orig?.v ?? false;
const me = (await call('returning', 'GET', '/me')).body;

// Bắt đầu từ trạng thái "chat tắt"
await call('admin', 'PUT', '/admin/support-chat/settings', { enabled: false });
const th0 = await call('returning', 'GET', '/me/support-chat');
check('L5-CHAT-01', 'returning', 'api', J, 'Mở khung chat khi chat đang tắt', '200, enabled=false (khách vẫn đọc được lịch sử)', th0.status === 200 && th0.body.enabled === false, `HTTP ${th0.status}, enabled=${th0.body?.enabled}, mã hội thoại ${th0.body?.code}`, short(th0.body, 200));
const off = await call('returning', 'POST', '/me/support-chat/messages', { clientMsgId: cid(), body: 'xin chào khi chat tắt' });
check('L5-CHAT-02', 'returning', 'api', J, 'Gửi tin khi chat tắt', '409 code CHAT_DISABLED, câu tiếng Việt có hotline (support-chat.service.ts:125)', off.status === 409 && off.body?.code === 'CHAT_DISABLED', `HTTP ${off.status} ${off.body?.code}`, short(off.body));
if (off.body?.message) {
  const t = toneProblems(off.body.message);
  check('L5-CHAT-02b', 'returning', 'api', J, 'Giọng câu "chat đang tạm đóng"', 'không "Vui lòng", "chúng tôi", "..."', t.length === 0, t.join(', ') || 'sạch', off.body.message);
}

// Bật chat: chỉ ADMIN
for (const r of ['cskh', ...NON_CSKH]) {
  const x = await call(r, 'PUT', '/admin/support-chat/settings', { enabled: true });
  check(`L5-CHAT-03-${r}`, r, 'api', J, `${r} bật chat (PUT settings)`, '403 (cấu hình chat chỉ ADMIN, support-chat-admin.controller.ts:50)', x.status === 403, `HTTP ${x.status}`, short(x.body));
}
const badSet = await call('admin', 'PUT', '/admin/support-chat/settings', { groupId: 'có khoảng trắng' });
check('L5-CHAT-04', 'admin', 'api', J, 'Nhập mã nhóm Zalo có khoảng trắng', '400', badSet.status === 400, `HTTP ${badSet.status}`, short(badSet.body));
const on = await call('admin', 'PUT', '/admin/support-chat/settings', { enabled: true });
check('L5-CHAT-05', 'admin', 'api', J, 'ADMIN bật chat', '200, enabled=true', on.status === 200 && on.body.enabled === true, `HTTP ${on.status}`, short(on.body));

// Khách gửi tin
const m1 = cid();
const s1 = await call('returning', 'POST', '/me/support-chat/messages', { clientMsgId: m1, body: '  Cho mình hỏi đơn hàng đã giao chưa?  ' });
const [row1] = await sql(`SELECT m.body, m.sender, m.source FROM support_messages m JOIN support_conversations c ON c.id=m."conversationId" WHERE c."userId"=$1 AND m."clientMsgId"=$2`, [me.id, m1]);
check('L5-CHAT-06', 'returning', 'api', J, 'Khách gửi tin có khoảng trắng đầu/cuối', '201, lưu bản đã cắt khoảng trắng, sender CUSTOMER', s1.status < 300 && row1?.body === 'Cho mình hỏi đơn hàng đã giao chưa?' && row1?.sender === 'CUSTOMER', `HTTP ${s1.status}, DB ${JSON.stringify(row1)}`, short(s1.body, 200));
const s1b = await call('returning', 'POST', '/me/support-chat/messages', { clientMsgId: m1, body: 'nội dung khác nhưng cùng clientMsgId' });
const [cnt1] = await sql(`SELECT count(*)::int n FROM support_messages m JOIN support_conversations c ON c.id=m."conversationId" WHERE c."userId"=$1 AND m."clientMsgId"=$2`, [me.id, m1]);
check('L5-CHAT-07', 'returning', 'api', J, 'Gửi lại cùng clientMsgId (bấm đúp / thử lại mạng)', 'trả tin cũ, chỉ 1 dòng trong DB', s1b.status < 300 && cnt1.n === 1 && s1b.body?.id === s1.body?.id, `HTTP ${s1b.status}, ${cnt1.n} dòng, cùng id=${s1b.body?.id === s1.body?.id}`, short(s1b.body, 160));
const par = await Promise.all([1, 2, 3, 4].map(() => call('returning', 'POST', '/me/support-chat/messages', { clientMsgId: 'uatpar' + m1.slice(-10), body: 'song song' })));
const [cp] = await sql(`SELECT count(*)::int n FROM support_messages m JOIN support_conversations c ON c.id=m."conversationId" WHERE c."userId"=$1 AND m."clientMsgId"=$2`, [me.id, 'uatpar' + m1.slice(-10)]);
check('L5-CHAT-08', 'returning', 'api', J, '4 request cùng clientMsgId đồng thời', 'đúng 1 dòng trong DB, không request nào 500', cp.n === 1 && par.every((r) => r.status < 500), `${cp.n} dòng, mã ${par.map((r) => r.status).join(',')}`, par.map((r) => short(r.body, 80)));
for (const [name, body, want] of [
  ['rỗng', { clientMsgId: cid(), body: '   ' }, 400],
  ['1001 ký tự', { clientMsgId: cid(), body: 'a'.repeat(1001) }, 400],
  ['clientMsgId ngắn', { clientMsgId: 'abc', body: 'x' }, 400],
  ['ảnh base64', { clientMsgId: cid(), body: 'x', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' }, 400],
  ['ảnh link ngoài', { clientMsgId: cid(), body: 'x', imageUrl: 'https://evil.example.com/a.png' }, 400],
  ['source lạ', { clientMsgId: cid(), body: 'x', source: 'ADMIN' }, 400],
  ['body = số', { clientMsgId: cid(), body: 12345678 }, 400],
]) {
  const x = await call('returning', 'POST', '/me/support-chat/messages', body);
  check(`L5-CHAT-09-${name}`, 'returning', 'api', J, `Khách gửi tin ${name}`, `${want} JSON, không ghi DB`, x.status === want && typeof x.body === 'object', `HTTP ${x.status}`, short(x.body, 200));
}
// Mã đơn của người khác không được đi vào ngữ cảnh
const other = { code: (await sql(`SELECT code FROM orders WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [me.id]))[0].code }; // đơn của returning, người gửi là ctv
const own = (await sql(`SELECT code FROM orders WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [me.id]))[0];
const mc = cid();
const ctx = await call('ctv', 'POST', '/me/support-chat/messages', { clientMsgId: mc, body: 'ngữ cảnh đơn lạ', context: { orderCode: other.code, productSlug: 'nuoc-rua-chen-fuwa3e' } });
const [cx] = await sql(`SELECT context FROM support_messages WHERE "clientMsgId"=$1`, [mc]);
check('L5-CHAT-10', 'ctv', 'api', J, 'CTV gắn mã đơn của người khác (của returning) vào tin', 'orderCode bị bỏ, giữ productSlug (support-chat.service.ts:183)', ctx.status < 300 && !JSON.stringify(cx?.context ?? {}).includes(other.code), `HTTP ${ctx.status}, context=${JSON.stringify(cx?.context)}`, { other: other.code });
const mo = cid();
await call('returning', 'POST', '/me/support-chat/messages', { clientMsgId: mo, body: 'ngữ cảnh đơn của mình', context: { orderCode: own.code } });
const [cxo] = await sql(`SELECT context FROM support_messages WHERE "clientMsgId"=$1`, [mo]);
check('L5-CHAT-11', 'returning', 'api', J, 'Khách gắn mã đơn của chính mình', 'orderCode được giữ', JSON.stringify(cxo?.context ?? {}).includes(own.code), `context=${JSON.stringify(cxo?.context)}`, { own: own.code });

// Ngoài giờ
const hours = (await sql(`SELECT value v FROM system_configs WHERE key='chat.hours'`))[0]?.v ?? { start: '08:00', end: '21:00' };
const vnHour = Number(new Date(Date.now() + 7 * 3600e3).toISOString().slice(11, 13));
const inHours = vnHour >= Number(hours.start.slice(0, 2)) && vnHour < Number(hours.end.slice(0, 2));
const sysMsgs = await sql(`SELECT m.body FROM support_messages m JOIN support_conversations c ON c.id=m."conversationId" WHERE c."userId"=$1 AND m.sender='SYSTEM'`, [me.id]);
check('L5-CHAT-12', 'returning', 'api', J, `Gửi tin lúc ${vnHour}h VN (giờ trực ${hours.start}-${hours.end})`, inHours ? 'trong giờ: không có lời nhắn ngoài giờ' : 'ngoài giờ: đúng 1 lời nhắn SYSTEM trong ngày dù gửi nhiều tin', inHours ? sysMsgs.length === 0 : sysMsgs.length === 1, `${sysMsgs.length} lời nhắn SYSTEM`, sysMsgs.map((m) => m.body));
if (sysMsgs[0]) {
  const t = toneProblems(sysMsgs[0].body);
  check('L5-CHAT-12b', 'returning', 'api', J, 'Giọng lời nhắn ngoài giờ', 'không "Vui lòng", "chúng tôi", "..."', t.length === 0, t.join(', ') || 'sạch', sysMsgs[0].body);
}

// Phía CSKH
const lst = await call('cskh', 'GET', '/admin/support-chat/conversations');
const items = lst.body.items ?? lst.body.data ?? lst.body.conversations ?? [];
const conv = (await sql(`SELECT id, code FROM support_conversations WHERE "userId"=$1`, [me.id]))[0];
const mine = items.find((c) => c.id === conv.id || c.code === conv.code);
check('L5-CHAT-13', 'cskh', 'api', J, 'CSKH mở danh sách hội thoại', '200, thấy hội thoại của khách vừa nhắn', lst.status === 200 && !!mine, `HTTP ${lst.status}, ${items.length} hội thoại, thấy=${!!mine}`, short(mine ?? lst.body, 300));
const search = await call('cskh', 'GET', `/admin/support-chat/conversations?q=${encodeURIComponent(conv.code)}`);
const sItems = search.body.items ?? search.body.data ?? [];
check('L5-CHAT-14', 'cskh', 'api', J, 'Tìm hội thoại theo mã', '200, 1 kết quả đúng mã', search.status === 200 && sItems.length >= 1 && sItems.every((c) => c.code === conv.code), `HTTP ${search.status}, ${sItems.length} dòng`, short(sItems[0]));
const unf = await call('cskh', 'GET', '/admin/support-chat/conversations?filter=unforwarded');
check('L5-CHAT-15', 'cskh', 'api', J, 'Lọc "chưa chuyển Zalo"', '200 (cầu nối không chạy nên tin của khách phải nằm ở đây sau ít phút)', unf.status === 200, `HTTP ${unf.status}, ${(unf.body.items ?? unf.body.data ?? []).length} dòng`, short(unf.body, 200));
const bad = await call('cskh', 'GET', '/admin/support-chat/conversations?filter=xyz');
check('L5-CHAT-16', 'cskh', 'api', J, 'Lọc filter lạ', '400', bad.status === 400, `HTTP ${bad.status}`, short(bad.body));
const det = await call('cskh', 'GET', `/admin/support-chat/conversations/${conv.id}`);
const dm = det.body.messages ?? [];
check('L5-CHAT-17', 'cskh', 'api', J, 'CSKH mở một hội thoại', '200, có tin khách + thông tin khách (tên, SĐT)', det.status === 200 && dm.length >= 3 && !!det.body.user?.phone, `HTTP ${det.status}, ${dm.length} tin, SĐT ${det.body.user?.phone ?? 'không có'}`, short(det.body.user));
const nf = await call('cskh', 'GET', '/admin/support-chat/conversations/khong-co');
check('L5-CHAT-18', 'cskh', 'api', J, 'Mở hội thoại không tồn tại', '404', nf.status === 404, `HTTP ${nf.status}`, short(nf.body));
for (const r of NON_CSKH) {
  const a = await call(r, 'GET', '/admin/support-chat/conversations');
  const b = await call(r, 'GET', `/admin/support-chat/conversations/${conv.id}`);
  const c = await call(r, 'POST', `/admin/support-chat/conversations/${conv.id}/reply`, { body: 'x' });
  const d = await call(r, 'POST', `/admin/support-chat/conversations/${conv.id}/block`, {});
  check(`L5-CHAT-19-${r}`, r, 'api', J, `${r} đọc / trả lời / chặn hội thoại`, '403 cả bốn', [a, b, c, d].every((x) => x.status === 403), `list ${a.status}, get ${b.status}, reply ${c.status}, block ${d.status}`, short(c.body));
}
const cust = await call('returning', 'GET', '/admin/support-chat/conversations');
check('L5-CHAT-19-customer', 'returning', 'api', J, 'Khách gọi API admin chat', '403', cust.status === 403, `HTTP ${cust.status}`, short(cust.body));

// Trả lời
const rep = await call('cskh', 'POST', `/admin/support-chat/conversations/${conv.id}/reply`, { body: '  Đơn của bạn đang trên đường giao nhé.  ' });
const [rr] = await sql(`SELECT body, sender, source, "adminUserId" a FROM support_messages WHERE id=$1`, [rep.body?.id ?? 'none']);
check('L5-CHAT-20', 'cskh', 'api', J, 'CSKH trả lời khách', '201, lưu STAFF/ADMIN, ghi adminUserId = cskh, đã cắt khoảng trắng', rep.status < 300 && rr?.sender === 'STAFF' && rr?.a === 'uat_cskh' && rr?.body === 'Đơn của bạn đang trên đường giao nhé.', `HTTP ${rep.status}, DB ${JSON.stringify(rr)}`, short(rep.body, 200));
const cm = await call('returning', 'GET', '/me/support-chat/messages');
check('L5-CHAT-21', 'returning', 'api', J, 'Khách thấy câu trả lời', 'tin STAFF có trong khung chat', (cm.body.messages ?? []).some((m) => m.body === 'Đơn của bạn đang trên đường giao nhé.'), `${(cm.body.messages ?? []).length} tin, thấy=${(cm.body.messages ?? []).some((m) => m.body === 'Đơn của bạn đang trên đường giao nhé.')}`, (cm.body.messages ?? []).slice(-2));
const adminLeak = JSON.stringify(cm.body.messages ?? []);
check('L5-CHAT-22', 'returning', 'api', J, 'Tin trả khách không lộ trường nội bộ (adminUserId, forwardId, Zalo)', 'không có adminUserId / forwardId / zalo trong JSON khách nhận', !/adminUserId|forwardId|uat_cskh|zaloMsgId/i.test(adminLeak), /adminUserId|forwardId|uat_cskh|zaloMsgId/i.test(adminLeak) ? 'CÓ trường nội bộ' : 'sạch', adminLeak.slice(0, 300));
const sum = await call('returning', 'GET', '/me/support-chat/summary');
check('L5-CHAT-23', 'returning', 'api', J, 'Số tin chưa đọc của khách', '≥ 1 sau khi CSKH trả lời', (sum.body.unreadCount ?? 0) >= 1, `unreadCount=${sum.body.unreadCount}`, short(sum.body));
await call('returning', 'POST', '/me/support-chat/read', {});
const sum2 = await call('returning', 'GET', '/me/support-chat/summary');
check('L5-CHAT-24', 'returning', 'api', J, 'Khách đánh dấu đã đọc', 'unreadCount = 0', sum2.body.unreadCount === 0, `unreadCount=${sum2.body.unreadCount}`, short(sum2.body));
for (const [name, b, want] of [['rỗng', { body: '   ' }, 400], ['1001 ký tự', { body: 'b'.repeat(1001) }, 400], ['thiếu body', {}, 400]]) {
  const x = await call('cskh', 'POST', `/admin/support-chat/conversations/${conv.id}/reply`, b);
  check(`L5-CHAT-25-${name}`, 'cskh', 'api', J, `CSKH trả lời ${name}`, `${want} JSON`, x.status === want, `HTTP ${x.status}`, short(x.body, 160));
}
const repNf = await call('cskh', 'POST', '/admin/support-chat/conversations/khong-co/reply', { body: 'x' });
check('L5-CHAT-26', 'cskh', 'api', J, 'Trả lời hội thoại không tồn tại', '404', repNf.status === 404, `HTTP ${repNf.status}`, short(repNf.body));

// Chặn / bỏ chặn
const blk = await call('cskh', 'POST', `/admin/support-chat/conversations/${conv.id}/block`, {});
const mb = cid();
const sb = await call('returning', 'POST', '/me/support-chat/messages', { clientMsgId: mb, body: 'tin khi bị chặn' });
const retry = await call('returning', 'POST', '/me/support-chat/messages', { clientMsgId: m1, body: 'x' });
const thB = await call('returning', 'GET', '/me/support-chat');
check('L5-CHAT-27', 'cskh', 'api', J, 'CSKH chặn khách; khách gửi tin mới', 'chặn 200; khách gửi 403 CHAT_BLOCKED; thread.blocked=true', blk.status < 300 && sb.status === 403 && sb.body?.code === 'CHAT_BLOCKED' && thB.body.blocked === true, `block ${blk.status}; gửi ${sb.status} ${sb.body?.code}; blocked=${thB.body.blocked}`, short(sb.body));
check('L5-CHAT-28', 'returning', 'api', J, 'Khách bị chặn thử lại tin đã lưu (cùng clientMsgId)', 'trả tin cũ, không báo lỗi (support-chat.service.ts:117)', retry.status < 300, `HTTP ${retry.status}`, short(retry.body, 160));
const [bt] = await sql(`SELECT count(*)::int n FROM support_messages WHERE "clientMsgId"=$1`, [mb]);
check('L5-CHAT-29', 'returning', 'api', J, 'Tin gửi khi bị chặn không được lưu', '0 dòng', bt.n === 0, `${bt.n} dòng`, null);
const ub = await call('cskh', 'DELETE', `/admin/support-chat/conversations/${conv.id}/block`);
const su = await call('returning', 'POST', '/me/support-chat/messages', { clientMsgId: cid(), body: 'sau khi bỏ chặn' });
check('L5-CHAT-30', 'cskh', 'api', J, 'CSKH bỏ chặn; khách gửi lại', 'bỏ chặn 200; khách gửi được', ub.status < 300 && su.status < 300, `bỏ chặn ${ub.status}; gửi ${su.status}`, short(su.body, 160));
const blkNf = await call('cskh', 'POST', '/admin/support-chat/conversations/khong-co/block', {});
check('L5-CHAT-31', 'cskh', 'api', J, 'Chặn hội thoại không tồn tại', '404 (không 500)', blkNf.status === 404, `HTTP ${blkNf.status}`, short(blkNf.body));

// Cầu nối (ADMIN) và chuyển tiếp
for (const [m, p] of [['POST', 'bridge/qr'], ['POST', 'bridge/logout'], ['POST', 'bridge/reconnect'], ['GET', 'bridge/groups'], ['POST', 'bridge/test']]) {
  const x = await call('cskh', m, `/admin/support-chat/${p}`, m === 'POST' ? {} : undefined);
  check(`L5-CHAT-32-${p}`, 'cskh', 'api', J, `CSKH ${m} ${p}`, '403 (quản lý cầu nối chỉ ADMIN)', x.status === 403, `HTTP ${x.status}`, short(x.body));
}
const brC = await call('cskh', 'GET', '/admin/support-chat/bridge');
check('L5-CHAT-33', 'cskh', 'api', J, 'CSKH xem trạng thái cầu nối', '200 (CSKH cần biết cầu nối sống hay chết)', brC.status === 200, `HTTP ${brC.status}`, short(brC.body, 250));
const brA = await call('admin', 'GET', '/admin/support-chat/bridge');
const qrA = await call('admin', 'POST', '/admin/support-chat/bridge/qr', {});
rec('L5-CHAT-34', 'admin', 'api', J, 'ADMIN yêu cầu mã QR đăng nhập Zalo khi cầu nối không chạy', 'lỗi gọn bằng tiếng Việt (502/503), không 500 trần, không lộ stack', `status ${brA.status} / qr ${qrA.status}`, short(qrA.body, 300), qrA.status < 500 || (qrA.status === 502 || qrA.status === 503) ? (/at .*\.ts|node_modules|ECONNREFUSED/.test(JSON.stringify(qrA.body)) ? 'FAIL' : 'PASS') : 'FAIL');
const fw = await sql(`SELECT f.id, f.status FROM support_forwards f JOIN support_conversations c ON c.id=f."conversationId" WHERE c."userId"=$1 ORDER BY f."createdAt" DESC LIMIT 3`, [me.id]);
rec('L5-CHAT-35', 'returning', 'api', J, 'Tin khách được chuyển sang nhóm Zalo của nhân viên', 'forward có trạng thái SENT khi cầu nối chạy', `${fw.length} lần chuyển: ${fw.map((f) => f.status).join(',') || 'không có (chưa có nhóm Zalo / cầu nối)'}`, fw, 'BLOCKED');
if (fw[0]) {
  const rs = await call('cskh', 'POST', `/admin/support-chat/forwards/${fw[0].id}/resend`, {});
  const rsNf = await call('cskh', 'POST', '/admin/support-chat/forwards/khong-co/resend', {});
  rec('L5-CHAT-36', 'cskh', 'api', J, 'CSKH "Gửi lại" một lần chuyển', 'JSON gọn; id lạ 404', `resend ${rs.status}; id lạ ${rsNf.status}`, short(rs.body, 200), rsNf.status === 404 && rs.status < 500 ? 'PASS' : 'FAIL');
}
const inbox = await call('cskh', 'GET', '/admin/ops/inbox');
const ib = Object.fromEntries((inbox.body.items ?? []).map((i) => [i.key, i.count]));
rec('L5-CHAT-37', 'cskh', 'api', J, 'Hộp việc CSKH: supportChatUnforwarded / zaloBridgeDown', 'có mục đếm tin chưa chuyển', `supportChatUnforwarded=${ib.supportChatUnforwarded}, zaloBridgeDown=${ib.zaloBridgeDown}`, ib, ib.supportChatUnforwarded !== undefined ? 'PASS' : 'CAN_CHU');
// Giới hạn ngày 200 tin
const dayCount = (await sql(`SELECT count(*)::int n FROM support_messages WHERE "conversationId"=$1 AND sender='CUSTOMER' AND "createdAt" >= (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')`, [conv.id]))[0].n;
const bulk = 200 - dayCount;
if (bulk > 0) {
  await sql(`INSERT INTO support_messages (id,"conversationId",sender,source,body,"clientMsgId","createdAt") SELECT 'uatbulk'||g||substr(md5(random()::text),1,8), $1, 'CUSTOMER','MINIAPP','bulk '||g, 'uatbulk'||g||substr(md5(random()::text),1,10), now() FROM generate_series(1,$2) g`, [conv.id, bulk]);
}
const lim = await call('returning', 'POST', '/me/support-chat/messages', { clientMsgId: cid(), body: 'tin thứ 201' });
check('L5-CHAT-38', 'returning', 'api', J, 'Khách gửi tin thứ 201 trong ngày', '429 code CHAT_DAILY_LIMIT, có hotline (support-chat.service.ts:141)', lim.status === 429 && lim.body?.code === 'CHAT_DAILY_LIMIT', `HTTP ${lim.status} ${lim.body?.code}`, short(lim.body));
await sql(`DELETE FROM support_messages WHERE id LIKE 'uatbulk%'`);

// Khôi phục
await call('admin', 'PUT', '/admin/support-chat/settings', { enabled: wasEnabled });
const [fin] = await sql(`SELECT value v FROM system_configs WHERE key='chat.enabled'`);
check('L5-CHAT-39', 'admin', 'api', J, `Khôi phục chat.enabled = ${wasEnabled}`, 'về bản gốc', (fin?.v ?? false) === wasEnabled, `DB ${JSON.stringify(fin?.v)}`, null);
save('08-chat');
process.exit(0);
