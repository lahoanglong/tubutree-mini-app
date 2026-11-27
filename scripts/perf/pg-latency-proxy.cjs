#!/usr/bin/env node
/**
 * Proxy TCP chen giua API va Postgres de do API nhu tren mang that:
 *  - tre LATENCY_MS cho moi goi client -> server (mot vong hoi-dap Postgres ton ~LATENCY_MS, giong RTT that),
 *  - dem so cau lenh (Execute + Query) va do do sau tuan tu (chuoi dai nhat cac vong hoi-dap khong chong nhau).
 *
 * Chi doc giao thuc, khong sua byte nao. Dung cho DB tam/perf, KHONG tro vao PROD.
 *
 *   PG_TARGET=127.0.0.1:5571 PROXY_PORT=5573 CONTROL_PORT=5574 LATENCY_MS=0 node scripts/perf/pg-latency-proxy.cjs
 *   curl 'localhost:5574/latency?ms=30'   # doi do tre luc dang chay
 *   curl localhost:5574/reset             # xoa so dem, bat dau ghi
 *   curl localhost:5574/stats             # {"statements":12,"roundTrips":14,"depth":5}
 */
const net = require('node:net');
const http = require('node:http');

const [targetHost, targetPort] = (process.env.PG_TARGET || '127.0.0.1:5432').split(':');
const LISTEN = Number(process.env.PROXY_PORT || 5573);
const CONTROL = Number(process.env.CONTROL_PORT || 5574);
let latency = Number(process.env.LATENCY_MS || 0);
// LOG_SQL=1: in cau SQL cua moi goi Parse/Query (chi lan dau moi ket noi soan cau; Prisma nho cau da soan theo ket noi).
const LOG_SQL = process.env.LOG_SQL === '1';
let connSeq = 0;

let statements = 0;
let roundTrips = [];

/** Chuoi dai nhat cac vong hoi-dap doi mot khong chong thoi gian = so buoc phai cho noi tiep. */
function depthOf(rts) {
  const sorted = [...rts].sort((a, b) => a.e - b.e);
  let lastEnd = -Infinity;
  let n = 0;
  for (const r of sorted) {
    if (r.s >= lastEnd) {
      n++;
      lastEnd = r.e;
    }
  }
  return n;
}

/** Tach goi theo khung Postgres (1 byte loai + int32 do dai). Goi dau (Startup/SSLRequest) khong co byte loai. */
function framer(onMessage) {
  let buf = Buffer.alloc(0);
  let untyped = 0;
  return {
    expectUntyped() {
      untyped++;
    },
    push(chunk) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        if (untyped > 0) {
          if (buf.length < 4) return;
          const len = buf.readInt32BE(0);
          if (buf.length < len) return;
          const code = len >= 8 ? buf.readInt32BE(4) : 0;
          buf = buf.subarray(len);
          untyped--;
          onMessage(null, code);
          continue;
        }
        if (buf.length < 5) return;
        const type = String.fromCharCode(buf[0]);
        const len = buf.readInt32BE(1);
        if (buf.length < len + 1) return;
        const body = buf.subarray(5, len + 1);
        buf = buf.subarray(len + 1);
        onMessage(type, 0, body);
      }
    },
  };
}

const SSL_REQUEST = 80877103;
const GSS_REQUEST = 80877104;

net
  .createServer((client) => {
    const upstream = net.connect(Number(targetPort), targetHost);
    const pending = [];
    let due = 0;
    let awaitSslByte = false;

    const conn = ++connSeq;
    const fromClient = framer((type, code, body) => {
      if (type === null) {
        if (code === SSL_REQUEST || code === GSS_REQUEST) {
          awaitSslByte = true;
          fromClient.expectUntyped();
        }
        return;
      }
      if (type === 'Q' || type === 'E') statements++;
      if (LOG_SQL && (type === 'P' || type === 'Q')) {
        const text = type === 'Q' ? body.toString('utf8', 0, body.indexOf(0)) : body.toString('utf8', body.indexOf(0) + 1, body.indexOf(0, body.indexOf(0) + 1));
        console.log(`${performance.now().toFixed(0)} c${conn} ${text.replace(/\s+/g, ' ').slice(0, 600)}`);
      }
      if (type === 'Q' || type === 'S') pending.push(performance.now());
    });
    fromClient.expectUntyped();

    const fromServer = framer((type) => {
      if (type !== 'Z') return;
      const s = pending.shift();
      if (s !== undefined) roundTrips.push({ s, e: performance.now() });
    });

    client.on('data', (chunk) => {
      fromClient.push(chunk);
      // Giu dung thu tu khi doi do tre giua chung: moi goi khong duoc den truoc goi truoc no.
      const now = performance.now();
      due = Math.max(due, now + latency);
      const wait = due - now;
      if (wait <= 0) upstream.write(chunk);
      else setTimeout(() => upstream.write(chunk), wait);
    });
    upstream.on('data', (chunk) => {
      if (awaitSslByte) {
        awaitSslByte = false;
        client.write(chunk.subarray(0, 1));
        chunk = chunk.subarray(1);
        if (!chunk.length) return;
      }
      fromServer.push(chunk);
      client.write(chunk);
    });
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', close);
    upstream.on('error', close);
    client.on('close', close);
    upstream.on('close', close);
  })
  .listen(LISTEN, '127.0.0.1', () => console.log(`pg-latency-proxy :${LISTEN} -> ${targetHost}:${targetPort}, latency ${latency}ms, control :${CONTROL}`));

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/latency') latency = Number(url.searchParams.get('ms') || 0);
    if (url.pathname === '/reset') {
      statements = 0;
      roundTrips = [];
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ latency, statements, roundTrips: roundTrips.length, depth: depthOf(roundTrips) }));
  })
  .listen(CONTROL, '127.0.0.1');
