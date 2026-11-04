// Giới hạn thân request (API lane 5): webhook Pancake thiếu token, JSON sâu/nhiều khoá, gzip hỏng, content-encoding lạ, quá trần.
// Nguồn luật: apps/api/src/common/body-limits.ts (trần 256kb mặc định, 1mb webhook, 10mb admin/Pancake; 10 tầng; 6000 nút; 200 khoá/object).
import zlib from 'node:zlib';
import { ENV, L, check, rec, save, short, toneProblems, tok } from './_lib.mjs';

const BASE = L.apiUrl127;
const bypass = { 'x-throttle-bypass': ENV.THROTTLE_BYPASS_TOKEN };
const SRC = 'body-limits.ts';

async function raw(method, p, { headers = {}, body, auth } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { ...bypass, ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers },
    body,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: res.status, ct: res.headers.get('content-type') ?? '', text, json };
}
const isJson = (r) => r.json !== null && /json/.test(r.ct);
const J = { 'content-type': 'application/json' };
const nest = (d) => '{"a":'.repeat(d) + '1' + '}'.repeat(d);

// --- 1. Webhook Pancake thiếu token: mọi method 401 -------------------------------------------
for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'GET']) {
  const r = await raw(m, '/webhooks/pancake', { headers: J, body: m === 'GET' ? undefined : '{"type":"orders"}' });
  check(`L5-BL-pk-${m}`, 'anonymous', 'api', 'Webhook Pancake', `${m} /webhooks/pancake không token`, '401 JSON (body-limits.ts pancakeWebhookTokenGuard, mọi method)',
    r.status === 401 && isJson(r), `HTTP ${r.status}`, `${m} -> ${r.status} ${short(r.text, 160)}`);
}
{
  const r = await raw('POST', '/webhooks/pancake', { headers: { ...J, 'x-webhook-token': 'sai-token' }, body: '{"type":"orders"}' });
  check('L5-BL-pk-wrong', 'anonymous', 'api', 'Webhook Pancake', 'POST token sai', '401', r.status === 401, `HTTP ${r.status}`, short(r.text, 160));
}
{
  // Thân 11 MB không token: phải dừng 401 trước khi parse (không 413).
  const big = JSON.stringify({ type: 'orders', pad: 'x'.repeat(11 * 1024 * 1024) });
  const r = await raw('POST', '/webhooks/pancake', { headers: J, body: big });
  check('L5-BL-pk-big-notoken', 'anonymous', 'api', 'Webhook Pancake', 'POST 11MB không token', '401 (token kiểm trước parse)', r.status === 401, `HTTP ${r.status}`, short(r.text, 160));
}
{
  const big = JSON.stringify({ type: 'orders', pad: 'x'.repeat(11 * 1024 * 1024) });
  const r = await raw('POST', '/webhooks/pancake', { headers: { ...J, 'x-webhook-token': ENV.PANCAKE_WEBHOOK_SECRET }, body: big });
  check('L5-BL-pk-big-token', 'anonymous', 'api', 'Webhook Pancake', 'POST 11MB có token đúng', '413 JSON (trần 10mb)', r.status === 413 && isJson(r), `HTTP ${r.status}`, short(r.text, 160));
}

// --- 2. JSON quá sâu / quá nhiều khoá -> 400 JSON ----------------------------------------------
const anyDefault = '/auth/refresh';
for (const [id, label, body] of [
  ['deep11', 'JSON sâu 11 tầng', nest(11)],
  ['deep500', 'JSON sâu 500 tầng', nest(500)],
  ['keys201', 'JSON object 201 khoá', JSON.stringify(Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, i])))],
  ['nodes7000', 'JSON 7000 nút (35 object x 200 khoá)', JSON.stringify(Array.from({ length: 35 }, () => Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]))))],
  ['array501', 'JSON mảng 501 phần tử', JSON.stringify({ ids: Array.from({ length: 501 }, (_, i) => `id${i}`) })],
  ['bigflat', 'JSON 60 000 khoá phẳng (~600KB, trần 256kb nên 413 hoặc 400)', JSON.stringify(Object.fromEntries(Array.from({ length: 60000 }, (_, i) => [`k${i}`, 1])))],
]) {
  const r = await raw('POST', anyDefault, { headers: J, body });
  const ok = id === 'bigflat' ? (r.status === 400 || r.status === 413) && isJson(r) : r.status === 400 && isJson(r);
  check(`L5-BL-${id}`, 'anonymous', 'api', 'Thân quá phức tạp', `POST ${anyDefault} ${label}`, '400 JSON "quá phức tạp" (hoặc 413 nếu trần dung lượng trước)', ok, `HTTP ${r.status}`, `${r.status} ${short(r.text, 200)}`);
  const tone = toneProblems(r.text);
  if (tone.length) rec(`L5-BL-${id}-tone`, 'anonymous', 'api', 'Giọng lời API', `lời lỗi ${label}`, 'giọng đợt 8', `vi phạm: ${tone.join(', ')}`, short(r.text), 'FAIL');
}
{
  // Đối chứng: thân hợp lệ sâu 10 tầng phải qua parser (không 400 "phức tạp").
  const r = await raw('POST', anyDefault, { headers: J, body: nest(10) });
  check('L5-BL-deep10-ok', 'anonymous', 'api', 'Thân quá phức tạp', 'JSON sâu 10 tầng (đúng trần)', 'qua parser (không 413/415/"quá phức tạp")',
    !/phức tạp/.test(r.text) && r.status !== 413 && r.status !== 415, `HTTP ${r.status}`, short(r.text, 160));
}
{
  // Admin route cũng áp: cần token, nhưng parser chạy trước auth nên 400 vẫn tới.
  const r = await raw('PUT', '/admin/config', { headers: J, body: nest(12), auth: await tok('admin') });
  check('L5-BL-deep-admin', 'admin', 'api', 'Thân quá phức tạp', 'PUT /admin/config JSON sâu 12 tầng', '400 JSON', r.status === 400 && isJson(r), `HTTP ${r.status}`, short(r.text, 200));
}

// --- 3. gzip hỏng -> 400 JSON, không lộ chữ zlib ----------------------------------------------
{
  const r = await raw('POST', anyDefault, { headers: { ...J, 'content-encoding': 'gzip' }, body: Buffer.from('khong-phai-gzip-1234567890') });
  const leak = /zlib|incorrect header|Z_DATA|inflate|unexpected end/i.test(r.text);
  check('L5-BL-gzip-bad', 'anonymous', 'api', 'Thân gzip', 'POST thân gzip hỏng (byte rác)', '400 JSON, không lộ chữ zlib', r.status === 400 && isJson(r) && !leak, `HTTP ${r.status}`, short(r.text, 200));
  const tone = toneProblems(r.text);
  if (tone.length) rec('L5-BL-gzip-bad-tone', 'anonymous', 'api', 'Giọng lời API', 'lời lỗi gzip hỏng', 'giọng đợt 8', `vi phạm: ${tone.join(', ')}`, short(r.text), 'FAIL');
}
{
  const good = zlib.gzipSync(Buffer.from('{"refreshToken":"x"}'));
  const trunc = good.subarray(0, good.length - 6);
  const r = await raw('POST', anyDefault, { headers: { ...J, 'content-encoding': 'gzip' }, body: trunc });
  const leak = /zlib|incorrect header|Z_DATA|inflate|unexpected end/i.test(r.text);
  check('L5-BL-gzip-trunc', 'anonymous', 'api', 'Thân gzip', 'POST thân gzip cụt', '400 JSON, không lộ chữ zlib', r.status === 400 && isJson(r) && !leak, `HTTP ${r.status}`, short(r.text, 200));
}
{
  const r = await raw('POST', anyDefault, { headers: { ...J, 'content-encoding': 'deflate' }, body: Buffer.from('rac-rac-rac-rac') });
  const leak = /zlib|incorrect header|Z_DATA|inflate|unexpected end/i.test(r.text);
  check('L5-BL-deflate-bad', 'anonymous', 'api', 'Thân deflate', 'POST thân deflate hỏng', '400 JSON, không lộ chữ zlib', r.status === 400 && isJson(r) && !leak, `HTTP ${r.status}`, short(r.text, 200));
}
{
  // Đối chứng gzip hợp lệ.
  const r = await raw('POST', anyDefault, { headers: { ...J, 'content-encoding': 'gzip' }, body: zlib.gzipSync(Buffer.from('{"refreshToken":"x"}')) });
  check('L5-BL-gzip-ok', 'anonymous', 'api', 'Thân gzip', 'POST thân gzip hợp lệ', 'qua parser (API trả lỗi nghiệp vụ, không 4xx của parser)', ![413, 415].includes(r.status) && !/không đọc được/.test(r.text), `HTTP ${r.status}`, short(r.text, 160));
}
{
  // Zip-bomb: gzip nhỏ giải nén > 256kb phải 413, không treo.
  const bomb = zlib.gzipSync(Buffer.from(JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) })));
  const t0 = Date.now();
  const r = await raw('POST', anyDefault, { headers: { ...J, 'content-encoding': 'gzip' }, body: bomb });
  check('L5-BL-gzip-bomb', 'anonymous', 'api', 'Thân gzip', `gzip ${bomb.length}B giải nén 2MB`, '413 JSON (trần tính trên thân đã giải nén)', r.status === 413 && isJson(r), `HTTP ${r.status} ${Date.now() - t0}ms`, short(r.text, 160));
}

// --- 4. content-encoding lạ -> 415 -------------------------------------------------------------
for (const enc of ['br2', 'compress', 'zstd', 'foo']) {
  const r = await raw('POST', anyDefault, { headers: { ...J, 'content-encoding': enc }, body: '{"a":1}' });
  check(`L5-BL-enc-${enc}`, 'anonymous', 'api', 'Content-Encoding lạ', `POST Content-Encoding: ${enc}`, '415 JSON', r.status === 415 && isJson(r), `HTTP ${r.status}`, short(r.text, 200));
}
{
  const r = await raw('POST', anyDefault, { headers: { 'content-type': 'application/json; charset=utf-16le' }, body: Buffer.from('{"a":1}', 'utf16le') });
  check('L5-BL-charset', 'anonymous', 'api', 'Charset lạ', 'POST charset utf-16le', '415 JSON', r.status === 415 && isJson(r), `HTTP ${r.status}`, short(r.text, 200));
}

// --- 5. Quá trần dung lượng -> 413 -------------------------------------------------------------
const pad = (n) => JSON.stringify({ pad: 'x'.repeat(n) });
for (const [id, p, size, auth, lim] of [
  ['default', anyDefault, 300 * 1024, null, '256kb'],
  ['default-ok', anyDefault, 200 * 1024, null, 'dưới 256kb -> qua'],
  ['webhook', '/webhooks/zalo-oa', 1.2 * 1024 * 1024, null, '1mb'],
  ['admin', '/admin/config', 11 * 1024 * 1024, 'admin', '10mb'],
  ['admin-ok', '/admin/config', 2 * 1024 * 1024, 'admin', 'dưới 10mb -> qua parser'],
]) {
  const r = await raw(p === '/admin/config' ? 'PUT' : 'POST', p, { headers: J, body: pad(Math.floor(size)), auth: auth ? await tok(auth) : undefined });
  const wantOver = !/-ok$/.test(id);
  const ok = wantOver ? r.status === 413 && isJson(r) : r.status !== 413;
  check(`L5-BL-size-${id}`, auth ?? 'anonymous', 'api', 'Thân quá trần', `${p === '/admin/config' ? 'PUT' : 'POST'} ${p} ${(size / 1024) | 0}KB (trần ${lim})`, wantOver ? '413 JSON' : 'không 413', ok, `HTTP ${r.status}`, short(r.text, 200));
  const tone = toneProblems(r.text);
  if (tone.length) rec(`L5-BL-size-${id}-tone`, 'anonymous', 'api', 'Giọng lời API', 'lời lỗi 413', 'giọng đợt 8', `vi phạm: ${tone.join(', ')}`, short(r.text), 'FAIL');
}
{
  const r = await raw('POST', anyDefault, { headers: J, body: '{"a":' });
  check('L5-BL-json-bad', 'anonymous', 'api', 'JSON hỏng', 'POST JSON dở dang', '400 JSON', r.status === 400 && isJson(r), `HTTP ${r.status}`, short(r.text, 200));
  const r2 = await raw('POST', anyDefault, { headers: J, body: '{"a":"\\u0000x"}' });
  check('L5-BL-nul', 'anonymous', 'api', 'Ký tự NUL', 'POST chuỗi có \\u0000', '400 JSON', r2.status === 400 && isJson(r2), `HTTP ${r2.status}`, short(r2.text, 200));
  const r3 = await raw('GET', '/products%00x', {});
  check('L5-BL-nul-url', 'anonymous', 'api', 'Ký tự NUL', 'GET /products%00x', '400 JSON', r3.status === 400 && isJson(r3), `HTTP ${r3.status}`, short(r3.text, 200));
}
save('01-body-limits');
