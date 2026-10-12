import 'reflect-metadata';
import { Controller, Get, INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicCache } from './public-cache.decorator';

@Controller('t')
class FakeController {
  @PublicCache('CATALOG')
  @Get('ok')
  ok() {
    return { ok: true };
  }

  @PublicCache('CATALOG')
  @Get('missing')
  missing() {
    throw new NotFoundException();
  }
}

describe('PublicCache chỉ áp cho response thành công (C-039)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [FakeController] }).compile();
    app = mod.createNestApplication();
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(() => app.close());

  it('200 mang public, max-age/s-maxage', async () => {
    const res = await fetch(`${base}/t/ok`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=15, s-maxage=30');
  });

  it('404 KHÔNG mang public cache', async () => {
    const res = await fetch(`${base}/t/missing`);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control') ?? '').not.toContain('public');
  });
});
