import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdvisorStatsController } from './advisor-stats.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { FaqService } from '../faq/faq.service';
import { AdvisorStatsService } from './advisor-stats.service';
import { AiAdvisorService } from './ai-advisor.service';
import { LlmClient } from './llm.client';

describe('AdvisorStatsController', () => {
  it('đường dẫn GET admin/ai-advisor/stats', () => {
    expect(Reflect.getMetadata('path', AdvisorStatsController)).toBe('admin/ai-advisor');
    expect(Reflect.getMetadata('path', AdvisorStatsController.prototype.getStats)).toBe('stats');
    // RequestMethod.GET = 0
    expect(Reflect.getMetadata('method', AdvisorStatsController.prototype.getStats)).toBe(0);
  });

  it('@Roles ADMIN ở lớp, không mở thêm cho nhóm nhân viên nào (@AllowStaff)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdvisorStatsController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(ROLES_KEY, AdvisorStatsController.prototype.getStats)).toBeUndefined();
  });

  it('RolesGuard thật: ADMIN qua; khách, CTV, đại lý, nhân viên mọi nhóm bị chặn', () => {
    const guard = new RolesGuard(new Reflector());
    const ctx = (user: object) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
        getHandler: () => AdvisorStatsController.prototype.getStats,
        getClass: () => AdvisorStatsController,
      }) as unknown as ExecutionContext;
    expect(guard.canActivate(ctx({ role: 'ADMIN' }))).toBe(true);
    for (const user of [{ role: 'CUSTOMER' }, { role: 'AFFILIATE' }, { role: 'DEALER' }, { role: 'STAFF', staffPermissions: ['CSKH', 'KHO', 'KE_TOAN', 'MARKETING'] }]) {
      expect(() => guard.canActivate(ctx(user))).toThrow(ForbiddenException);
    }
  });

  it('trả đúng snapshot của AdvisorStatsService', () => {
    const stats = new AdvisorStatsService();
    stats.record({ outcome: 'ok', ms: 250, products: [{ slug: 'nrc', name: 'Nước rửa chén' }] });
    stats.record({ outcome: 'fallback', ms: 40, products: [] });
    const out = new AdvisorStatsController(stats).getStats();
    expect(out).toEqual(stats.snapshot());
    expect(out).toMatchObject({ total: 2, ok: 1, fallback: 1, latencySamples: 2, latencyP95Ms: 250, topSkus: [{ slug: 'nrc', name: 'Nước rửa chén', count: 1 }] });
  });

  it('Nest nối cùng MỘT AdvisorStatsService vào AiAdvisorService và controller (@Optional không làm rơi bộ đếm khi chạy thật)', async () => {
    const llm = { isConfigured: () => false };
    const prisma = { product: { findMany: jest.fn().mockResolvedValue([]) } };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdvisorStatsController],
      providers: [
        AiAdvisorService,
        AdvisorStatsService,
        { provide: PrismaService, useValue: prisma },
        { provide: LlmClient, useValue: llm },
        { provide: FaqService, useValue: { listActive: jest.fn() } },
      ],
    }).compile();
    await moduleRef.get(AiAdvisorService).chat('u1', 'nước rửa chén');
    expect(moduleRef.get(AdvisorStatsController).getStats()).toMatchObject({ total: 1, fallback: 1, ok: 0 });
  });
});
