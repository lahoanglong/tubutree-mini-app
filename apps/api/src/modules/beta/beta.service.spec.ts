import { BadRequestException } from '@nestjs/common';
import { BetaService } from './beta.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

function makeConfig(overrides: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(k: string, fb?: T): Promise<T> => (k in overrides ? (overrides[k] as T) : (fb as T)),
  } as unknown as SystemConfigService;
}

function makePrisma(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    betaTester: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'bt1', status: 'ACTIVE', joinedAt: new Date(), ...create })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    betaFeedback: { create: jest.fn().mockResolvedValue({ id: 'bf1' }) },
  };
  return { ...base, ...over } as unknown as PrismaService;
}

const FEATURES = [{ key: 'x', title: 'Tính năng X', desc: 'thử nghiệm' }];

describe('BetaService.getStatus', () => {
  it('chưa tham gia → enrolled false, features rỗng', async () => {
    const prisma = makePrisma();
    const r = await new BetaService(prisma, makeConfig({ 'beta.features': FEATURES })).getStatus('u1');
    expect(r.enrolled).toBe(false);
    expect(r.features).toEqual([]); // chưa tham gia thì không lộ danh sách beta
  });

  it('đã tham gia (ACTIVE) → enrolled true + trả features từ config', async () => {
    const prisma = makePrisma({
      betaTester: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', joinedAt: new Date() }) },
    });
    const r = await new BetaService(prisma, makeConfig({ 'beta.features': FEATURES })).getStatus('u1');
    expect(r.enrolled).toBe(true);
    expect(r.features).toEqual(FEATURES);
  });

  it('đã rời (LEFT) → enrolled false', async () => {
    const prisma = makePrisma({
      betaTester: { findUnique: jest.fn().mockResolvedValue({ status: 'LEFT', joinedAt: new Date() }) },
    });
    const r = await new BetaService(prisma, makeConfig()).getStatus('u1');
    expect(r.enrolled).toBe(false);
  });
});

describe('BetaService.join / leave', () => {
  it('join → upsert ACTIVE (idempotent), enrolled true', async () => {
    const prisma = makePrisma();
    const r = await new BetaService(prisma, makeConfig({ 'beta.features': FEATURES })).join('u1');
    expect(r.enrolled).toBe(true);
    const up = (prisma.betaTester.upsert as jest.Mock).mock.calls[0][0];
    expect(up.where).toEqual({ userId: 'u1' });
    expect(up.update.status).toBe('ACTIVE');
    expect(up.create).toMatchObject({ userId: 'u1', status: 'ACTIVE' });
  });

  it('join khi đã ACTIVE (double-submit/retry) → giữ nguyên joinedAt gốc, không upsert lại', async () => {
    const originalJoinedAt = new Date('2026-01-01T00:00:00Z');
    const prisma = makePrisma({
      betaTester: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', joinedAt: originalJoinedAt }),
        upsert: jest.fn(),
      },
    });
    const r = await new BetaService(prisma, makeConfig({ 'beta.features': FEATURES })).join('u1');
    expect(r.enrolled).toBe(true);
    expect(r.joinedAt).toBe(originalJoinedAt);
    expect(prisma.betaTester.upsert).not.toHaveBeenCalled();
  });

  it('leave → set LEFT (updateMany idempotent theo userId), enrolled false', async () => {
    const prisma = makePrisma();
    const r = await new BetaService(prisma, makeConfig()).leave('u1');
    expect(r.enrolled).toBe(false);
    const upd = (prisma.betaTester.updateMany as jest.Mock).mock.calls[0][0];
    expect(upd.where).toEqual({ userId: 'u1' });
    expect(upd.data.status).toBe('LEFT');
  });
});

describe('BetaService.submitFeedback', () => {
  it('chưa tham gia → throw, không tạo feedback', async () => {
    const prisma = makePrisma();
    await expect(
      new BetaService(prisma, makeConfig()).submitFeedback('u1', 'góp ý'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.betaFeedback.create).not.toHaveBeenCalled();
  });

  it('nội dung rỗng → throw', async () => {
    const prisma = makePrisma({
      betaTester: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', joinedAt: new Date() }) },
    });
    await expect(new BetaService(prisma, makeConfig()).submitFeedback('u1', '   ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('đã tham gia + có nội dung → tạo feedback', async () => {
    const prisma = makePrisma({
      betaTester: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', joinedAt: new Date() }) },
      betaFeedback: { create: jest.fn().mockResolvedValue({ id: 'bf1' }) },
    });
    const r = await new BetaService(prisma, makeConfig()).submitFeedback('u1', '  app rất tốt  ');
    expect(r.ok).toBe(true);
    const created = (prisma.betaFeedback.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toMatchObject({ userId: 'u1', message: 'app rất tốt' }); // trim
  });
});
