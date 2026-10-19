import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import * as ts from 'typescript';

/**
 * `prisma/cleanup-demo-data.ts` đọc DATABASE_URL ở thân module rồi mới `await import('@prisma/client')`. Import tĩnh chạy
 * TRƯỚC thân module, và Prisma Client nạp file .env (vd apps/api/.env trỏ DB dev) vào process.env ngay lúc import. Nếu
 * chuỗi import tĩnh của CLI có một import runtime `@prisma/client`, "chưa đặt DATABASE_URL" thành "lặng lẽ dùng DB trong
 * .env". Test này đi hết chuỗi import tĩnh (bỏ `import type`) và khoá điều đó.
 */
const API_DIR = join(__dirname, '../../..');
const CLI = join(API_DIR, 'prisma/cleanup-demo-data.ts');

interface RuntimeImport {
  from: string;
  spec: string;
}

function runtimeImports(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  for (const st of src.statements) {
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      const onlyTypes =
        clause && !clause.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
      if (onlyTypes) continue;
      out.push((st.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && !st.isTypeOnly) {
      out.push((st.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isImportEqualsDeclaration(st) && !st.isTypeOnly && ts.isExternalModuleReference(st.moduleReference)) {
      out.push((st.moduleReference.expression as ts.StringLiteral).text);
    }
  }
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const f of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(f)) return f;
  throw new Error(`Không tìm thấy ${spec} (từ ${relative(API_DIR, from)})`);
}

function walk(entry: string): { files: string[]; external: RuntimeImport[] } {
  const seen = new Set<string>();
  const external: RuntimeImport[] = [];
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeImports(file)) {
      const local = resolveLocal(file, spec);
      if (local) stack.push(local);
      else external.push({ from: relative(API_DIR, file), spec });
    }
  }
  return { files: [...seen].map((f) => relative(API_DIR, f)).sort(), external };
}

describe('prisma/cleanup-demo-data.ts: chuỗi import tĩnh không nạp @prisma/client trước khi đọc DATABASE_URL', () => {
  it('không file nào trong chuỗi import runtime @prisma/client (chỉ import type)', () => {
    const { files, external } = walk(CLI);
    expect(files).toContain('src/config/demo-data/cleanup.ts');
    expect(external.filter((e) => e.spec === '@prisma/client' || e.spec.startsWith('@prisma/client/'))).toEqual([]);
    // Gói ngoài khác cũng có thể kéo Prisma vào; chuỗi hiện chỉ dùng node:*. Thêm gói mới thì xét lại test này.
    expect(external.filter((e) => !e.spec.startsWith('node:'))).toEqual([]);
  });

  it('CLI đọc DATABASE_URL trước lần import động duy nhất của @prisma/client', () => {
    const text = readFileSync(CLI, 'utf8');
    const read = text.indexOf('const DATABASE_URL = process.env.DATABASE_URL');
    const load = text.indexOf("await import('@prisma/client')");
    expect(read).toBeGreaterThan(0);
    expect(load).toBeGreaterThan(read);
    expect(text.split("import('@prisma/client')").length).toBe(2);
  });

  it('bộ phân tích nhận ra import runtime (tránh test luôn xanh)', () => {
    const { external } = walk(join(API_DIR, 'src/prisma/prisma.service.ts'));
    expect(external.map((e) => e.spec)).toContain('@prisma/client');
  });
});
