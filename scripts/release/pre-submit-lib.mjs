#!/usr/bin/env node
// Các phép kiểm có số của scripts/release/pre-submit-check.sh (trước khi gửi duyệt Zalo, tubu-w36-02). Mỗi lệnh in một dòng kết quả, thoát 0 khi đạt, 1 khi không.
//   node scripts/release/pre-submit-lib.mjs entry <apps/miniapp/www> <scripts/release/mini-entry-baseline.json>
//       entry (script module trong index.html) đúng bằng entryBytes của baseline; UPDATE_MINI_ENTRY_BASELINE=1 thì ghi số mới vào baseline.
//   node scripts/release/pre-submit-lib.mjs zalo <kết quả check-submission --json> <số mục chờ>
//       số mục ĐẠT = tổng số mục = số chờ (EXPECTED_ZALO_CHECKS): thêm hay bớt mục kiểm phải sửa số chờ có chủ đích.
//   node scripts/release/pre-submit-lib.mjs go-live <bản in của go-live:check --phase=pre-deploy>
//       0 FAIL, và không có cảnh báo db.bank_account (số tài khoản mẫu cũ) trừ khi PRE_SUBMIT_BANK_ACCEPT_LAST4 trùng đuôi số trong cảnh báo:
//       PO chốt 24/11 cho PROD dùng tạm tài khoản đuôi 6774 tới khi có tài khoản công ty, nên lần chạy theo chốt đó đặt biến này và báo cáo ghi rõ.
//   node scripts/release/pre-submit-lib.mjs typecheck <log turbo> <số task chờ>
//       dòng "Tasks: N successful, N total" của turbo đúng bằng số chờ.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = (ok, line) => {
  console.log(`${ok ? 'ĐẠT' : 'KHÔNG ĐẠT'}  ${line}`);
  return ok ? 0 : 1;
};

export function entryOf(www) {
  const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
  const m = /<script[^>]*type="module"[^>]*src="\.?\/?([^"]+\.js)"/.exec(html);
  if (!m) throw new Error(`không thấy script module trong ${path.join(www, 'index.html')}`);
  const file = m[1];
  return { file, bytes: fs.statSync(path.join(www, file)).size };
}

export function totalBytes(dir) {
  let sum = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    sum += e.isDirectory() ? totalBytes(p) : fs.statSync(p).size;
  }
  return sum;
}

function checkEntry(www, baselineFile) {
  const base = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const { file, bytes } = entryOf(www);
  const total = totalBytes(www);
  if (process.env.UPDATE_MINI_ENTRY_BASELINE === '1') {
    fs.writeFileSync(baselineFile, `${JSON.stringify({ ...base, entryBytes: bytes, totalBytes: total }, null, 2)}\n`);
    return out(true, `ghi baseline mới: entry ${file} ${bytes} B (cũ ${base.entryBytes} B), tổng ${total} B`);
  }
  const diff = bytes - base.entryBytes;
  return out(diff === 0, `entry ${file} ${bytes} B, baseline ${base.entryBytes} B (${diff >= 0 ? '+' : ''}${diff} B); tổng www ${total} B`);
}

export function zaloVerdict(report, expected) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const passed = checks.filter((c) => c.ok === true).length;
  const failed = checks.filter((c) => c.ok !== true).map((c) => c.id);
  return { ok: checks.length > 0 && passed === checks.length && checks.length === expected, passed, total: checks.length, failed };
}

function checkZalo(file, expectedRaw) {
  const expected = Number(expectedRaw);
  if (!Number.isInteger(expected) || expected <= 0) return out(false, `số mục chờ "${expectedRaw}" không phải số nguyên dương`);
  const v = zaloVerdict(JSON.parse(fs.readFileSync(file, 'utf8')), expected);
  return out(v.ok, `check-submission ${v.passed}/${v.total} mục đạt, chờ ${expected}${v.failed.length ? `; không đạt: ${v.failed.join(', ')}` : ''}`);
}

/** Đọc bản in của go-live-check (đầy đủ hay đã lọc chỉ còn WARN/FAIL như log dep1). */
export function goLiveVerdict(text, acceptLast4 = '') {
  const total = /Tổng:\s*(\d+)\s*PASS,\s*(\d+)\s*WARN,\s*(\d+)\s*FAIL/.exec(text);
  const phase = /Kiểm tra go-live \(giai đoạn ([^)]+)\)/.exec(text)?.[1] ?? null;
  const fails = text.split('\n').filter((l) => /^\s*\[FAIL\]/.test(l)).map((l) => l.trim());
  const bankLine = text.split('\n').find((l) => /^\s*\[WARN\]\s+db\.bank_account\b/.test(l))?.trim() ?? null;
  const bankLast4 = bankLine ? (/đuôi (\d{4})/.exec(bankLine)?.[1] ?? '????') : null;
  const bankAccepted = bankLine !== null && acceptLast4 !== '' && bankLast4 === acceptLast4;
  const reasons = [];
  if (!total) reasons.push('không thấy dòng "Tổng: N PASS, N WARN, N FAIL"');
  if (phase !== null && phase !== 'pre-deploy') reasons.push(`giai đoạn ${phase}, cần pre-deploy`);
  if (total && Number(total[3]) > 0) reasons.push(`${total[3]} FAIL`);
  if (fails.length > 0) reasons.push(...fails);
  if (bankLine && !bankAccepted) reasons.push(`cảnh báo tài khoản ngân hàng mẫu cũ (đuôi ${bankLast4})`);
  return {
    ok: reasons.length === 0,
    pass: total ? Number(total[1]) : null,
    warn: total ? Number(total[2]) : null,
    fail: total ? Number(total[3]) : null,
    bankLast4,
    bankAccepted,
    reasons,
  };
}

function checkGoLive(file) {
  const v = goLiveVerdict(fs.readFileSync(file, 'utf8'), process.env.PRE_SUBMIT_BANK_ACCEPT_LAST4 ?? '');
  const note = v.bankAccepted ? `; cảnh báo db.bank_account đuôi ${v.bankLast4} được chấp nhận theo PRE_SUBMIT_BANK_ACCEPT_LAST4 (chốt PO 24/11)` : '';
  return out(v.ok, `go-live ${v.pass ?? '?'} PASS, ${v.warn ?? '?'} WARN, ${v.fail ?? '?'} FAIL${note}${v.reasons.length ? `; ${v.reasons.join('; ')}` : ''}`);
}

function checkTypecheck(file, expectedRaw) {
  const expected = Number(expectedRaw);
  const m = /Tasks:\s*(\d+)\s+successful,\s*(\d+)\s+total/.exec(fs.readFileSync(file, 'utf8'));
  if (!m) return out(false, 'không thấy dòng "Tasks: N successful, N total" của turbo');
  return out(Number(m[1]) === expected && Number(m[2]) === expected, `typecheck ${m[1]}/${m[2]} task, chờ ${expected}`);
}

const COMMANDS = { entry: checkEntry, zalo: checkZalo, 'go-live': checkGoLive, typecheck: checkTypecheck };

// So đường thật: gọi qua symlink hay đường có dấu cách mà so chuỗi thô thì khối dưới không chạy và script thoát 0 không kiểm gì.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [cmd, ...args] = process.argv.slice(2);
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.error(`lệnh không biết: ${cmd ?? '(trống)'}; dùng: ${Object.keys(COMMANDS).join(', ')}`);
    process.exit(2);
  }
  try {
    process.exit(fn(...args));
  } catch (e) {
    console.error(`KHÔNG ĐẠT  ${cmd}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
