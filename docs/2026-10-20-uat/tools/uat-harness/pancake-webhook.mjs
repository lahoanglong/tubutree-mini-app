#!/usr/bin/env node
// Gửi webhook Pancake tới API lane với token chia sẻ đúng PANCAKE_WEBHOOK_SECRET của lane (header x-webhook-token — Pancake POS
// không ký HMAC, xem apps/api/src/modules/integrations/pancake/pancake-webhook.controller.ts). Payload là nguyên object đơn
// (type 'orders') lấy từ giả Pancake của lane, nên trạng thái giả Pancake và Tubu đi cùng nhau.
//
// Đơn app:   pancake-webhook.mjs <lane> <mãĐơnTubu|idPancake> <trạngThái> [--tracking MÃ] [--carrier TÊN] [--bank SỐ] [--prepaid SỐ] [--dry]
// Đơn ngoài: pancake-webhook.mjs <lane> platform <idPancake|mã vận đơn|mã đơn sàn> [trạngThái]   (sàn/chat trong platform-orders.json)
// Trạng thái: tên (confirmed packed shipped delivered paid returning returned partial cancelled deleted) hoặc mã số Pancake.
// In kết quả xử lý (pancake_webhook_events.status) và trạng thái đơn Tubu sau khi worker chạy.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { closePrisma, jsonOut, lane, laneEnv, prismaFor, sleep } from './lib.mjs';

export const STATUS = {
  new: 0, confirmed: 1, shipped: 2, shipping: 2, delivered: 3, received: 3, returning: 4, returned: 5, cancelled: 6, canceled: 6,
  deleted: 7, packing: 8, packed: 8, waiting: 9, partial: 15, paid: 16,
};

export function statusCode(s) {
  if (s === undefined || s === null) return undefined;
  const k = String(s).trim().toLowerCase();
  if (/^\d+$/.test(k)) return Number(k);
  if (!(k in STATUS)) throw new Error(`trạng thái lạ "${s}" — dùng ${Object.keys(STATUS).join(', ')} hoặc mã số`);
  return STATUS[k];
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Cùng công thức pancakeDedupeKey của API — để tìm đúng dòng pancake_webhook_events vừa tạo. */
export function dedupeKey(body) {
  const type = body.event ?? body.type ?? 'order';
  return `${String(type).slice(0, 120)}|${createHash('sha256').update(canonicalJson(body)).digest('hex')}`;
}

const vnNow = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 19);

async function fake(L, p, init) {
  const r = await fetch(`${L.pancakeUrl}${p}`, init);
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}

/** POST webhook rồi chờ worker BullMQ xử lý xong (tối đa ~20 giây). */
export async function postWebhook(L, body, { wait = true } = {}) {
  const env = laneEnv(L);
  const res = await fetch(`${L.apiUrl127}/webhooks/pancake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-token': env.PANCAKE_WEBHOOK_SECRET },
    body: JSON.stringify(body),
  });
  const reply = await res.json().catch(() => null);
  const out = { http: res.status, reply };
  if (!wait || res.status !== 200) return out;
  const prisma = prismaFor(L);
  const key = dedupeKey(body);
  for (let i = 0; i < 40; i++) {
    const ev = await prisma.pancakeWebhookEvent.findUnique({ where: { dedupeKey: key } });
    if (ev && !['RECEIVED', 'PROCESSING'].includes(ev.status)) {
      out.event = { id: ev.id, status: ev.status, error: ev.error, attempts: ev.attempts };
      break;
    }
    await sleep(500);
  }
  if (!out.event) out.event = { status: 'CHƯA XỬ LÝ sau 20 giây — xem log API' };
  return out;
}

/** Đổi trạng thái đơn app trên giả Pancake rồi bắn webhook đơn đó. */
export async function sendOrderStatus(L, key, status, opts = {}) {
  const found = await fake(L, `/__uat/find?code=${encodeURIComponent(key)}`);
  if (found.status !== 200 || found.body.kind !== 'app') {
    throw new Error(`Giả Pancake lane ${L.n} không có đơn app "${key}" (đơn đã được đẩy lên Pancake chưa? xem orders.pancakePushStatus)`);
  }
  const cur = found.body.order;
  const patch = {};
  const code = statusCode(status);
  if (code !== undefined) patch.status = code;
  const tracking = opts.tracking ?? (code === 2 && !cur.partner?.extend_code ? `UATGHN${String(cur.id).slice(-6)}${L.n}` : undefined);
  if (tracking || opts.carrier) {
    patch.partner = { ...(cur.partner ?? {}), extend_code: tracking ?? cur.partner?.extend_code, partner_name: opts.carrier ?? cur.partner?.partner_name ?? 'GHN' };
  }
  if (opts.bank !== undefined) patch.bank_payment = Number(opts.bank);
  if (opts.prepaid !== undefined) patch.prepaid = Number(opts.prepaid);
  const upd = await fake(L, `/__uat/app-orders/${encodeURIComponent(cur.id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = { type: 'orders', ...upd.body };
  if (opts.dry) return { dry: true, body };
  const sent = await postWebhook(L, body);
  const orderCode = body.custom_id ?? body.extension?.external_order_id;
  const order = orderCode
    ? await prismaFor(L).order.findUnique({
        where: { code: orderCode },
        select: { code: true, status: true, paymentStatus: true, pancakeOrderId: true, shippingCode: true, deliveredAt: true, pancakeAttention: true },
      })
    : null;
  return { pancake: { id: body.id, status: body.status, status_name: body.status_name }, ...sent, order };
}

/** Bắn webhook một đơn ngoài app (sàn/chat) trong platform-orders.json; đổi trạng thái thì ghi lại file. */
export async function sendPlatform(L, key, status, opts = {}) {
  const file = path.join(L.pancakeDir, 'platform-orders.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const norm = (s) => String(s ?? '').toUpperCase().replace(/[\s_-]+/g, '');
  const k = norm(key);
  const idx = list.findIndex(
    (o) => norm(o.id) === k || norm(o.partner?.extend_code) === k || norm(o.tracking_number) === k || (o.invoice_info_list ?? []).some((i) => norm(i.order_sn) === k),
  );
  if (idx < 0) throw new Error(`platform-orders.json lane ${L.n} không có đơn "${key}"`);
  const code = statusCode(status);
  if (code !== undefined && code !== list[idx].status) {
    const at = vnNow();
    list[idx] = { ...list[idx], status: code, updated_at: at, status_history: [...(list[idx].status_history ?? []), { status: code, updated_at: at }] };
    fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
  }
  const body = { type: 'orders', ...list[idx] };
  if (opts.dry) return { dry: true, body };
  const sent = await postWebhook(L, body);
  const ext = await prismaFor(L).externalOrder.findFirst({ where: { pancakeOrderId: String(body.id) } }).catch(() => null);
  return { pancake: { id: body.id, status: body.status }, ...sent, externalOrder: ext };
}

function parseOpts(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry') o.dry = true;
    else if (a.startsWith('--')) o[a.slice(2)] = args[++i];
  }
  return o;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry') continue;
    if (args[i].startsWith('--')) { i++; continue; }
    pos.push(args[i]);
  }
  const opts = parseOpts(args);
  if (pos.length < 2 || (pos[1] !== 'platform' && pos.length < 3)) {
    console.error('dùng: pancake-webhook.mjs <lane> <mãĐơn|idPancake> <trạngThái> [--tracking M] [--carrier T] [--bank N] [--prepaid N] [--dry]');
    console.error('      pancake-webhook.mjs <lane> platform <id|mã vận đơn|mã đơn sàn> [trạngThái] [--dry]');
    process.exit(2);
  }
  const L = lane(pos[0]);
  try {
    jsonOut(pos[1] === 'platform' ? await sendPlatform(L, pos[2], pos[3], opts) : await sendOrderStatus(L, pos[1], pos[2], opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await closePrisma();
  }
}
