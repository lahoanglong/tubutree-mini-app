import type { CheckResult, CheckStatus } from './types';

export interface Summary {
  pass: number;
  warn: number;
  fail: number;
}

export function summarize(results: readonly CheckResult[]): Summary {
  const s: Summary = { pass: 0, warn: 0, fail: 0 };
  for (const r of results) {
    if (r.status === 'PASS') s.pass += 1;
    else if (r.status === 'WARN') s.warn += 1;
    else s.fail += 1;
  }
  return s;
}

/** Thoát khác 0 khi có bất kỳ FAIL nào; WARN không chặn. */
export function exitCodeFor(results: readonly CheckResult[]): 0 | 1 {
  return results.some((r) => r.status === 'FAIL') ? 1 : 0;
}

const TAG: Record<CheckStatus, string> = { PASS: '[PASS]', WARN: '[WARN]', FAIL: '[FAIL]' };

/** Bảng chữ thuần (không màu) để dán vào log hay chat. Mỗi dòng WARN/FAIL kèm một dòng cách sửa. */
export function formatReport(results: readonly CheckResult[]): string {
  const idWidth = Math.max(8, ...results.map((r) => r.id.length));
  const lines: string[] = [];
  let group = '';
  for (const r of results) {
    if (r.group !== group) {
      group = r.group;
      lines.push('', `== ${group} ==`);
    }
    lines.push(`${TAG[r.status]} ${r.id.padEnd(idWidth)}  ${r.title}: ${r.detail}`);
    if (r.status !== 'PASS' && r.hint) lines.push(`${' '.repeat(7)}${' '.repeat(idWidth)}  cách sửa: ${r.hint}`);
  }
  const s = summarize(results);
  lines.push('', `Tổng: ${s.pass} PASS, ${s.warn} WARN, ${s.fail} FAIL`);
  lines.push(
    s.fail > 0
      ? 'Kết luận: CHƯA ĐẠT, còn FAIL. Không mở bán cho tới khi sửa hết.'
      : s.warn > 0
        ? 'Kết luận: ĐẠT, nhưng còn WARN: đọc từng dòng và chốt "chấp nhận" hoặc sửa.'
        : 'Kết luận: ĐẠT.',
  );
  return lines.join('\n').replace(/^\n/, '');
}
