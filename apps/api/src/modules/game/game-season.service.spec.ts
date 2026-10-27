import { GameSeasonService } from './game-season.service';
import type { PrismaService } from '../../prisma/prisma.service';

const SEASON = {
  id: 'se-2026-cangio',
  name: 'Mùa Phủ Xanh Cần Giờ',
  theme: 'Rừng ngập mặn',
  region: 'Cần Giờ, TP.HCM',
  featuredSpeciesIds: ['sp-duoc', 'sp-tram'],
  startAt: new Date('2026-06-01'),
  endAt: new Date('2026-08-31'),
};
const FEATURED = [
  { id: 'sp-duoc', name: 'Cây Đước', emoji: '🌱', rarity: 'COMMON' },
  { id: 'sp-tram', name: 'Cây Tràm', emoji: '🌿', rarity: 'COMMON' },
];

function setup(opts: {
  season?: Record<string, unknown> | null;
  featured?: unknown[];
  goal?: Record<string, unknown> | null;
  contribs?: unknown[];
} = {}) {
  const season = { findFirst: jest.fn().mockResolvedValue('season' in opts ? opts.season : SEASON) };
  const plantSpecies = { findMany: jest.fn().mockResolvedValue(opts.featured ?? FEATURED) };
  const communityGoal = { findFirst: jest.fn().mockResolvedValue('goal' in opts ? opts.goal : { id: 'g1' }) };
  const communityContribution = { findMany: jest.fn().mockResolvedValue(opts.contribs ?? []) };
  const prisma = { season, plantSpecies, communityGoal, communityContribution } as unknown as PrismaService;
  return { svc: new GameSeasonService(prisma), season, plantSpecies, communityGoal, communityContribution };
}

describe('GameSeasonService.getActiveSeason', () => {
  it('không có mùa đang diễn ra → null', async () => {
    const { svc } = setup({ season: null });
    expect(await svc.getActiveSeason()).toBeNull();
  });

  it('mùa đang diễn ra → trả mùa + loài nổi bật', async () => {
    const { svc, season } = setup();
    const r = await svc.getActiveSeason();
    expect(r?.name).toBe('Mùa Phủ Xanh Cần Giờ');
    expect(r?.featuredSpecies).toHaveLength(2);
    expect(r?.featuredSpecies[0]?.name).toBe('Cây Đước');
    // lọc theo cửa sổ thời gian (startAt ≤ now ≤ endAt)
    const where = season.findFirst.mock.calls[0][0].where;
    expect(where.startAt.lte).toBeInstanceOf(Date);
    expect(where.endAt.gte).toBeInstanceOf(Date);
  });

  it('mùa không có loài nổi bật → featuredSpecies rỗng, không query species', async () => {
    const { svc, plantSpecies } = setup({ season: { ...SEASON, featuredSpeciesIds: [] } });
    const r = await svc.getActiveSeason();
    expect(r?.featuredSpecies).toEqual([]);
    expect(plantSpecies.findMany).not.toHaveBeenCalled();
  });
});

describe('GameSeasonService.getSeasonLeaderboard', () => {
  it('không có mốc đang mở → []', async () => {
    const { svc } = setup({ goal: null });
    expect(await svc.getSeasonLeaderboard()).toEqual([]);
  });

  it('xếp hạng top người góp nước (ẩn tên)', async () => {
    const { svc } = setup({
      contribs: [
        { drops: 500, user: { fullName: 'Lã Hoàng Long' } },
        { drops: 300, user: { fullName: 'Nguyễn An' } },
        { drops: 100, user: { fullName: null } },
      ],
    });
    const r = await svc.getSeasonLeaderboard();
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ rank: 1, nickname: 'Long***', drops: 500 });
    expect(r[1]).toEqual({ rank: 2, nickname: 'An***', drops: 300 });
    expect(r[2]?.nickname).toBe('Bạn Tubu'); // tên null → mặc định
  });
});

// C-040: đặc tả che tên `maskName` (cùng bảng ca ở game, game-gift, game-season).
const MASK_NAME_CASES: [string, string | null, string][] = [
  ['null -> mặc định', null, 'Bạn Tubu'],
  ['rỗng -> mặc định', '', 'Bạn Tubu'],
  ['chỉ khoảng trắng -> mặc định', '   ', 'Bạn Tubu'],
  ['một từ', 'Long', 'Long***'],
  ['nhiều từ -> từ cuối', 'Lã Hoàng Long', 'Long***'],
  ['thừa khoảng trắng đầu/cuối', '  Nguyễn An  ', 'An***'],
  ['hai dấu cách liền nhau', 'Lã  Long', 'Long***'],
  ['tab giữa tên -> tách như dấu cách', 'Lã\tLong', 'Long***'],
  ['nbsp giữa tên -> tách như dấu cách', 'Lã\u00a0Long', 'Long***'],
  ['khoảng trắng rộng 0 -> tách, không lộ họ tên', 'Nguyễn\u200bThị\u200bLan', 'Lan***'],
  ['toàn emoji -> mặc định', '🌸🌸', 'Bạn Tubu'],
  ['chỉ có phần trong ngoặc -> mặc định', '(Mẹ Bin)', 'Bạn Tubu'],
  ['số điện thoại -> mặc định, không in số', '0912345678', 'Bạn Tubu'],
  ['email -> mặc định, không in địa chỉ', 'an@mail.com', 'Bạn Tubu'],
];

describe('GameSeasonService — che tên BXH (đặc tả maskName, C-040)', () => {
  it.each(MASK_NAME_CASES)('%s', async (_label, fullName, expected) => {
    const { svc } = setup({ contribs: [{ drops: 1, user: { fullName } }] });
    const r = await svc.getSeasonLeaderboard();
    expect(r[0]?.nickname).toBe(expected);
  });
});
