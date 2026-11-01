#!/usr/bin/env node
// Rào chắn thành phần giao diện hai nền tảng: mọi thành phần trong docs/design/ds-map.json phải có file và export ở cả Mini App lẫn web,
// cùng bộ khoá props (trừ lệch có lý do ở `propsDiff`). Mục `upcoming` là thành phần gói khác đang làm: không kiểm file, chỉ kiểm khai báo.
// Nối sau check-platform-parity trong `pnpm lint:parity`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const DEFAULT_MAP_FILE = 'docs/design/ds-map.json';
const ROUTE_MAP_FILE = 'packages/app-core/src/route-map.json';

const parse = (source) => ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hasExport = (node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

// Quét cây cú pháp thay vì regex để chữ "export function A" nằm trong comment hay chuỗi không được tính.
export function exportsSymbol(source, name) {
  for (const st of parse(source).statements) {
    if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      if (st.exportClause.elements.some((e) => e.name.text === name)) return true;
    } else if (ts.isVariableStatement(st)) {
      if (hasExport(st) && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)) return true;
    } else if (
      (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) &&
      hasExport(st) &&
      st.name?.text === name
    ) {
      return true;
    }
  }
  return false;
}

const memberKey = (m, sf) => (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : m.name?.getText(sf));
const literalKeys = (type, sf) => {
  if (ts.isTypeLiteralNode(type)) return type.members.filter((m) => ts.isPropertySignature(m) || ts.isMethodSignature(m)).map((m) => memberKey(m, sf));
  if (ts.isIntersectionTypeNode(type)) {
    const parts = type.types.map((t) => literalKeys(t, sf));
    return parts.every((p) => p !== null) ? parts.flat() : null;
  }
  return null;
};

// Khoá cấp 1 của `interface X` hoặc `type X = {...}`. Khoá thừa kế qua `extends` không tính: thành phần cần so thì khai thẳng trong interface.
export function propKeys(source, typeName) {
  const sf = parse(source);
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st) && st.name.text === typeName) {
      return st.members.filter((m) => ts.isPropertySignature(m) || ts.isMethodSignature(m)).map((m) => memberKey(m, sf));
    }
    if (ts.isTypeAliasDeclaration(st) && st.name.text === typeName) return literalKeys(st.type, sf);
  }
  return null;
}

const blank = (s) => typeof s !== 'string' || s.trim() === '';

function checkProps({ c, miniSrc, webSrc, errors }) {
  const mk = propKeys(miniSrc, c.props);
  const wk = propKeys(webSrc, c.props);
  if (!mk) errors.push(`thành phần ${c.name}: ${c.props} không khai trong ${c.miniapp} (Mini)`);
  if (!wk) errors.push(`thành phần ${c.name}: ${c.props} không khai trong ${c.web} (web)`);
  if (!mk || !wk) return;
  const onlyMini = mk.filter((k) => !wk.includes(k));
  const onlyWeb = wk.filter((k) => !mk.includes(k));
  const diff = c.propsDiff;
  if (diff && blank(diff.reason)) errors.push(`thành phần ${c.name}: propsDiff thiếu reason`);
  const okMini = diff?.miniOnly ?? [];
  const okWeb = diff?.webOnly ?? [];
  for (const k of onlyMini) if (!okMini.includes(k)) errors.push(`thành phần ${c.name}: khoá props ${k} chỉ có ở Mini (${c.props}), thêm vào web hoặc khai propsDiff.miniOnly kèm reason`);
  for (const k of onlyWeb) if (!okWeb.includes(k)) errors.push(`thành phần ${c.name}: khoá props ${k} chỉ có ở web (${c.props}), thêm vào Mini hoặc khai propsDiff.webOnly kèm reason`);
  for (const k of okMini) if (!onlyMini.includes(k)) errors.push(`thành phần ${c.name}: propsDiff.miniOnly ghi ${k} nhưng khoá này không còn chỉ có ở Mini, xoá khỏi propsDiff`);
  for (const k of okWeb) if (!onlyWeb.includes(k)) errors.push(`thành phần ${c.name}: propsDiff.webOnly ghi ${k} nhưng khoá này không còn chỉ có ở web, xoá khỏi propsDiff`);
}

export function checkDsParity({ map, miniappRoutes, readFile }) {
  const errors = [];
  const warnings = [];
  const components = map.components ?? [];
  const webOnly = map.webOnly ?? [];
  const upcoming = map.upcoming ?? [];

  const seen = new Set();
  const names = new Set();
  for (const c of components) {
    const label = c.name ?? '(không tên)';
    if (seen.has(c.name)) {
      errors.push(`thành phần ${label} trùng: có nhiều hơn một dòng trong components`);
      continue;
    }
    seen.add(c.name);
    names.add(c.name);
    if (blank(c.miniapp) || blank(c.web)) {
      errors.push(`thành phần ${label}: thiếu miniapp hoặc web`);
      continue;
    }
    const miniSrc = readFile(c.miniapp);
    const webSrc = readFile(c.web);
    if (miniSrc === null) errors.push(`thành phần ${label}: file Mini ${c.miniapp} không có`);
    else if (!exportsSymbol(miniSrc, c.name)) errors.push(`thành phần ${label}: file Mini ${c.miniapp} không export ${c.name}`);
    if (webSrc === null) errors.push(`thành phần ${label}: file web ${c.web} không có`);
    else if (!exportsSymbol(webSrc, c.name)) errors.push(`thành phần ${label}: file web ${c.web} không export ${c.name}`);
    if (c.props && miniSrc !== null && webSrc !== null) checkProps({ c, miniSrc, webSrc, errors });
    for (const route of c.screens ?? []) {
      if (!miniappRoutes.includes(route)) errors.push(`thành phần ${label}: màn ${route} không có trong route-map.json`);
    }
  }

  for (const w of webOnly) {
    const label = w.name ?? '(không tên)';
    names.add(w.name);
    if (blank(w.reason)) errors.push(`webOnly ${label}: thiếu reason`);
    const src = blank(w.web) ? null : readFile(w.web);
    if (src === null) errors.push(`webOnly ${label}: file web ${w.web} không có`);
    else if (!exportsSymbol(src, w.name)) errors.push(`webOnly ${label}: file web ${w.web} không export ${w.name}`);
  }

  for (const u of upcoming) {
    const label = u.name ?? '(không tên)';
    if (blank(u.package) || blank(u.wave)) errors.push(`sắp có ${label}: thiếu package hoặc wave`);
    if (components.some((c) => c.name === u.name)) errors.push(`sắp có ${label}: đã có trong components, xoá khỏi upcoming`);
    else if (webOnly.some((w) => w.name === u.name)) errors.push(`sắp có ${label}: đã có trong webOnly, xoá khỏi upcoming`);
  }
  return { errors, warnings };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const abs = (p) => join(root, p);
  const mapIdx = process.argv.indexOf('--map');
  const mapFile = mapIdx >= 0 && process.argv[mapIdx + 1] ? process.argv[mapIdx + 1] : DEFAULT_MAP_FILE;
  const map = JSON.parse(readFileSync(abs(mapFile), 'utf8'));
  const routeMap = JSON.parse(readFileSync(abs(ROUTE_MAP_FILE), 'utf8'));
  const { errors, warnings } = checkDsParity({
    map,
    miniappRoutes: routeMap.routes.flatMap((g) => g.items.map((i) => i.miniapp)),
    readFile: (p) => (existsSync(abs(p)) ? readFileSync(abs(p), 'utf8') : null),
  });
  for (const w of warnings) console.warn(`cảnh báo: ${w}`);
  for (const e of errors) console.error(`lỗi: ${e}`);
  if (errors.length > 0) {
    console.error(`check-ds-parity đỏ: ${errors.length} lỗi`);
    process.exit(1);
  }
  console.log(`check-ds-parity xanh (${(map.components ?? []).length} thành phần, ${(map.webOnly ?? []).length} chỉ web, ${(map.upcoming ?? []).length} sắp có)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
