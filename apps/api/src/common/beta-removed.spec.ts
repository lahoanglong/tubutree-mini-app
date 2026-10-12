import 'reflect-metadata';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { collectControllers, guardsOf, routesOf, type Ctor } from './route-graph';

// ConfigModule.forRoot của AppModule chạy validate ngay lúc import; spec này chỉ cần đồ thị module, không cần biến môi trường thật.
jest.mock('../config/env.validation', () => ({ validateEnv: (config: Record<string, unknown>) => config }));

/**
 * PD-2 / Q-19: chương trình Beta Tester không có tác dụng và không FE nào gọi, nên 4 route /beta/* bị gỡ
 * khỏi API. Bảng `BetaTester`/`BetaFeedback` giữ nguyên (có dữ liệu khách, không DROP).
 *
 * Danh sách controller lấy từ đồ thị import thật của AppModule (route-graph.ts, dùng chung với
 * endpoint-inventory.spec.ts), không phải danh sách viết tay, để một module nào đó đăng ký lại
 * `@Controller('beta')` cũng bị bắt.
 */

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
