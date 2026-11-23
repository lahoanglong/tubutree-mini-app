import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(__dirname, '../../../..');
const SCRIPT = join(REPO, 'scripts/ci/mini-lazy-chunks.cjs');
const { LAZY_ONLY } = require(SCRIPT) as { LAZY_ONLY: string[] };

const file = (name: string) => `${name}.Ab3_x-9.module.js`;
const INDEX = file('index');

/**
 * Bản build Mini giả, viết theo đúng dạng terser ra: entry import tĩnh vendor, mỗi chunk lười được một trang nạp bằng import() kèm bản đồ preload
 * (`__vite__mapDeps`, chuỗi tên tệp không phải import). `mutate` sửa một chunk để tạo vi phạm.
 */
function run(mutate?: (chunks: Map<string, string>, html: { value: string }) => void, opts: { noDir?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tubu-lazy-'));
  const www = join(dir, 'www');
  const chunks = new Map<string, string>();
  const html = {
    value: `<!doctype html><html><head><script type="module" crossorigin src="./assets/${INDEX}"></script><link rel="modulepreload" crossorigin href="./assets/${file('vendor-react')}"></head></html>`,
  };
  chunks.set(INDEX, `import{a as e,b as t}from"./${file('vendor-react')}";const m=()=>m.f||(m.f=["./${file('page')}"]);const p=()=>import("./${file('page')}");export{p};`);
  chunks.set(file('vendor-react'), 'const r=1;export{r as a,r as b};');
  chunks.set(
    file('page'),
    `import{a as e}from"./${file('vendor-react')}";` +
      LAZY_ONLY.map((n, i) => `const l${i}=()=>import("./${file(n)}");`).join('') +
      `const s="./${file('share-poster-png')}";export{e};`,
  );
  for (const n of LAZY_ONLY) chunks.set(file(n), `import{a as e}from"./${file('vendor-react')}";export const draw=()=>e;`);
  mutate?.(chunks, html);
  if (!opts.noDir) {
    mkdirSync(join(www, 'assets'), { recursive: true });
    writeFileSync(join(www, 'index.html'), html.value);
    for (const [name, src] of chunks) writeFileSync(join(www, 'assets', name), src);
  }
  const summary = join(dir, 'summary.md');
  const res = spawnSync('node', [SCRIPT, www], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', GITHUB_STEP_SUMMARY: summary } });
  let md = '';
  try {
    md = readFileSync(summary, 'utf8');
  } catch {
    /* không ghi summary */
  }
  rmSync(dir, { recursive: true, force: true });
  const out = `${res.stdout}${res.stderr}`;
  return { status: res.status, out, md, errors: out.split('\n').filter((l) => l.startsWith('::error')) };
}

describe('scripts/ci/mini-lazy-chunks.cjs (chunk lười Mini App không bị kéo về chunk tĩnh)', () => {
  it('danh sách có share-poster-png (sự cố tubu-w20-02) và các chunk lười lớn', () => {
    expect(LAZY_ONLY).toEqual(expect.arrayContaining(['share-poster-png', 'home-below', 'mini-round-shell']));
    expect(new Set(LAZY_ONLY).size).toBe(LAZY_ONLY.length);
  });

  it('bản build đúng: thoát 0, in từng chunk lười, chuỗi tên tệp trong bản đồ preload không bị coi là import tĩnh, ghi bảng vào step summary', () => {
    const r = run();
    expect(r.errors).toEqual([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(`Đạt: ${LAZY_ONLY.length} chunk lười`);
    expect(r.out).toMatch(/share-poster-png\s+\d+ byte\s+import\(\) từ 1 chunk, import tĩnh từ 0/);
    expect(r.md).toContain('### Chunk lười Mini App');
  });

  it('Rollup gộp chunk lười vào chunk khác (tệp share-poster-png biến mất): thoát 1, nêu tên', () => {
    const r = run((c) => {
      c.delete(file('share-poster-png'));
      c.set(file('page'), c.get(file('page'))!.replace(`()=>import("./${file('share-poster-png')}")`, '()=>Promise.resolve({})'));
    });
    expect(r.status).toBe(1);
    expect(r.errors.join('\n')).toContain('Không còn chunk riêng "share-poster-png"');
  });

  it.each([
    ['import có tên', (n: string) => `import{draw as d}from"./${n}";`],
    ['import trần', (n: string) => `import"./${n}";`],
    ['import * as', (n: string) => `import*as d from"./${n}";`],
    ['export lại', (n: string) => `export{draw}from"./${n}";`],
    ['import dính liền sau comment giấy phép', (n: string) => `/*! (c) x */import"./${n}";`],
  ])('chunk khác %s chunk lười: thoát 1, nêu chunk import', (_kind, stmt) => {
    const r = run((c) => c.set(file('share-sheet'), `${stmt(file('share-poster-png'))}const x=1;`));
    expect(r.status).toBe(1);
    expect(r.errors.join('\n')).toContain(`Chunk lười "share-poster-png" bị import tĩnh từ ${file('share-sheet')}`);
  });

  it('entry import tĩnh chunk lười: vừa bị import tĩnh vừa nằm trong đường nạp đầu, và import() của chính entry tới nó bị bắt', () => {
    const r = run((c) =>
      c.set(INDEX, `import{a as e}from"./${file('vendor-react')}";import"./${file('home-below')}";const p=()=>import("./${file('home-below')}");export{p};`),
    );
    expect(r.status).toBe(1);
    const all = r.errors.join('\n');
    expect(all).toContain('Chunk lười "home-below" nằm trong đường nạp đầu của entry.');
    expect(all).toContain(`${INDEX} import() động ${file('home-below')} nhưng ${file('home-below')} đã nằm trong đường nạp đầu`);
  });

  it('chunk lười nạp sẵn bằng modulepreload của index.html: tính là đường nạp đầu', () => {
    const r = run((_c, html) => {
      html.value = html.value.replace('</head>', `<link rel="modulepreload" crossorigin href="./assets/${file('support-chat')}"></head>`);
    });
    expect(r.status).toBe(1);
    expect(r.errors.join('\n')).toContain('Chunk lười "support-chat" nằm trong đường nạp đầu của entry.');
  });

  it('chunk lười không còn ai import() động (cách nạp đã đổi): thoát 1', () => {
    const r = run((c) => c.set(file('page'), c.get(file('page'))!.replace(`()=>import("./${file('ai-advisor')}")`, '()=>null')));
    expect(r.status).toBe(1);
    expect(r.errors.join('\n')).toContain('Chunk lười "ai-advisor" không có import() động nào trỏ tới');
  });

  it('không thấy thư mục build: thoát 1 (đổi chỗ đầu ra không được xanh im lặng)', () => {
    const r = run(undefined, { noDir: true });
    expect(r.status).toBe(1);
    expect(r.errors.join('\n')).toContain('chưa kiểm được chunk lười');
  });
});
