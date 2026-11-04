// U2: so chữ Mini 375 với web 375 (và kiểm web 1280 không tràn ngang) từ kết quả U1.
// Chạy:  node /Users/longla/coding/tubutree-mini-app/.claude/worktrees/gl-1103-docs/docs/2026-11-04-uat/scripts/L1-mua-hang/U2-compare.mjs [persona] [khoá]
import fs from 'node:fs';
import path from 'node:path';
import { RESULTS, toneViolations } from './lib.mjs';

const only = process.argv[2];
const onlyKey = process.argv[3];
const base = path.join(RESULTS, 'ui');
const money = (t) => (t.match(/\d{1,3}(?:\.\d{3})*\s?đ/g) ?? []).map((x) => x.replace(/\s/g, ''));
const lines = (t) =>
  t
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
const out = [];
for (const persona of fs.readdirSync(base)) {
  if (only && only !== 'all' && persona !== only) continue;
  for (const key of fs.readdirSync(path.join(base, persona))) {
    if (onlyKey && key !== onlyKey) continue;
    const rd = (s) => {
      const f = path.join(base, persona, key, `${s}.json`);
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    };
    const m = rd('mini375');
    const w = rd('web375');
    const d = rd('web1280');
    const head = `### ${persona} / ${key}`;
    const notes = [];
    if (!m || !w) {
      notes.push('thiếu dữ liệu');
    } else if (m.error || w.error) {
      notes.push(`lỗi mở: mini=${m.error ?? 'ok'} web=${w.error ?? 'ok'}`);
    } else {
      const lm = lines(m.text);
      const lw = lines(w.text);
      const onlyM = lm.filter((l) => !lw.includes(l));
      const onlyW = lw.filter((l) => !lm.includes(l));
      const mm = money(m.text);
      const mw = money(w.text);
      if (JSON.stringify(mm) !== JSON.stringify(mw)) notes.push(`TIỀN lệch: mini=${JSON.stringify(mm)} web=${JSON.stringify(mw)}`);
      if (onlyM.length) notes.push(`chỉ Mini: ${JSON.stringify(onlyM.slice(0, 14))}`);
      if (onlyW.length) notes.push(`chỉ web375: ${JSON.stringify(onlyW.slice(0, 14))}`);
      // thứ tự các dòng chung
      const common = lm.filter((l) => lw.includes(l));
      const commonW = lw.filter((l) => lm.includes(l));
      if (JSON.stringify(common) !== JSON.stringify(commonW)) notes.push(`THỨ TỰ khác (dòng chung): mini=${JSON.stringify(common.slice(0, 12))} web=${JSON.stringify(commonW.slice(0, 12))}`);
    }
    for (const x of [m, w, d]) {
      if (!x || x.error) continue;
      if (x.scrollW > x.clientW + 1) notes.push(`${x.surf}: tràn ngang ${x.scrollW}>${x.clientW}`);
      if (x.badRequests?.length) notes.push(`${x.surf}: request lỗi ${JSON.stringify(x.badRequests.slice(0, 4))}`);
      if (x.errors?.length) notes.push(`${x.surf}: lỗi trang ${JSON.stringify(x.errors.slice(0, 2))}`);
      const tone = toneViolations(x.text);
      if (tone.length) notes.push(`${x.surf}: chữ cấm ${tone.join(', ')}`);
    }
    if (d && !d.error && w && !w.error) {
      const dm = money(d.text);
      const mw = money(w.text);
      if (JSON.stringify(dm) !== JSON.stringify(mw)) notes.push(`web1280 TIỀN khác web375: 1280=${JSON.stringify(dm)} 375=${JSON.stringify(mw)}`);
    }
    out.push(`${head}\n${notes.length ? notes.map((n) => `- ${n}`).join('\n') : '- khớp'}`);
  }
}
const text = out.join('\n\n');
fs.writeFileSync(path.join(RESULTS, `ui-diff${only ? `-${only}` : ''}.md`), text);
console.log(text);
