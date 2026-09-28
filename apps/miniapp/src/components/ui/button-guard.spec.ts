import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * zmp-ui Button gọi onClick kể cả khi `loading` đang bật — chỉ `disabled` mới chặn thật
 * (xem node_modules/zmp-ui/cjs/components/button/index.js: onClickHandler không xét loading,
 * còn thuộc tính disabled của <button> thì có). Nút chỉ có `loading` vì vậy vẫn nhận cú chạm
 * thứ hai trong lúc request đầu đang bay: đặt đơn đôi, huỷ hai lần, gửi đánh giá trùng.
 *
 * Không chỉ cần có `disabled=...` — nó phải THỰC SỰ tham chiếu cùng biến pending/loading dùng
 * trong `loading=...` của CÙNG nút đó. Có `disabled={someKhácKhông-liên-quan}` bên cạnh
 * `loading={mut.isPending}` vẫn lọt qua kiểu kiểm tra "có tồn tại disabled=" nhưng vẫn double-tap
 * được — đây chính là dạng bug đã lọt qua bản kiểm tra cũ (chỉ .includes('disabled=')).
 *
 * Quét mã nguồn thay vì render từng nút: rẻ, và bắt được cả những nút thêm mới sau này.
 *
 * NGOẠI LỆ (thêm sau khi Task 20 phát hiện guard này chặn cả `Button` DS v2 — component đó đã tự
 * chặn double-tap NGAY BÊN TRONG, xem `components/ui/button.tsx`'s `handlePress`): file nào JSX
 * `<Button>` trỏ về import `.../ui/button` thì bỏ qua yêu cầu `disabled=` — guard đã nằm sẵn
 * trong component, bắt caller lặp lại `disabled={cùngBiếnPending}` chỉ vô tình tắt spinner
 * (`loading && !disabled` của zmp-ui). zmp-ui's raw `Button` và `Btn` cũ (primitives.tsx) KHÔNG
 * có guard nội bộ này nên vẫn phải qua kiểm tra như trước.
 */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

/** Cắt đúng thẻ mở <Button ...>, bỏ qua dấu ">" nằm trong biểu thức {…}. */
function openTags(src: string): { index: number; tag: string }[] {
  const out: { index: number; tag: string }[] = [];
  let i = src.indexOf('<Button');
  while (i >= 0) {
    let depth = 0;
    let j = i;
    while (j < src.length) {
      const c = src[j];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
      j += 1;
    }
    out.push({ index: i, tag: src.slice(i, j + 1) });
    i = src.indexOf('<Button', j + 1);
  }
  return out;
}

/**
 * Lấy nội dung biểu thức `name={...}` trong một thẻ mở, khớp đúng dấu `}` đóng (đếm độ sâu
 * để không bị cắt cụt bởi object literal lồng bên trong, vd `style={{ ... }}`).
 * Trả về null nếu thẻ không có thuộc tính này dưới dạng biểu thức `{...}`.
 */
function attrExpr(tag: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}=\\{`);
  const m = re.exec(tag);
  if (!m) return null;
  let depth = 1;
  let j = m.index + m[0].length;
  while (j < tag.length && depth > 0) {
    if (tag[j] === '{') depth += 1;
    else if (tag[j] === '}') depth -= 1;
    if (depth === 0) break;
    j += 1;
  }
  return tag.slice(m.index + m[0].length, j);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Trích các "mốc" pending/loading từ biểu thức loading={...}: ưu tiên dạng `bien.isPending` /
 * `bien.isLoading` (mutation/query của react-query) — đây là tín hiệu rõ ràng nhất. Nếu biểu
 * thức không có dạng đó (vd chỉ là 1 biến boolean thô như `loading` hay `spinning`), coi mọi
 * định danh xuất hiện trong biểu thức là mốc cần tìm lại trong disabled.
 */
function pendingMarkers(expr: string): string[] {
  const dotted = [...expr.matchAll(/[A-Za-z_$][\w$]*\.(?:isPending|isLoading)\b/g)].map((m) => m[0]);
  if (dotted.length > 0) return [...new Set(dotted)];
  const idents = [...new Set(expr.match(/[A-Za-z_$][\w$]*/g) ?? [])];
  return idents.filter((n) => !['true', 'false', 'null', 'undefined'].includes(n));
}

/**
 * Tìm khai báo `const/let/var NAME = <biểu thức>;` trong cùng file (naive, dừng ở dấu ";" đầu
 * tiên) — để hỗ trợ mẫu hợp lệ kiểu `const isAnyMutating = a.isPending || b.isPending;` rồi
 * `disabled={isAnyMutating}`: alias vẫn thực sự phản ánh đúng các mutation, chỉ đặt tên khác.
 */
function resolveAliasExpr(src: string, name: string): string | null {
  const re = new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=\\s*([^;]+);`);
  const m = re.exec(src);
  return m ? (m[1] ?? null) : null;
}

/** Mở rộng 1 biểu thức bằng nội dung các alias cục bộ mà nó tham chiếu, đệ quy vài cấp. */
function expandWithAliases(expr: string, src: string, depth = 0): string {
  if (depth > 3) return expr;
  const idents = [...new Set(expr.match(/[A-Za-z_$][\w$]*/g) ?? [])];
  let expanded = expr;
  for (const id of idents) {
    const aliasExpr = resolveAliasExpr(src, id);
    if (aliasExpr) expanded += ` ${expandWithAliases(aliasExpr, src, depth + 1)}`;
  }
  return expanded;
}

/** true nếu ít nhất 1 mốc pending/loading xuất hiện (như 1 "từ" trọn vẹn) trong biểu thức đã mở alias. */
function coversAnyMarker(markers: string[], expandedDisabledExpr: string): boolean {
  if (markers.length === 0) return true; // không trích được định danh nào — không có gì để đối chiếu
  return markers.some((m) => new RegExp(`\\b${escapeRegExp(m)}\\b`).test(expandedDisabledExpr));
}

/**
 * Dò `import { ..., Button, ... } from '...'` (hoặc `X as Button`) để biết JSX `<Button>` của
 * file này thực ra trỏ về import nào — trả về đường dẫn nguồn (chuỗi giữa dấu nháy), hoặc null
 * nếu không tìm thấy import nào bind ra local name `Button` (coi như "không xác định": vẫn áp
 * guard như cũ để an toàn, không âm thầm bỏ qua nút nào).
 */
function resolveButtonImportSource(src: string): string | null {
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const specifierList = m[1] ?? '';
    const source = m[2] ?? '';
    const specifiers = specifierList.split(',').map((s) => s.trim()).filter(Boolean);
    for (const spec of specifiers) {
      const asMatch = /^(.+?)\s+as\s+(.+)$/.exec(spec);
      const localName = asMatch ? (asMatch[2] ?? '').trim() : spec;
      if (localName === 'Button') return source;
    }
  }
  return null;
}

/**
 * Thư mục chứa file (chuẩn hoá "/" cho cả Windows lẫn đường dẫn giả lập trong test), dạng mảng
 * segment — để tự giải quyết import tương đối mà không phụ thuộc hành vi path module theo OS.
 */
function dirSegments(filePath: string): string[] {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  parts.pop(); // bỏ tên file, chỉ giữ thư mục chứa nó
  return parts;
}

/** Giải quyết 1 specifier import tương đối ("./x", "../../a/b") từ thư mục chứa file, trả về
 * đường dẫn đã chuẩn hoá dạng "a/b/c" (không phụ thuộc path module của OS). */
function resolveRelativeImport(fileDirParts: string[], importSource: string): string {
  const resolved = [...fileDirParts];
  for (const part of importSource.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

/** Button (Task 10, components/ui/button.tsx) đã tự chặn double-tap khi loading NGAY BÊN TRONG
 * (xem "handlePress" trong button.tsx) — độc lập với `disabled`. zmp-ui's raw Button và Btn cũ
 * (primitives.tsx) không có guard nội bộ này. Chỉ xét import TƯƠNG ĐỐI (bắt đầu bằng ".") — gói
 * ngoài như 'zmp-ui' không bao giờ là Button DS v2. Giải bằng đường dẫn thật (không chỉ so khớp
 * chuỗi "ui/button") để không bỏ sót file NẰM SẴN trong ui/ tự import "./button" — vd
 * button.spec.tsx cùng thư mục với button.tsx, không có chữ "ui/" nào trong specifier của nó. */
function isDsButtonImport(fileDirParts: string[], importSource: string): boolean {
  if (!importSource.startsWith('.')) return false;
  return resolveRelativeImport(fileDirParts, importSource).endsWith('ui/button');
}

/** Cốt lõi có thể test độc lập với nội dung file giả lập: trả về danh sách offender message. */
function findOffenders(relFile: string, src: string): string[] {
  const offenders: string[] = [];
  const buttonSource = resolveButtonImportSource(src);
  const skipDsButton = buttonSource !== null && isDsButtonImport(dirSegments(relFile), buttonSource);
  for (const { index, tag } of openTags(src)) {
    const loadingExpr = attrExpr(tag, 'loading');
    if (loadingExpr === null) continue; // nút này không có loading={...} dạng biểu thức
    if (skipDsButton) continue; // Button (Task 10) tự chặn double-tap bên trong — không cần disabled= nữa
    const line = src.slice(0, index).split('\n').length;

    const disabledExpr = attrExpr(tag, 'disabled');
    if (disabledExpr === null) {
      offenders.push(`${relFile}:${line} — thiếu disabled= (loading={${loadingExpr}})`);
      continue;
    }

    const markers = pendingMarkers(loadingExpr);
    const expandedDisabled = expandWithAliases(disabledExpr, src);
    if (!coversAnyMarker(markers, expandedDisabled)) {
      offenders.push(
        `${relFile}:${line} — disabled={${disabledExpr}} không tham chiếu ${markers.join(' hoặc ')} (loading={${loadingExpr}})`,
      );
    }
  }
  return offenders;
}

describe('mọi <Button loading> đều phải kèm disabled đúng biến pending/loading đó (trừ Button DS v2 đã tự chặn double-tap)', () => {
  it('disabled={...} phải tham chiếu cùng biến isPending/isLoading dùng trong loading={...} — áp dụng cho zmp-ui Button / Btn cũ; Button (Task 10, ui/button.tsx) được miễn vì đã tự chặn bên trong', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(join(process.cwd(), 'src'))) {
      const src = readFileSync(file, 'utf8');
      const relFile = file.replace(process.cwd(), '');
      offenders.push(...findOffenders(relFile, src));
    }
    expect(offenders).toEqual([]);
  });

  it('vẫn chặn: file import Button từ zmp-ui, có loading nhưng thiếu disabled cùng biến → vẫn fail như trước', () => {
    const src = [
      "import { Button } from 'zmp-ui';",
      'function X() {',
      '  return <Button loading={save.isPending} onClick={submit}>Lưu</Button>;',
      '}',
    ].join('\n');
    expect(findOffenders('/fake/zmp-raw.tsx', src)).toEqual([
      '/fake/zmp-raw.tsx:3 — thiếu disabled= (loading={save.isPending})',
    ]);
  });

  it('không còn chặn: file import Button từ ./ui/button (Button DS v2), có loading nhưng không disabled → pass vì component tự chặn double-tap bên trong', () => {
    const src = [
      "import { Button } from './ui/button';",
      'function X() {',
      '  return <Button loading={save.isPending} onPress={submit}>Lưu</Button>;',
      '}',
    ].join('\n');
    expect(findOffenders('/fake/ds-button.tsx', src)).toEqual([]);
  });

  it('không còn chặn dù import bằng đường dẫn tương đối sâu hơn (../../components/ui/button)', () => {
    const src = [
      "import { Button } from '../../components/ui/button';",
      'function X() {',
      '  return <Button loading={save.isPending} onPress={submit}>Lưu</Button>;',
      '}',
    ].join('\n');
    expect(findOffenders('/fake/deep.tsx', src)).toEqual([]);
  });
});
