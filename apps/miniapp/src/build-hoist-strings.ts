import type { Plugin } from 'vite';
import { loadTerserAst, type TerserAstApi } from './build-import-names';

/**
 * Terser không gộp chuỗi trùng: `"var(--color-bg-surface)"`, `"secondary"`, `"data-testid"`… lặp hàng chục lần trong cùng một chunk (style
 * nội tuyến, prop của Text/Button, so `typeof x=="function"`), mỗi lần đủ cả chữ. Zalo cân tổng dung lượng thô của gói, nên bước này gom mỗi
 * chuỗi lặp đủ nhiều của một chunk vào một hằng ở đầu chunk (`const a="…",b="…";`) rồi để bộ đặt tên của terser đặt tên ngắn cho hằng đó.
 * Mỗi chỗ dùng còn 1–2 ký tự thay vì cả chuỗi. Giá trị chuỗi, thứ tự chạy và cấu trúc gắn tên không đổi:
 *   - Khóa thuộc tính viết thường (`{"aria-label":x}`) không phải nút chuỗi trong cây của terser nên không bị đụng; khóa tính (`["k"]`) vẫn tính.
 *   - Không đụng nguồn import/export, `import("./x.js")` và chuỗi tên tệp (`.module.js`, `.css`): rào chunk lười và bản đồ preload đọc chúng.
 *   - Hằng nằm ở câu lệnh chạy đầu tiên của chunk. Chunk nằm trong vòng import tĩnh thì để nguyên: trong vòng, mã chunk khác có thể gọi hàm của
 *     chunk này trước khi câu lệnh đầu chạy (hằng còn trong vùng chết tạm thời). Chunk có `eval`/`with` cũng để nguyên.
 *   - `sameAfterInlining` thế ngược mỗi hằng vào chỗ dùng rồi so với chunk gốc sau khi chuẩn hoá tên biến; lệch thì giữ chunk gốc và cảnh báo.
 */

/* Kiểu tối thiểu cho phần cây cú pháp của terser dùng ở đây. */
interface Def {
  global: boolean;
  undeclared: boolean;
  mangled_name?: string | null;
}
interface Node {
  TYPE: string;
  name?: string;
  value?: unknown;
  thedef?: Def;
  expression?: Node;
  start?: unknown;
  end?: unknown;
  body?: Node[];
  definitions?: { name: Node; value: Node | null }[];
  transform(tt: unknown): Node;
  walk(visitor: unknown): void;
}
interface Toplevel extends Node {
  body: Node[];
  uses_eval?: boolean;
  uses_with?: boolean;
  figure_out_scope(options: object): void;
  compute_char_frequency(options: object): void;
  mangle_names(options: object): void;
  print_to_string(options: object): string;
}
type NodeClass = new (props: object) => Node;
interface Walker {
  parent(n?: number): Node | undefined;
}

interface HoistApi {
  parse(code: string): Toplevel;
  walker(visit: (this: Walker, node: Node) => boolean | void): unknown;
  transformer(before: (node: Node) => Node | undefined): unknown;
  is(node: Node, kind: string): boolean;
  make(kind: string, props: object): Node;
}

function hoistApi(T: TerserAstApi): HoistApi {
  const cls = (kind: string) => {
    const c = T.nodes[kind];
    if (typeof c !== 'function') throw new Error(`terser không có lớp ${kind}`);
    return c as NodeClass;
  };
  const Transformer = cls('TreeTransformer') as unknown as new (before: (node: Node) => Node | undefined) => unknown;
  const Walk = T.TreeWalker as unknown as new (visit: (this: Walker, node: Node) => boolean | void) => unknown;
  return {
    parse: (code) => T.parse(code, { module: true }) as unknown as Toplevel,
    walker: (visit) => new Walk(visit),
    transformer: (before) => new Transformer(before),
    is: (node, kind) => node instanceof cls(kind),
    make: (kind, props) => new (cls(kind))(props),
  };
}

const MANGLE_OPTIONS = { module: true, toplevel: true };
/** Chunk là ES module nên chạy strict: `function` khai trong khối chỉ sống trong khối. Thiếu `module` thì terser gắn nó vào phạm vi cả hàm và đặt tên sai. */
const SCOPE_OPTIONS = { module: true };
const PRINT_OPTIONS = { ecma: 2020, comments: false };
/** Chuỗi tên tệp: bản đồ preload của Vite và rào chunk lười (`scripts/ci/mini-lazy-chunks.cjs`) đọc nguyên chữ. */
const FILE_NAME = /\.module\.js$|\.css$/;
const PLACEHOLDER = '__tubu_hoisted_';
/** Tên terser đặt cho hằng gom: chunk lớn dùng hết tên một ký tự ở cấp cao nhất nên tính 2. */
const NAME_BYTES = 2;

const byteLength = (s: string) => Buffer.byteLength(s, 'utf8');
/** Số byte của chuỗi khi in (UTF-8: chữ Việt có dấu 2–3 byte). */
export const literalBytes = (value: string): number => byteLength(JSON.stringify(value));

/** Gom khi phần bỏ được ở mọi chỗ dùng lớn hơn phần thêm vào khai báo (`a="…",`). */
export function worthHoisting(bytes: number, count: number): boolean {
  return count >= 2 && count * (bytes - NAME_BYTES) > bytes + NAME_BYTES + 2;
}

function isDynamicImportArg(parent: Node | undefined): boolean {
  return parent?.TYPE === 'Call' && parent.expression?.TYPE === 'SymbolRef' && parent.expression.name === 'import';
}

function leadingImports(body: Node[]): number {
  let i = 0;
  while (i < body.length && body[i]!.TYPE === 'Import') i++;
  return i;
}

export function hoistRepeatedStrings(T: TerserAstApi, code: string): { code: string; hoisted: number } {
  const H = hoistApi(T);
  if (code.includes(PLACEHOLDER)) return { code, hoisted: 0 };
  const ast = H.parse(code);
  ast.figure_out_scope(SCOPE_OPTIONS);
  if (ast.uses_eval || ast.uses_with) return { code, hoisted: 0 };

  const uses = new Map<string, Node[]>();
  ast.walk(
    H.walker(function (node) {
      if (!H.is(node, 'AST_String') || typeof node.value !== 'string') return;
      const parent = this.parent();
      if (parent?.TYPE === 'Import' || parent?.TYPE === 'Export' || isDynamicImportArg(parent) || FILE_NAME.test(node.value)) return;
      const list = uses.get(node.value);
      if (list) list.push(node);
      else uses.set(node.value, [node]);
    }),
  );

  const nameOf = new Map<Node, string>();
  const decls: Node[] = [];
  for (const [value, nodes] of uses) {
    if (!worthHoisting(literalBytes(value), nodes.length)) continue;
    const name = `${PLACEHOLDER}${decls.length}`;
    for (const n of nodes) nameOf.set(n, name);
    // Bộ in của terser đọc `start` của biểu thức (chú thích đứng trước), nên nút mới mượn vị trí của chỗ dùng đầu tiên.
    const at = { start: nodes[0]!.start, end: nodes[0]!.end };
    decls.push(H.make('AST_VarDef', { name: H.make('AST_SymbolConst', { name, ...at }), value: H.make('AST_String', { value, quote: '"', ...at }), ...at }));
  }
  if (decls.length === 0) return { code, hoisted: 0 };

  const out = ast.transform(
    H.transformer((node) => {
      const name = nameOf.get(node);
      return name ? H.make('AST_SymbolRef', { name, start: node.start, end: node.end }) : undefined;
    }),
  ) as Toplevel;
  const first = out.body[leadingImports(out.body)] ?? out;
  out.body.splice(leadingImports(out.body), 0, H.make('AST_Const', { definitions: decls, start: first.start, end: first.start }));
  out.figure_out_scope(SCOPE_OPTIONS);
  out.compute_char_frequency({});
  out.mangle_names(MANGLE_OPTIONS);
  const printed = out.print_to_string(PRINT_OPTIONS);
  if (byteLength(printed) >= byteLength(code)) return { code, hoisted: 0 };
  return { code: printed, hoisted: decls.length };
}

/** Thế ngược: bỏ khai báo hằng gom (câu lệnh ngay sau các import đầu chunk) và đặt lại chuỗi vào mọi chỗ tham chiếu tới nó. */
export function inlineHoisted(T: TerserAstApi, code: string): string {
  const H = hoistApi(T);
  const ast = H.parse(code);
  ast.figure_out_scope(SCOPE_OPTIONS);
  const at = leadingImports(ast.body);
  const decl = ast.body[at];
  if (!decl || decl.TYPE !== 'Const') throw new Error('không thấy khai báo hằng gom sau các import');
  const values = new Map<Def, string>();
  for (const d of decl.definitions ?? []) {
    if (!d.value || d.value.TYPE !== 'String' || typeof d.value.value !== 'string' || !d.name.thedef) {
      throw new Error('khai báo hằng gom có phần tử không phải chuỗi');
    }
    values.set(d.name.thedef, d.value.value);
  }
  ast.body.splice(at, 1);
  const out = ast.transform(
    H.transformer((node) => {
      if (node.TYPE !== 'SymbolRef' || !node.thedef) return undefined;
      const value = values.get(node.thedef);
      return value === undefined ? undefined : H.make('AST_String', { value, quote: '"', start: node.start, end: node.end });
    }),
  ) as Toplevel;
  return out.print_to_string(PRINT_OPTIONS);
}

/** Mã in lại với mọi biến khai báo và nhãn đổi thành số thứ tự xuất hiện (biến toàn cục giữ tên): hai chunk chỉ khác tên biến cục bộ cho cùng chuỗi. */
export function canonicalCode(T: TerserAstApi, code: string): string {
  const H = hoistApi(T);
  const ast = H.parse(code);
  ast.figure_out_scope(SCOPE_OPTIONS);
  const ids = new Map<Def, number>();
  ast.walk(
    H.walker((node) => {
      // Nhãn cũng đổi tên khi terser đặt lại tên (`thedef` của nhãn là chính nó, của chỗ nhảy tới là nhãn đó) nên chuẩn hoá luôn.
      if (!H.is(node, 'AST_Symbol')) return;
      const def = node.thedef;
      if (!def || (def.global && def.undeclared) || ids.has(def)) return;
      ids.set(def, ids.size);
      def.mangled_name = `#${ids.size}`;
    }),
  );
  return ast.print_to_string(PRINT_OPTIONS);
}

export function sameAfterInlining(T: TerserAstApi, before: string, after: string): boolean {
  return canonicalCode(T, before) === canonicalCode(T, inlineHoisted(T, after));
}

/** Chunk thuộc một vòng import tĩnh (thành phần liên thông mạnh trên 1 chunk, hoặc tự import chính nó). */
export function chunksInImportCycles(graph: ReadonlyMap<string, readonly string[]>): Set<string> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const inCycle = new Set<string>();
  const visit = (v: string) => {
    index.set(v, index.size);
    low.set(v, index.get(v)!);
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!graph.has(w)) continue;
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) !== index.get(v)) return;
    const scc: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      onStack.delete(w);
      scc.push(w);
    } while (w !== v);
    if (scc.length > 1 || (graph.get(v) ?? []).includes(v)) for (const x of scc) inCycle.add(x);
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return inCycle;
}

/** Như UNALIAS_PASS_VERSION: tên chunk băm từ mã trước bước này, sửa luật thì đổi số để tên tệp đổi theo. */
export const HOIST_PASS_VERSION = 'tubu-hoist-strings-1';

/**
 * Chạy ở `generateBundle` (`order: 'post'`), sau khi Vite chèn bản đồ preload. Đặt TRƯỚC unaliasModuleNamesPlugin trong vite.config: bước này đặt
 * lại mọi tên biến cục bộ, bước sau ghim lại tên nối import/export. Chunk có source map thì để nguyên.
 */
export function hoistRepeatedStringsPlugin(): Plugin {
  return {
    name: 'tubu:hoist-repeated-strings',
    apply: 'build',
    augmentChunkHash: () => HOIST_PASS_VERSION,
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        const T = await loadTerserAst();
        const graph = new Map<string, readonly string[]>();
        for (const item of Object.values(bundle)) if (item.type === 'chunk') graph.set(item.fileName, item.imports);
        const cyclic = chunksInImportCycles(graph);
        for (const item of Object.values(bundle)) {
          if (item.type !== 'chunk' || item.map || cyclic.has(item.fileName)) continue;
          try {
            const { code, hoisted } = hoistRepeatedStrings(T, item.code);
            if (hoisted === 0) continue;
            if (!sameAfterInlining(T, item.code, code)) {
              this.warn(`${item.fileName}: gom chuỗi làm đổi mã sau khi thế ngược, giữ nguyên chunk.`);
              continue;
            }
            item.code = code;
          } catch (error) {
            this.warn(`${item.fileName}: không gom được chuỗi (${error instanceof Error ? error.message : String(error)}), giữ nguyên chunk.`);
          }
        }
      },
    },
  };
}
