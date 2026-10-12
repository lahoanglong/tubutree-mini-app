import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Checkbox/Radio/Switch không tên là chấm thuần hình bọc `inert` (form.tsx): trình duyệt thật không chuyển
 * cú chạm vào nó, chỉ hàng cha nhận. jsdom bỏ qua `inert` nên test hành vi không thấy lỗi; guard này đọc mã nguồn.
 * Chấm không tên chỉ được đi với `onChange={() => {}}`; cần xử lý bấm thì đặt nhãn (label / children /
 * aria-label / aria-labelledby / id, hoặc bọc trong Field) hoặc để hàng cha giữ onClick.
 */
const TAGS = 'Checkbox|Radio|Switch';
const NAME_PROPS = /(^|\s)(label|aria-label|aria-labelledby|id)\s*=/;
const NOOP_ONCHANGE = /(^|\s)onChange=\{\s*\(\)\s*=>\s*\{\s*\}\s*\}/;

interface Usage { tag: string; line: number; verdict: 'ok' | 'named' | 'in-field' | 'bad' | 'spread' }

const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Cắt thẻ mở JSX bắt đầu ở `from` (đang đứng ngay sau tên thẻ) tới `>` cấp ngoài cùng; bỏ qua `>` trong {} và chuỗi. */
function openingTag(text: string, from: number): { props: string; selfClosing: boolean } | null {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || (c === '`' && depth > 0)) { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) {
      const selfClosing = text[i - 1] === '/';
      return { props: text.slice(from, selfClosing ? i - 1 : i), selfClosing };
    }
  }
  return null;
}

function scanUnnamedControls(source: string): Usage[] {
  const text = stripComments(source);
  const out: Usage[] = [];
  const re = new RegExp(`<(${TAGS})(?![\\w.$-])`, 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const tag = openingTag(text, m.index + m[0].length);
    if (!tag) continue;
    const line = text.slice(0, m.index).split('\n').length;
    // Chuỗi trong props có thể chứa "id=" ("... id=..."): chỉ xét phần ngoài chuỗi và ngoài {}.
    const top = tag.props.replace(/"[^"]*"|'[^']*'/g, '""').replace(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g, '{}');
    const named = !tag.selfClosing || NAME_PROPS.test(' ' + top.replace(/=\{\}/g, '=X'));
    if (named) { out.push({ tag: m[1], line, verdict: 'named' }); continue; }
    if (/\{\.\.\./.test(tag.props)) { out.push({ tag: m[1], line, verdict: 'spread' }); continue; }
    if (NOOP_ONCHANGE.test(' ' + tag.props)) { out.push({ tag: m[1], line, verdict: 'ok' }); continue; }
    const before = text.slice(Math.max(0, m.index - 400), m.index);
    out.push({ tag: m[1], line, verdict: /<Field\b[^>]*>\s*$/.test(before) ? 'in-field' : 'bad' });
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC = join(process.cwd(), 'src');
const sources = walk(SRC)
  .filter((f) => /\.tsx$/.test(f) && !/\.spec\./.test(f) && !f.endsWith(`${sep}components${sep}ui${sep}form.tsx`))
  .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));

describe('chấm Checkbox/Radio/Switch không tên (thuần hình, inert)', () => {
  it('mọi chỗ gọi không tên chỉ dùng onChange no-op (hàng cha giữ onClick)', () => {
    const bad = sources.flatMap((s) =>
      scanUnnamedControls(s.text).filter((u) => u.verdict === 'bad' || u.verdict === 'spread').map((u) => `${s.file}:${u.line} <${u.tag}> (${u.verdict})`),
    );
    expect(bad).toEqual([]);
  });

  it('không vô nghĩa: quét thấy các chấm không tên đã biết ở checkout và subscription-options', () => {
    const decorative = (file: string) => scanUnnamedControls(sources.find((s) => s.file === file)!.text).filter((u) => u.verdict === 'ok');
    expect(decorative('pages/checkout.tsx').length).toBeGreaterThanOrEqual(4);
    expect(decorative('components/subscription-options.tsx').length).toBeGreaterThanOrEqual(1);
  });
});

describe('bộ quét scanUnnamedControls', () => {
  const verdicts = (src: string) => scanUnnamedControls(src).map((u) => u.verdict);

  it('chấm không tên với onChange thật là vi phạm', () => {
    expect(verdicts('<Checkbox checked={a} onChange={() => setA(!a)} />')).toEqual(['bad']);
    expect(verdicts('<Radio checked={a} onChange={toggle} />')).toEqual(['bad']);
    expect(verdicts('<Switch checked={a} onChange={(e) => set(e.target.checked)} />')).toEqual(['bad']);
  });

  it('chấm không tên với onChange no-op là hợp lệ (kể cả nhiều dòng, disabled)', () => {
    expect(verdicts('<Checkbox checked={a} onChange={() => {}} />')).toEqual(['ok']);
    expect(verdicts('<Radio\n  checked={p === m.value}\n  disabled={m.disabled}\n  onChange={() => {}}\n/>')).toEqual(['ok']);
  });

  it('có nhãn (label, aria-label, aria-labelledby, id) hoặc có children thì không phải chấm trang trí', () => {
    expect(verdicts('<Checkbox checked onChange={t} label="Chọn" />')).toEqual(['named']);
    expect(verdicts('<Radio checked onChange={t} aria-label="Chuyển khoản" />')).toEqual(['named']);
    expect(verdicts('<Switch checked onChange={t} aria-labelledby="x" />')).toEqual(['named']);
    expect(verdicts('<Checkbox checked onChange={t} id="agree" />')).toEqual(['named']);
    expect(verdicts('<Checkbox checked onChange={() => onChange({ checked: !checked })}>Dòng này</Checkbox>')).toEqual(['named']);
  });

  it('chữ "id=" hay "label=" nằm trong chuỗi hoặc trong {} không làm chấm thành có tên', () => {
    expect(verdicts('<Checkbox checked={a} data-note="id=3" onChange={() => go(\'label=x\')} />')).toEqual(['bad']);
  });

  it('bọc trong Field thì có tên, onChange thật được phép', () => {
    expect(verdicts('<Field label="Đồng ý">\n  <Checkbox checked={a} onChange={toggle} />\n</Field>')).toEqual(['in-field']);
  });

  it('props lan truyền không phân xử được: báo spread thay vì bỏ qua', () => {
    expect(verdicts('<Checkbox {...rest} />')).toEqual(['spread']);
  });

  it('không nhầm Radio.Group, RadioRow, SwitchRow, ZCheckbox, chú thích', () => {
    expect(verdicts('<Radio.Group value={v}><RadioRow /><SwitchRow label="x" /><ZCheckbox /></Radio.Group>')).toEqual([]);
    expect(verdicts('// <Checkbox checked onChange={t} />\n/* <Radio checked onChange={t} /> */')).toEqual([]);
  });
});
