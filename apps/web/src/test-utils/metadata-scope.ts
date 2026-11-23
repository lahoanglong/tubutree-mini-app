import ts from 'typescript';

interface Unit {
  name: string;
  /** Câu khai báo ở cấp file: khoảng bị bỏ khi hàm được miễn quét. */
  stmt: ts.Statement;
  nameNode: ts.Identifier;
  fn: ts.SignatureDeclaration;
  exported: boolean;
}

/** Tên cục bộ của kiểu `Metadata` nhập từ 'next' (kể cả `Metadata as M`). Kiểu cùng tên tự khai trong file không tính. */
function metadataTypeNames(sf: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || stmt.moduleSpecifier.text !== 'next') continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) if ((el.propertyName ?? el.name).text === 'Metadata') names.add(el.name.text);
  }
  return names;
}

/** `Metadata` hoặc `Promise<Metadata>`, với `Metadata` là kiểu của Next. */
function isMetadataType(t: ts.TypeNode | undefined, names: ReadonlySet<string>, allowPromise = true): boolean {
  if (!t || !ts.isTypeReferenceNode(t) || !ts.isIdentifier(t.typeName)) return false;
  if (names.has(t.typeName.text)) return !t.typeArguments;
  return allowPromise && t.typeName.text === 'Promise' && t.typeArguments?.length === 1 && isMetadataType(t.typeArguments[0], names, false);
}

function unitsOf(sf: ts.SourceFile): Unit[] {
  const out: Unit[] = [];
  for (const stmt of sf.statements) {
    const exported = (ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) ?? false;
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      out.push({ name: stmt.name.text, stmt, nameNode: stmt.name, fn: stmt, exported });
      continue;
    }
    // Chỉ câu khai báo một biến: câu nhiều biến cắt ra sẽ kéo theo biến khác, nên để nguyên cho spec quét.
    if (!ts.isVariableStatement(stmt) || stmt.declarationList.declarations.length !== 1) continue;
    const d = stmt.declarationList.declarations[0]!;
    if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
      out.push({ name: d.name.text, stmt, nameNode: d.name, fn: d.initializer, exported });
    }
  }
  return out;
}

/**
 * Tên ở vị trí khoá hoặc tên khai báo (`a.x`, `{ x: 1 }`, `{ x: string }`, `x={...}` trong JSX, tham số `x`) không phải lần dùng hàm `x` của
 * file. `{ x }` viết tắt và `export { x }` vẫn là lần dùng.
 */
function isKeyPosition(node: ts.Identifier): boolean {
  const p = node.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node };
  if (ts.isShorthandPropertyAssignment(p) || ts.isExportSpecifier(p)) return false;
  if (ts.isQualifiedName(p)) return p.right === node;
  return p.name === node || p.propertyName === node;
}

/**
 * Hàm dựng thẻ meta SEO của một trang Next, tìm theo cây cú pháp (thứ tự khai báo trong file không quan trọng):
 * - `generateMetadata`, và mọi hàm cấp file có kiểu trả khai rõ `Metadata` hoặc `Promise<Metadata>` (`Metadata` nhập từ 'next');
 * - cộng hàm cấp file không export mà MỌI chỗ dùng đều nằm trong các hàm trên (lặp tới khi không thêm được).
 * Hàm phụ không khai kiểu mà phần giao diện cũng gọi, hoặc được export (file khác có thể nhập), vẫn bị quét.
 *
 * Hàm trả `Metadata` được miễn theo kiểu, kể cả khi giao diện gọi nó: kiểu trả là lời hứa hàm chỉ dựng thẻ meta và JSON-LD. Giao diện mà vẽ
 * chữ lấy từ kết quả của nó (vd `title`) thì ký hiệu trong đó lọt qua spec, nên lúc ấy phải tách chữ ra hàm không khai kiểu.
 */
export function metadataScope(src: string, fileName = 'page.tsx'): { builders: string[]; text: string } {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const units = unitsOf(sf);
  const byName = new Map(units.map((u) => [u.name, u]));
  const metadataNames = metadataTypeNames(sf);
  const exempt = new Set(units.filter((u) => u.name === 'generateMetadata' || isMetadataType(u.fn.type, metadataNames)).map((u) => u.name));
  if (!exempt.has('generateMetadata')) throw new Error(`${fileName} không có generateMetadata: bỏ khỏi danh sách miễn quét thẻ meta, quét cả file`);

  const container = (pos: number) => units.find((u) => pos >= u.stmt.getStart(sf) && pos < u.stmt.getEnd())?.name ?? null;
  const refs = new Map<string, (string | null)[]>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && byName.has(node.text) && byName.get(node.text)!.nameNode !== node && !isKeyPosition(node)) {
      refs.set(node.text, [...(refs.get(node.text) ?? []), container(node.getStart(sf))]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  for (let grew = true; grew; ) {
    grew = false;
    for (const u of units) {
      if (exempt.has(u.name) || u.exported) continue;
      const used = refs.get(u.name) ?? [];
      if (used.length > 0 && used.every((c) => c !== null && exempt.has(c))) {
        exempt.add(u.name);
        grew = true;
      }
    }
  }

  const cuts = units
    .filter((u) => exempt.has(u.name))
    .map((u) => [u.stmt.getStart(sf), u.stmt.getEnd()] as const)
    .sort((a, b) => a[0] - b[0]);
  let text = '';
  let at = 0;
  for (const [start, end] of cuts) {
    text += src.slice(at, start);
    at = end;
  }
  text += src.slice(at);
  return { builders: units.filter((u) => exempt.has(u.name)).map((u) => u.name), text };
}

/** Nguồn của trang đã bỏ các hàm dựng thẻ meta SEO (xem `metadataScope`). */
export function withoutMetadataBuilders(src: string, fileName?: string): string {
  return metadataScope(src, fileName).text;
}
