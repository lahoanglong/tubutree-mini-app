import 'reflect-metadata';
import { type INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';

// ConfigModule.forRoot của AppModule chạy validate ngay lúc import; spec này chỉ cần đồ thị module, không cần biến môi trường thật.
jest.mock('../config/env.validation', () => ({ validateEnv: (config: Record<string, unknown>) => config }));

/**
 * PD-2 / Q-19: chương trình Beta Tester không có tác dụng và không FE nào gọi, nên 4 route /beta/* bị gỡ
 * khỏi API. Bảng `BetaTester`/`BetaFeedback` giữ nguyên (có dữ liệu khách, không DROP).
 *
 * Danh sách controller lấy từ đồ thị import thật của AppModule, không phải danh sách viết tay, để một
 * module nào đó đăng ký lại `@Controller('beta')` cũng bị bắt.
 */

type Ctor = new (...args: never[]) => unknown;
type ModuleRef = Ctor | { module: Ctor; controllers?: Ctor[]; imports?: unknown[] } | Promise<unknown>;

function collectControllers(root: Ctor): Ctor[] {
  const seen = new Set<Ctor>();
  const controllers = new Set<Ctor>();
  const visit = (ref: ModuleRef): void => {
    if (!ref || ref instanceof Promise) return;
    const mod = typeof ref === 'function' ? ref : ref.module;
    const extra = typeof ref === 'function' ? [] : (ref.controllers ?? []);
    const extraImports = typeof ref === 'function' ? [] : ((ref.imports ?? []) as ModuleRef[]);
    for (const c of extra) controllers.add(c);
    for (const c of (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, mod) as Ctor[] | undefined) ?? []) controllers.add(c);
    if (seen.has(mod)) return;
    seen.add(mod);
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, mod) as ModuleRef[] | undefined) ?? [];
    for (const child of [...imports, ...extraImports]) visit(child);
  };
  visit(root);
  return [...controllers];
}

function routesOf(controller: Ctor): string[] {
  const prefix = (Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined) ?? '';
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  const proto = controller.prototype as Record<string, unknown>;
  const out: string[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    const handler = proto[name];
    if (typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined) continue;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[];
    for (const pre of prefixes) {
      for (const p of Array.isArray(path) ? path : [path]) {
        const joined = [pre, p].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
        out.push(`${RequestMethod[method]} /${joined}`);
      }
    }
  }
  return out;
}

function guardsOf(controller: Ctor): Ctor[] {
  const proto = controller.prototype as Record<string, unknown>;
  const targets: object[] = [controller, ...Object.getOwnPropertyNames(proto).map((n) => proto[n]).filter((h): h is object => typeof h === 'function')];
  return targets.flatMap((t) => (Reflect.getMetadata(GUARDS_METADATA, t) as Ctor[] | undefined) ?? []).filter((g) => typeof g === 'function');
}

const controllers = collectControllers(AppModule as unknown as Ctor);

describe('/beta/* đã gỡ khỏi API (PD-2, Q-19)', () => {
  it('đồ thị module của AppModule còn controller (dò đúng, không rỗng)', () => {
    const all = controllers.flatMap(routesOf);
    expect(all.length).toBeGreaterThan(100);
    expect(all).toContain('GET /orders');
  });

  it('không controller nào của AppModule còn route dưới /beta', () => {
    const beta = controllers.flatMap(routesOf).filter((r) => /^\w+ \/beta(\/|$)/.test(r));
    expect(beta).toEqual([]);
  });

  describe('qua HTTP với đúng bộ controller của AppModule', () => {
    let app: INestApplication;
    let base: string;

    beforeAll(async () => {
      // Guard (JWT, vai trò, throttle) không phải đối tượng kiểm; thay bằng guard cho qua để route còn sống đi được tới handler.
      let builder = Test.createTestingModule({ controllers });
      for (const guard of new Set(controllers.flatMap(guardsOf))) builder = builder.overrideGuard(guard).useValue({ canActivate: () => true });
      const moduleRef = await builder
        .useMocker(() => new Proxy({}, { get: (_t, key) => (key === 'then' || typeof key === 'symbol' ? undefined : jest.fn()) }))
        .compile();
      app = moduleRef.createNestApplication({ logger: false });
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.listen(0, '127.0.0.1');
      base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    });
    afterAll(async () => {
      await app?.close();
    });

    const status = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
      const res = await fetch(base + path, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      await res.arrayBuffer();
      return res.status;
    };

    it.each([
      ['GET', '/beta/me', undefined],
      ['POST', '/beta/join', {}],
      ['POST', '/beta/leave', {}],
      ['POST', '/beta/feedback', { message: 'góp ý thử' }],
    ] as const)('%s %s trả 404', async (method, path, body) => {
      expect(await status(method, path, body)).toBe(404);
    });

    it('đối chứng: một route còn sống không trả 404 (bộ dựng HTTP không làm mọi đường thành 404)', async () => {
      expect(await status('GET', '/orders')).not.toBe(404);
    });
  });
});
