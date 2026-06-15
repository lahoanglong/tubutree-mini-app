import { GameCollectionService } from './game-collection.service';
import type { PrismaService } from '../../prisma/prisma.service';

const SPECIES = [
  { id: 's-com', name: 'Tràm', rarity: 'COMMON', emoji: '🌿', region: 'Cần Giờ', story: 'st1', ecoFact: 'ef1' },
  { id: 's-rare', name: 'Lim', rarity: 'RARE', emoji: '🌳', region: 'Tây Bắc', story: 'st2', ecoFact: 'ef2' },
  { id: 's-leg', name: 'Bao báp', rarity: 'LEGENDARY', emoji: '🌴', region: 'Hiếm', story: 'st3', ecoFact: 'ef3' },
];

function setup(species = SPECIES, mine: unknown[] = []) {
  const plantSpecies = { findMany: jest.fn().mockResolvedValue(species) };
  const userSpecies = {
    findMany: jest.fn().mockResolvedValue(mine),
    upsert: jest.fn().mockResolvedValue({}),
  };
  const prisma = { plantSpecies, userSpecies } as unknown as PrismaService;
  return { svc: new GameCollectionService(prisma), plantSpecies, userSpecies };
}

describe('GameCollectionService.collectOnHarvest', () => {
  it('không có loài nào trong DB → null', async () => {
    const { svc, userSpecies } = setup([]);
    expect(await svc.collectOnHarvest('u1')).toBeNull();
    expect(userSpecies.upsert).not.toHaveBeenCalled();
  });

  it('thu hoạch → sưu tập 1 loài (upsert increment) + trả loài', async () => {
    const { svc, userSpecies } = setup();
    const r = await svc.collectOnHarvest('u1', 0); // rand=0 → loài đầu (COMMON)
    expect(r?.id).toBe('s-com');
    expect(r?.story).toBe('st1');
    expect(userSpecies.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_speciesId: { userId: 'u1', speciesId: 's-com' } },
        update: { count: { increment: 1 } },
      }),
    );
  });

  it('weighted theo rarity: rand gần 1 → loài hiếm cuối (LEGENDARY)', async () => {
    const { svc } = setup();
    const r = await svc.collectOnHarvest('u1', 0.999);
    expect(r?.id).toBe('s-leg');
  });
});

describe('GameCollectionService.getCodex', () => {
  it('gộp toàn bộ loài + trạng thái sở hữu; khoá story khi chưa mở', async () => {
    const { svc } = setup(SPECIES, [{ speciesId: 's-com', count: 3 }]);
    const codex = await svc.getCodex('u1');
    expect(codex).toHaveLength(3);
    const com = codex.find((c) => c.id === 's-com')!;
    expect(com.owned).toBe(true);
    expect(com.count).toBe(3);
    expect(com.story).toBe('st1'); // đã mở → hiện chuyện
    const rare = codex.find((c) => c.id === 's-rare')!;
    expect(rare.owned).toBe(false);
    expect(rare.count).toBe(0);
    expect(rare.story).toBeNull(); // chưa mở → ẩn chuyện
    expect(rare.name).toBe('Lim'); // tên + emoji vẫn hiện
  });

  it('đếm số loài đã mở', async () => {
    const { svc } = setup(SPECIES, [{ speciesId: 's-com', count: 1 }, { speciesId: 's-leg', count: 2 }]);
    const codex = await svc.getCodex('u1');
    expect(codex.filter((c) => c.owned)).toHaveLength(2);
  });
});
