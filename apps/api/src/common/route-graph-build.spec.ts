import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import * as ts from 'typescript';

/**
 * route-graph.ts chỉ phục vụ spec (endpoint-inventory, beta-removed): nó đọc metadata Nest của AppModule để lập sổ route.
 * Mã đó không được đi vào bản build chạy thật. tsconfig.build.json loại các file .spec.ts nhưng route-graph.ts không phải
 * spec nên trước đây vẫn nằm trong dist.
 */
const API_ROOT = join(__dirname, '../..');
const SRC_ROOT = join(API_ROOT, 'src');
const BUILD_CONFIG = join(API_ROOT, 'tsconfig.build.json');

const rel = (file: string): string => relative(API_ROOT, file).split(sep).join('/');

function buildFiles(): string[] {
  const read = ts.readConfigFile(BUILD_CONFIG, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(BUILD_CONFIG));
  return parsed.fileNames.map(rel);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('route-graph.ts không đi vào bản build (nest build dùng tsconfig.build.json)', () => {
  it('danh sách file của tsconfig.build.json có mã chạy thật (dò đúng, không rỗng) và không có spec', () => {
    const files = buildFiles();
    expect(files).toContain('src/main.ts');
    expect(files).toContain('src/app.module.ts');
    expect(files.filter((f) => f.endsWith('.spec.ts'))).toEqual([]);
  });

  it('route-graph.ts bị loại khỏi bản build', () => {
    expect(buildFiles().filter((f) => /(^|\/)route-graph[^/]*\.ts$/.test(f))).toEqual([]);
  });

  it('không file nguồn chạy thật nào import route-graph (import thì tsc vẫn kéo nó vào dist dù đã exclude)', () => {
    const importers = walk(SRC_ROOT)
      .filter((f) => !f.endsWith('.spec.ts') && !/(^|\/)route-graph[^/]*\.ts$/.test(rel(f)))
      .filter((f) => /from\s+['"][^'"]*route-graph[^'"]*['"]|require\(\s*['"][^'"]*route-graph/.test(readFileSync(f, 'utf-8')))
      .map(rel);
    expect(importers).toEqual([]);
  });

  it('hai spec dùng nó vẫn import được từ src/common (loại khỏi build không làm hỏng spec)', () => {
    for (const spec of ['endpoint-inventory.spec.ts', 'beta-removed.spec.ts']) {
      expect(readFileSync(join(SRC_ROOT, 'common', spec), 'utf-8')).toMatch(/from '\.\/route-graph'/);
    }
  });
});
