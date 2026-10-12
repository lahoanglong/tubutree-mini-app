// Quét tĩnh (AST) tìm mẫu truy vấn chậm trong apps/api/src (bỏ *.spec.ts).
// Chạy: node scripts/loadtest/static-scan.cjs > out.txt
// Chỉ ĐỌC source; không sửa gì.
const path = require('path');
const fs = require('fs');
const apiDir = path.resolve(__dirname, '../../apps/api');
const ts = require(require.resolve('typescript', { paths: [apiDir] }));

const root = path.join(apiDir, 'src');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') && !e.name.endsWith('.d.ts')) files.push(p);
  }
})(root);

const PRISMA_METHODS = new Set([
  'findMany', 'findFirst', 'findUnique', 'findUniqueOrThrow', 'findFirstOrThrow', 'create', 'createMany',
  'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy',
]);

function rel(p) { return path.relative(path.resolve(__dirname, '../..'), p).replace(/\\/g, '/'); }

// Trả về { model, method } nếu node là lời gọi prisma client (this.prisma.model.method / tx.model.method / prisma.$queryRaw...)
function prismaCall(node) {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    const method = callee.name.text;
    const obj = callee.expression;
    if (ts.isPropertyAccessExpression(obj) && PRISMA_METHODS.has(method)) {
      const modelName = obj.name.text;
      const base = obj.expression.getText();
      if (/(^|\.)(prisma|tx|db|client|trx)$/.test(base) || base === 'this.prisma' || base === 'tx') {
        return { model: modelName, method };
      }
    }
    if (/^\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)$/.test(method)) {
      return { model: '$raw', method };
    }
  }
  if (ts.isTaggedTemplateExpression(node.parent) === false) { /* noop */ }
  return null;
}
function prismaTagged(node) {
  if (ts.isTaggedTemplateExpression(node) && ts.isPropertyAccessExpression(node.tag)) {
    const m = node.tag.name.text;
    if (/^\$(queryRaw|executeRaw)$/.test(m)) return { model: '$raw', method: m };
  }
  return null;
}

function objProp(objLit, name) {
  if (!objLit || !ts.isObjectLiteralExpression(objLit)) return null;
  for (const p of objLit.properties) {
    if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === name) return p;
  }
  return null;
}

const out = { loopAwait: [], parallelMap: [], noTake: [], deepInclude: [], cron: [] };

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  // map: method name -> @Cron?
  const cronMethods = new Set();
  (function findCron(n) {
    if (ts.isMethodDeclaration(n)) {
      const decos = ts.canHaveDecorators(n) ? ts.getDecorators(n) : undefined;
      if (decos && decos.some((d) => /^(Cron|Interval)\b/.test(d.expression.getText().replace(/^@/, '')))) {
        cronMethods.add(n);
      }
    }
    ts.forEachChild(n, findCron);
  })(sf);

  function enclosingMethod(n) {
    let p = n.parent;
    while (p) { if (ts.isMethodDeclaration(p)) return p; p = p.parent; }
    return null;
  }

  function visit(node, loopDepth, inMapAsync) {
    let ld = loopDepth;
    let ima = inMapAsync;
    if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) ld++;
    // callbacks: arr.map(async ...), arr.forEach(async ...)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['map', 'forEach'].includes(node.expression.name.text)) {
      const cb = node.arguments[0];
      if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.modifiers && cb.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) ima++;
    }
    const pc = prismaCall(node) || prismaTagged(node);
    if (pc) {
      const loc = `${rel(file)}:${lineOf(node)}`;
      const m = enclosingMethod(node);
      const inCron = m && cronMethods.has(m);
      const mname = m && m.name ? m.name.getText() : '?';
      if (ld > 0 && node.parent && ts.isAwaitExpression(node.parent)) out.loopAwait.push(`${loc} ${pc.model}.${pc.method} in ${mname}${inCron ? ' [CRON]' : ''}`);
      else if (ld > 0) out.loopAwait.push(`${loc} ${pc.model}.${pc.method} (await indirect) in ${mname}${inCron ? ' [CRON]' : ''}`);
      if (ima > 0) out.parallelMap.push(`${loc} ${pc.model}.${pc.method} in ${mname}${inCron ? ' [CRON]' : ''}`);
      if (ts.isCallExpression(node) && ['findMany'].includes(pc.method)) {
        const arg = node.arguments[0];
        const hasSpread = arg && ts.isObjectLiteralExpression(arg) ? arg.properties.some((x) => ts.isSpreadAssignment(x) && /skipTake|page|limit|paginat|cursor/i.test(x.getText())) : false;
        const hasTake = arg && ts.isObjectLiteralExpression(arg) ? (!!objProp(arg, 'take') || hasSpread) : false;
        const unknownArg = arg && !ts.isObjectLiteralExpression(arg);
        if (!hasTake) {
          const where = arg && ts.isObjectLiteralExpression(arg) ? objProp(arg, 'where') : null;
          const whereTxt = where ? where.getText().replace(/\s+/g, ' ').slice(0, 110) : '(no where)';
          out.noTake.push(`${loc} ${pc.model}.findMany ${unknownArg ? '[arg not literal] ' : ''}in ${mname}${inCron ? ' [CRON]' : ''} :: ${whereTxt}`);
          if (inCron) out.cron.push(`${loc} ${pc.model}.findMany no-take in ${mname}`);
        }
        // include sâu
        const inc = arg && ts.isObjectLiteralExpression(arg) ? objProp(arg, 'include') : null;
        if (inc) {
          const t = inc.getText();
          const depth = (t.match(/include:/g) || []).length;
          if (depth >= 2) out.deepInclude.push(`${loc} ${pc.model}.findMany include depth=${depth} in ${mname}`);
        }
      }
      if (inCron && ['groupBy', 'aggregate', 'count', 'updateMany', 'deleteMany'].includes(pc.method)) {
        out.cron.push(`${loc} ${pc.model}.${pc.method} in ${mname}`);
      }
    }
    ts.forEachChild(node, (c) => visit(c, ld, ima));
  }
  visit(sf, 0, 0);
}

for (const [k, v] of Object.entries(out)) {
  console.log(`\n===== ${k} (${v.length}) =====`);
  for (const l of v) console.log(l);
}
console.error('files scanned:', files.length);
