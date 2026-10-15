import 'reflect-metadata';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as ts from 'typescript';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PARAMTYPES_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { getMetadataStorage, validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AppModule } from '../app.module';
import { collectControllers, type Ctor } from './route-graph';
import { createValidationPipe } from './validation-pipe';

// ConfigModule.forRoot của AppModule chạy validate ngay lúc import; spec này chỉ cần đồ thị module, không cần biến môi trường thật.
jest.mock('../config/env.validation', () => ({ validateEnv: (config: Record<string, unknown>) => config }));

/**
 * PATCH/PUT: bỏ trường = giữ nguyên, còn `null` là một giá trị. @IsOptional() cho qua cả null, nên một trường khai báo
 * `?: string` (không có null) vẫn nhận null rồi ghi thẳng vào cột NOT NULL → Prisma ném lỗi → 500 trần (R5-ADMIN-1: coupon
 * isActive, flash sale title/isActive, phí giao hộ đối tác…).
 *
 * Quy ước kiểm ở đây, dựng từ chính đồ thị controller (không phải danh sách tay): mọi body PATCH/PUT mà một trường nhận
 * được null phải khai báo `| null` trong DTO (nghĩa là dịch vụ xử lý null có chủ ý, vd xoá giá trị). Trường không khai báo
 * null phải dùng @OptionalNotNull() để null bị chặn 400 bằng tiếng Việt.
 */

const SRC = join(__dirname, '..');
const BODY_PARAM = 3;
const WRITE_METHODS = new Set<RequestMethod>([RequestMethod.PATCH, RequestMethod.PUT]);
/** POST tạo mới mà dịch vụ đưa thẳng giá trị DTO vào cột NOT NULL (các POST còn lại dùng `?? mặc định`, null vô hại). */
const PASS_THROUGH_POSTS = new Set(['POST /feed/events']);

function listSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listSources(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const parsed = new Map<string, ts.SourceFile>();
function source(file: string): ts.SourceFile {
  let sf = parsed.get(file);
  if (!sf) {
    sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
    parsed.set(file, sf);
  }
  return sf;
}

function classIn(file: string, name: string): ts.ClassDeclaration | undefined {
  let found: ts.ClassDeclaration | undefined;
  source(file).forEachChild((n) => {
    if (ts.isClassDeclaration(n) && n.name?.text === name) found = n;
  });
  return found;
}

function importedFrom(file: string, name: string): string | undefined {
  let target: string | undefined;
  source(file).forEachChild((n) => {
    if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier) || !n.moduleSpecifier.text.startsWith('.')) return;
    const bindings = n.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || !bindings.elements.some((e) => e.name.text === name)) return;
    const base = resolve(dirname(file), n.moduleSpecifier.text);
    target = [`${base}.ts`, join(base, 'index.ts')].find((p) => existsSync(p));
  });
  return target;
}

/** Nơi khai báo class `name` mà `file` dùng: chính file đó, hoặc file nó import (đi theo tối đa vài lần re-export). */
function locate(file: string, name: string, hops = 3): { file: string; node: ts.ClassDeclaration } | undefined {
  const node = classIn(file, name);
  if (node) return { file, node };
  const next = hops > 0 ? importedFrom(file, name) : undefined;
  return next ? locate(next, name, hops - 1) : undefined;
}

/** Tên trường → có khai báo null (hoặc unknown/any, vốn chứa null) không. Gồm cả trường kế thừa. */
function declaredNullability(file: string, node: ts.ClassDeclaration): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const parent of clause.types) {
      const at = locate(file, parent.expression.getText());
      if (at) for (const [k, v] of declaredNullability(at.file, at.node)) out.set(k, v);
    }
  }
  for (const m of node.members) {
    if (!ts.isPropertyDeclaration(m) || !ts.isIdentifier(m.name)) continue;
    out.set(m.name.text, !m.type || /\b(null|unknown|any)\b/.test(m.type.getText()));
  }
  return out;
}

interface WriteBody {
  route: string;
  cls: new () => object;
  /** Trường → khai báo có null không; thiếu = không đọc được khai báo. */
  declared: Map<string, boolean> | undefined;
}

function controllerFile(name: string): string | undefined {
  return listSources(SRC).find((f) => readFileSync(f, 'utf8').includes(`class ${name}`) && classIn(f, name));
}

/** Body PATCH/PUT (cả đối tượng, không phải @Body('x')) của mọi controller trong AppModule. */
function collectWriteBodies(): WriteBody[] {
  const out: WriteBody[] = [];
  const seen = new Set<unknown>();
  for (const controller of collectControllers(AppModule as unknown as Ctor)) {
    const name = (controller as unknown as { name: string }).name;
    const file = controllerFile(name);
    const proto = controller.prototype as Record<string, unknown>;
    const prefix = (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
    for (const handlerName of Object.getOwnPropertyNames(proto)) {
      const handler = proto[handlerName];
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      const path = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
      const route = `${RequestMethod[method]} /${[prefix, path].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
      if (!WRITE_METHODS.has(method) && !PASS_THROUGH_POSTS.has(route)) continue;
      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) ?? {}) as Record<string, { index: number; data?: unknown }>;
      const types = (Reflect.getMetadata(PARAMTYPES_METADATA, proto, handlerName) ?? []) as Array<new () => object>;
      for (const [key, arg] of Object.entries(args)) {
        if (Number(key.split(':')[0]) !== BODY_PARAM || arg.data !== undefined) continue;
        const cls = types[arg.index];
        if (!cls || seen.has(`${route}|${cls.name}`)) continue;
        seen.add(`${route}|${cls.name}`);
        const at = file ? locate(file, cls.name) : undefined;
        out.push({ route, cls, declared: at ? declaredNullability(at.file, at.node) : undefined });
      }
    }
  }
  return out;
}

const storage = getMetadataStorage() as unknown as { validationMetadatas: Map<unknown, Array<{ propertyName: string; type: string }>> };

/** Trường có kiểm điều kiện (@IsOptional hoặc @ValidateIf) mà null vượt qua được. */
async function nullAccepted(cls: new () => object): Promise<string[]> {
  const props = new Set((storage.validationMetadatas.get(cls) ?? []).filter((m) => m.type === 'conditionalValidation').map((m) => m.propertyName));
  const out: string[] = [];
  for (const prop of props) {
    const errors = await validate(plainToInstance(cls, { [prop]: null }), { whitelist: true });
    if (!errors.some((e) => e.property === prop)) out.push(prop);
  }
  return out.sort();
}

describe('body PATCH/PUT: null không phải "bỏ trường" (R5-ADMIN-1)', () => {
  const bodies = collectWriteBodies();
  const byRoute = (route: string) => bodies.find((b) => b.route === route)!;

  it('dựng được danh sách body PATCH/PUT từ đồ thị controller và đọc được khai báo kiểu của từng DTO', () => {
    expect(bodies.length).toBeGreaterThan(30);
    const unreadable = bodies.filter((b) => !b.declared).map((b) => `${b.route} ${b.cls.name}`);
    expect(unreadable).toEqual([]);
    for (const route of [
      'PATCH /admin/coupons/:id',
      'PATCH /admin/flash-sales/:id',
      'PATCH /admin/merchant-fulfilment/stores/:storefrontId/terms',
      'PATCH /admin/refill-locations/:id',
      ...PASS_THROUGH_POSTS,
    ]) {
      expect(byRoute(route)).toBeDefined();
    }
  });

  it('nhận ra trường khai báo `| null` (nên null hợp lệ ở đó) và không nhầm với trường không khai báo', async () => {
    const coupon = byRoute('PATCH /admin/coupons/:id');
    expect(coupon.declared!.get('usageLimit')).toBe(true);
    expect(coupon.declared!.get('isActive')).toBe(false);
    expect(await nullAccepted(coupon.cls)).toContain('usageLimit');
    const terms = byRoute('PATCH /admin/merchant-fulfilment/stores/:storefrontId/terms');
    expect(terms.declared!.get('commissionPct')).toBe(true);
    expect(terms.declared!.get('consignmentFeePct')).toBe(false);
  });

  it('mọi trường PATCH/PUT nhận được null đều khai báo `| null`; còn lại phải chặn null', async () => {
    const violations: string[] = [];
    for (const { route, cls, declared } of bodies) {
      for (const prop of await nullAccepted(cls)) {
        if (declared!.get(prop) !== true) violations.push(`${route}  ${cls.name}.${prop}`);
      }
    }
    expect(violations).toEqual([]);
  });

  describe('qua ValidationPipe thật: 400 tiếng Việt, đúng một câu, không phải 500', () => {
    const pipe = createValidationPipe();
    const messages = async (route: string, body: Record<string, unknown>): Promise<string[] | null> => {
      try {
        await pipe.transform(body, { type: 'body', metatype: byRoute(route).cls, data: undefined });
        return null;
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        return ((e as BadRequestException).getResponse() as { message: string[] }).message;
      }
    };

    it.each([
      ['PATCH /admin/coupons/:id', 'isActive', 'Trường «isActive»'],
      ['PATCH /admin/flash-sales/:id', 'title', 'Tiêu đề'],
      ['PATCH /admin/flash-sales/:id', 'isActive', 'Trường «isActive»'],
      ['PATCH /admin/flash-sales/:id', 'startAt', 'Thời gian bắt đầu'],
      ['PATCH /admin/flash-sales/:id', 'endAt', 'Thời gian kết thúc'],
      ['PATCH /admin/merchant-fulfilment/stores/:storefrontId/terms', 'consignmentFeePct', 'Trường «consignmentFeePct»'],
      ['PATCH /admin/merchant-fulfilment/stores/:storefrontId/terms', 'consignmentFeeFixed', 'Trường «consignmentFeeFixed»'],
      ['PUT /merchant/store', 'title', 'Tiêu đề'],
      ['PUT /merchant/store', 'isPublished', 'Trường «isPublished»'],
      ['PATCH /storefront/me', 'title', 'Tiêu đề'],
    ])('%s với %s = null → 400', async (route, field, subject) => {
      expect(await messages(route, { [field]: null })).toEqual([`${subject} không được để null; bỏ trường này nếu không muốn đổi.`]);
    });

    it('POST /feed/events: rewardPoints null (cột NOT NULL, DTO đi thẳng vào Prisma) → 400, bỏ trường vẫn tạo được', async () => {
      const base = { title: 'Thử thách tháng 10', startAt: '2026-10-20T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z' };
      expect(await messages('POST /feed/events', { ...base, rewardPoints: null })).toEqual([
        'Trường «rewardPoints» không được để null; bỏ trường này nếu không muốn đổi.',
      ]);
      expect(await messages('POST /feed/events', base)).toBeNull();
    });

    it('bỏ trường hoặc giá trị đúng kiểu vẫn qua; null ở trường khai báo `| null` vẫn qua', async () => {
      expect(await messages('PATCH /admin/coupons/:id', {})).toBeNull();
      expect(await messages('PATCH /admin/coupons/:id', { isActive: false })).toBeNull();
      expect(await messages('PATCH /admin/coupons/:id', { usageLimit: null })).toBeNull();
      expect(await messages('PATCH /admin/flash-sales/:id', { title: 'Sale mới', isActive: true })).toBeNull();
      expect(await messages('PATCH /admin/merchant-fulfilment/stores/:storefrontId/terms', { commissionPct: null })).toBeNull();
    });

    it('kiểu sai (không phải null) vẫn nhận câu lỗi cũ của trường', async () => {
      expect(await messages('PATCH /admin/coupons/:id', { isActive: 'yes' })).toEqual(['Trường «isActive» chỉ nhận đúng hoặc sai.']);
    });

    it('trường để chuỗi trống vẫn bị luật tên không được trống chặn như trước', async () => {
      expect(await messages('PATCH /admin/flash-sales/:id', { title: '   ' })).toEqual(['Tiêu đề không được để trống.']);
    });
  });
});
