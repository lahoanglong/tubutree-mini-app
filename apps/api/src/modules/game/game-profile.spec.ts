import { Prisma } from '@prisma/client';
import { ensureGameProfile } from './game-profile';

const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' });

function setup(overrides: Partial<{ findUnique: jest.Mock; create: jest.Mock; findUniqueOrThrow: jest.Mock }> = {}) {
  const gameProfile = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'gp-new' }),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'gp-winner' }),
    ...overrides,
  };
  const config = { get: jest.fn().mockResolvedValue(600) };
  return { prisma: { gameProfile } as never, gameProfile, config };
}

describe('ensureGameProfile', () => {
  it('đã có hồ sơ → trả luôn, không tạo, không đọc config', async () => {
    const { prisma, gameProfile, config } = setup({ findUnique: jest.fn().mockResolvedValue({ id: 'gp-1' }) });
    await expect(ensureGameProfile(prisma, config, 'u1')).resolves.toEqual({ id: 'gp-1' });
    expect(gameProfile.create).not.toHaveBeenCalled();
    expect(config.get).not.toHaveBeenCalled();
  });

  it('chưa có → tạo với mục tiêu cây mặc định từ config', async () => {
    const { prisma, gameProfile, config } = setup();
    await expect(ensureGameProfile(prisma, config, 'u1')).resolves.toEqual({ id: 'gp-new' });
    expect(gameProfile.create).toHaveBeenCalledWith({
      data: { userId: 'u1', ecoImpact: expect.objectContaining({ progress: 0, target: 600, treesPlanted: 0 }) },
    });
  });

  it('thua race (P2002) → đọc lại hàng của request thắng thay vì ném 409 cho khách', async () => {
    const { prisma, gameProfile, config } = setup({ create: jest.fn().mockRejectedValue(p2002()) });
    await expect(ensureGameProfile(prisma, config, 'u1')).resolves.toEqual({ id: 'gp-winner' });
    expect(gameProfile.findUniqueOrThrow).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('lỗi khác P2002 vẫn ném ra', async () => {
    const boom = new Error('db down');
    const { prisma, config } = setup({ create: jest.fn().mockRejectedValue(boom) });
    await expect(ensureGameProfile(prisma, config, 'u1')).rejects.toBe(boom);
  });
});
