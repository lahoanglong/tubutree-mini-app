import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Chunk nối với nhau bằng tên export Rollup đã rút gọn (`j`, `r`, `aG`…), còn terser đặt lại tên biến cục bộ theo tần suất của riêng từng chunk,
 * nên gần như mọi chỗ nối thành `import{j as e,…}` và `export{t as j,…}`: hàng nghìn cặp ` as x` (~24 KB) trong gói mà Zalo cân theo byte thô.
 * Sau khi terser và bản đồ preload của Vite xong, tệp này dựng lại cây cú pháp của từng chunk bằng chính terser, ghim biến nhập/xuất về đúng tên
 * nối (`import{j}`, `export{j}`) rồi để bộ đặt tên của terser đặt lại mọi tên cục bộ khác; bộ đặt tên tự tránh tên đã ghim ở mọi phạm vi có tham
 * chiếu tới biến ghim. Ngoài tên biến cục bộ không đổi gì. `sameBindings` so cấu trúc gắn tên trước/sau; lệch thì giữ nguyên chunk cũ và cảnh báo.
 */

/* Kiểu tối thiểu cho phần cây cú pháp của terser dùng ở đây (terser chỉ công bố `minify`, không công bố kiểu của cây). */
interface TerserDef {
  global: boolean;
  undeclared: boolean;
  references: unknown[];
  mangled_name?: string | null;
  unmangleable(options: object): boolean;
}
interface TerserNode {
  TYPE: string;
  name?: string;
  thedef?: TerserDef;
  variables?: Map<string, TerserDef>;
}
interface TerserNameMapping {
  foreign_name: { name: string };
  name: { definition(): TerserDef | undefined };
}
interface TerserStatement extends TerserNode {
  imported_names?: TerserNameMapping[] | null;
  exported_names?: TerserNameMapping[] | null;
  module_name?: unknown;
}
interface TerserToplevel {
  body: TerserStatement[];
  globals: Map<string, TerserDef>;
  uses_eval?: boolean;
  uses_with?: boolean;
  figure_out_scope(options: object): void;
  compute_char_frequency(options: object): void;
  mangle_names(options: object): void;
  print_to_string(options: object): string;
  walk(visitor: unknown): void;
}
type NodeClass = abstract new (...args: never[]) => TerserNode;
export interface TerserAstApi {
  parse(code: string, options: { module: boolean }): TerserToplevel;
  TreeWalker: new (visit: (node: TerserNode) => boolean | void) => unknown;
  AST_Symbol: NodeClass;
  AST_Label: NodeClass;
  AST_LabelRef: NodeClass;
}

let terserAst: Promise<TerserAstApi> | null = null;

/**
 * Terser chỉ xuất `minify`; cây cú pháp, bộ phân tích phạm vi và bộ in nằm ở `lib/` của đúng bản terser mà Vite dùng để nén (peer của vite).
 * Nạp `minify.js` trước: tệp đó gắn `figure_out_scope`, `mangle_names` và bộ in vào các lớp của cây.
 */
export function loadTerserAst(): Promise<TerserAstApi> {
  terserAst ??= (async () => {
    const fromVite = createRequire(createRequire(import.meta.url).resolve('vite'));
    const lib = path.join(path.dirname(fromVite.resolve('terser/package.json')), 'lib');
    const load = (file: string) => import(pathToFileURL(path.join(lib, file)).href);
    await load('minify.js');
    const [{ parse }, ast] = await Promise.all([load('parse.js'), load('ast.js')]);
    return { parse, TreeWalker: ast.TreeWalker, AST_Symbol: ast.AST_Symbol, AST_Label: ast.AST_Label, AST_LabelRef: ast.AST_LabelRef };
  })();
  return terserAst;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Ghim một biến về tên nối thì bỏ được ` as x` (5 byte), nhưng mỗi tham chiếu dài thêm phần tên nối vượt quá một ký tự (tên terser hay đặt
 * cho biến dùng nhiều). Đo trên bản build: luật này bỏ ~120 byte nhiều hơn ghim mọi biến, và ~2,7 KB nhiều hơn chỉ ghim tên một ký tự.
 */
function worthPinning(def: TerserDef, linkName: string): boolean {
  return def.references.length * (linkName.length - 1) <= 5;
}

const MANGLE_OPTIONS = { module: true, toplevel: true };

/**
 * Ghim biến nhập (`import{j as e}`) rồi biến xuất cục bộ (`export{t as j}`, không tính `export … from`) về tên nối, trừ `default`, `*`, tên
 * không phải định danh, tên trùng biến toàn cục, tên của khai báo terser không được đổi tên (`export const j`…) hay tên đã ghim; biến vừa
 * nhập vừa xuất giữ tên nhập. Sau đó terser đặt lại mọi tên còn lại.
 * Bỏ qua biến không còn tham chiếu nào: terser không ghi nó vào danh sách tên phạm vi đang dùng nên có thể cấp đúng tên đã ghim cho biến khác.
 * Chunk có `eval`/`with` để nguyên: tên trong chuỗi eval không nằm trong cây cú pháp nên không kiểm được.
 */
export function unaliasModuleNames(T: TerserAstApi, code: string): { code: string; pinned: number } {
  const ast = T.parse(code, { module: true });
  ast.figure_out_scope({});
  if (ast.uses_eval || ast.uses_with) return { code, pinned: 0 };
  const taken = new Set(ast.globals.keys());
  ast.walk(
    new T.TreeWalker((node) => {
      for (const [name, def] of node.variables ?? []) if (def.unmangleable(MANGLE_OPTIONS)) taken.add(name);
    }),
  );
  let pinned = 0;
  const pinAll = (names: TerserNameMapping[] | null | undefined) => {
    for (const nm of names ?? []) {
      const linkName = nm.foreign_name.name;
      const def = nm.name.definition();
      if (!def || def.mangled_name || def.references.length === 0 || def.unmangleable(MANGLE_OPTIONS)) continue;
      if (linkName === 'default' || !IDENTIFIER.test(linkName) || taken.has(linkName) || !worthPinning(def, linkName)) continue;
      def.mangled_name = linkName;
      taken.add(linkName);
      pinned++;
    }
  };
  for (const node of ast.body) if (node.TYPE === 'Import') pinAll(node.imported_names);
  for (const node of ast.body) if (node.TYPE === 'Export' && !node.module_name) pinAll(node.exported_names);
  if (pinned === 0) return { code, pinned };
  ast.compute_char_frequency({});
  ast.mangle_names(MANGLE_OPTIONS);
  return { code: ast.print_to_string({ ecma: 2020, comments: false }), pinned };
}

/**
 * Cấu trúc gắn tên của một chunk, không kể tên biến cục bộ: theo thứ tự duyệt, mỗi ký hiệu ghi loại nút và số thứ tự khai báo nó trỏ tới
 * (biến toàn cục và tên không gắn khai báo, như tên nối của import/export, ghi nguyên chữ). Đổi tên đúng thì chuỗi này giữ nguyên.
 */
export function bindingShape(T: TerserAstApi, code: string): string {
  const ast = T.parse(code, { module: true });
  ast.figure_out_scope({});
  const ids = new Map<TerserDef, number>();
  const seq: string[] = [];
  const is = (node: TerserNode, kind: NodeClass): boolean => node instanceof kind;
  ast.walk(
    new T.TreeWalker((node) => {
      if (!is(node, T.AST_Symbol) || is(node, T.AST_Label) || is(node, T.AST_LabelRef)) return;
      const def = node.thedef;
      if (!def) seq.push(`${node.TYPE}:${node.name}`);
      else if (def.global && def.undeclared) seq.push(`${node.TYPE}:global:${node.name}`);
      else {
        if (!ids.has(def)) ids.set(def, ids.size);
        seq.push(`${node.TYPE}:${ids.get(def)}`);
      }
    }),
  );
  return seq.join('|');
}

export function sameBindings(T: TerserAstApi, before: string, after: string): boolean {
  return bindingShape(T, before) === bindingShape(T, after);
}

/**
 * Bản của bước đổi tên này. Tên tệp chunk băm từ mã TRƯỚC bước này, nên sửa luật mà quên đổi số thì chunk đầu vào không đổi giữ tên cũ với
 * nội dung mới, và bản cũ còn trong bộ đệm không bao giờ được thay.
 */
export const UNALIAS_PASS_VERSION = 'tubu-unalias-1';

/** Chạy sau mọi `generateBundle` khác (`order: 'post'`), tức sau khi Vite chèn bản đồ preload. Chunk có source map thì để nguyên. */
export function unaliasModuleNamesPlugin(): Plugin {
  return {
    name: 'tubu:unalias-module-names',
    apply: 'build',
    augmentChunkHash: () => UNALIAS_PASS_VERSION,
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const T = await loadTerserAst();
        for (const item of Object.values(bundle)) {
          if (item.type !== 'chunk' || item.map) continue;
          try {
            const { code, pinned } = unaliasModuleNames(T, item.code);
            if (pinned === 0) continue;
            if (!sameBindings(T, item.code, code)) {
              this.warn(`${item.fileName}: ghim tên nối làm đổi cấu trúc gắn tên, giữ nguyên chunk.`);
              continue;
            }
            item.code = code;
          } catch (error) {
            this.warn(`${item.fileName}: không ghim được tên nối (${error instanceof Error ? error.message : String(error)}), giữ nguyên chunk.`);
          }
        }
      },
    },
  };
}
