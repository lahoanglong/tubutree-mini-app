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

describe('mọi <Button loading> đều phải kèm disabled đúng biến pending/loading đó', () => {
  it('disabled={...} phải tham chiếu cùng biến isPending/isLoading dùng trong loading={...}', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(join(process.cwd(), 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const { index, tag } of openTags(src)) {
        const loadingExpr = attrExpr(tag, 'loading');
        if (loadingExpr === null) continue; // nút này không có loading={...} dạng biểu thức
        const line = src.slice(0, index).split('\n').length;
        const relFile = file.replace(process.cwd(), '');

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
    }
    expect(offenders).toEqual([]);
  });
});
