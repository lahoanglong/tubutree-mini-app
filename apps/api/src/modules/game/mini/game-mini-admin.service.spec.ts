import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MINI_GAME_IDS, type MiniGameId, type MiniProductCard } from '@tubutree/shared-types';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';
import type { GameMiniContentService } from './game-mini-content.service';
import { GameMiniAdminService, MINI_CONTENT_KIND, MINI_EXPLANATION_MAX, type MiniContentCreateInput } from './game-mini-admin.service';
import { MINI_GAMES } from './games';

const SLUGS = ['gio-dung-1', 'gio-dung-2', 'gio-dung-3', 'gio-sai-1', 'gio-sai-2', 'gio-sai-3'];

const VALID: Record<MiniGameId, Record<string, unknown>> = {
  sort: { label: 'Chai nhựa', bin: 'recycle', emoji: '🍼' },
  daily_quiz: { prompt: 'Vỏ chuối bỏ vào thùng nào?', options: ['Rác hữu cơ', 'Rác tái chế', 'Rác khác'], answer: 0 },
  origin: { prompt: 'Cà phê Buôn Ma Thuột thuộc vùng nào?', options: ['Tây Nguyên', 'Tây Bắc'], answer: 0 },
  match: { ingredient: 'Baking soda', use: 'Khử mùi tủ lạnh' },
  basket: {
    task: 'Rửa bình sữa cho bé',
    correct: SLUGS.slice(0, 3),
    wrong: SLUGS.slice(3).map((slug) => ({ slug, reason: 'Nhãn ghi dùng để lau sàn.' })),
  },
  kitchen_swap: {
    corner: 'kitchen',
    item: 'Chai nước rửa chén 500 ml',
    emoji: '🧴',
    hidden: 'Mỗi chai mới là thêm một vỏ nhựa.',
    options: SLUGS.slice(0, 3).map((slug) => ({ slug, fact: 'Can 10L rót lại vào chai cũ.' })),
    answer: SLUGS[0],
  },
};
/** Mỗi payload sai theo cách khác nhau cho từng game: đủ để payloadError của game đó từ chối. */
const INVALID: Record<MiniGameId, Record<string, unknown>> = {
  sort: { label: 'Chai nhựa', bin: 'plastic' },
  daily_quiz: { prompt: 'Câu?', options: ['Chỉ một lựa chọn'], answer: 0 },
  origin: { prompt: 'Câu?', options: ['A', 'B'], answer: 5 },
  match: { ingredient: 'Baking soda' },
  basket: { task: 'Rửa bình sữa', correct: SLUGS.slice(0, 2), wrong: [] },
  kitchen_swap: { corner: 'kitchen', item: 'Chai nhựa', hidden: 'Vỏ nhựa', options: [{ slug: SLUGS[0], fact: 'Can 10L' }], answer: SLUGS[0] },
};
const GAME_NAME: Record<MiniGameId, string> = {
  sort: 'Đúng Thùng',
  daily_quiz: 'Đố Xanh',
  origin: 'Đoán Xuất Xứ',
  match: 'Ghép Cặp',
  basket: 'Giỏ Đúng Việc',
  kitchen_swap: 'Căn Bếp Xanh',
};

const input = (game: MiniGameId, over: Partial<MiniContentCreateInput> = {}): MiniContentCreateInput => ({
  game,
  payload: VALID[game],
  explanation: 'Vỏ chuối là rác hữu cơ, ủ phân được.',
  sourceUrl: 'https://nguon.example.vn/bai-viet',
  ...over,
});

const stored = (game: MiniGameId, over: Record<string, unknown> = {}) => ({
  id: 'item-1',
  game,
  kind: MINI_CONTENT_KIND[game],
  payload: VALID[game],
  explanation: 'Giải thích cũ',
  sourceUrl: 'https://nguon.example.vn/cu',
  sourceCheckedAt: null,
  productSlug: null,
  active: false,
  version: 3,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  ...over,
});

const card = (slug: string, inStock = true): MiniProductCard => ({ slug, name: slug, imageUrl: null, price: 50_000, inStock });

function makeSvc() {
  const prisma = {
    gameContentItem: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'item-1', version: 1, ...data })),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ ...stored('sort'), id: where.id, ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const content = { products: jest.fn().mockResolvedValue(new Map<string, MiniProductCard>()) };
  const svc = new GameMiniAdminService(prisma as unknown as PrismaService, {} as SystemConfigService, content as unknown as GameMiniContentService);
  return { svc, prisma, content };
}

const createdData = (m: ReturnType<typeof makeSvc>) => m.prisma.gameContentItem.create.mock.calls[0]![0].data as Record<string, unknown>;
const updatedData = (m: ReturnType<typeof makeSvc>) => m.prisma.gameContentItem.update.mock.calls[0]![0].data as Record<string, unknown>;

describe('GameMiniAdminService.create', () => {
  describe('sourceUrl', () => {
    it.each([
      ['http://nguon.example.vn/bai-viet'],
      ['HTTP://nguon.example.vn/bai-viet'],
      ['ftp://nguon.example.vn/bai-viet'],
      ['javascript:alert(1)'],
      ['nguon.example.vn/bai-viet'],
      ['abc'],
      ['https://'],
      ['https://localhost/bai-viet'],
      ['https://exa mple.vn/x'],
      [''],
      ['   '],
    ])('từ chối %j (400, không ghi DB)', async (sourceUrl) => {
      const m = makeSvc();
      await expect(m.svc.create(input('sort', { sourceUrl }))).rejects.toBeInstanceOf(BadRequestException);
      expect(m.prisma.gameContentItem.create).not.toHaveBeenCalled();
    });

    it('từ chối http:// bằng câu nói rõ cần https://, và chuỗi không phải URL bằng câu "chưa đúng dạng"', async () => {
      const m = makeSvc();
      await expect(m.svc.create(input('sort', { sourceUrl: 'http://nguon.example.vn/x' }))).rejects.toThrow('https://');
      await expect(m.svc.create(input('sort', { sourceUrl: 'khong phai url' }))).rejects.toThrow('chưa đúng dạng');
    });

    it('từ chối link dài quá 500 ký tự, nhận link dài đúng 500', async () => {
      const m = makeSvc();
      const prefix = 'https://nguon.example.vn/';
      await expect(m.svc.create(input('sort', { sourceUrl: prefix + 'a'.repeat(500 - prefix.length + 1) }))).rejects.toBeInstanceOf(BadRequestException);
      await expect(m.svc.create(input('sort', { sourceUrl: prefix + 'a'.repeat(500 - prefix.length) }))).resolves.toBeDefined();
    });

    it('nhận link https đầy đủ và lưu bản đã cắt khoảng trắng', async () => {
      const m = makeSvc();
      await m.svc.create(input('sort', { sourceUrl: '  https://nguon.example.vn/bai-viet?id=3  ' }));
      expect(createdData(m).sourceUrl).toBe('https://nguon.example.vn/bai-viet?id=3');
    });
  });

  describe('payload', () => {
    it.each(MINI_GAME_IDS)('%s: payload sai → 400 với đúng câu lỗi của game đó, không ghi DB', async (game) => {
      const m = makeSvc();
      const promise = m.svc.create(input(game, { payload: INVALID[game] }));
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(MINI_GAMES[game].payloadError(INVALID[game])!);
      await expect(m.svc.create(input(game, { payload: INVALID[game] }))).rejects.toThrow(GAME_NAME[game]);
      expect(m.prisma.gameContentItem.create).not.toHaveBeenCalled();
    });

    it.each([
      ['mảng', [VALID.sort]],
      ['chuỗi', 'Chai nhựa'],
      ['null', null],
      ['số', 5],
      ['undefined', undefined],
    ])('payload không phải đối tượng JSON (%s) → 400', async (_n, payload) => {
      const m = makeSvc();
      await expect(m.svc.create(input('sort', { payload }))).rejects.toThrow('đối tượng JSON');
      expect(m.prisma.gameContentItem.create).not.toHaveBeenCalled();
    });

    it('payload quá 4000 ký tự JSON → 400 dù đúng hình dạng game', async () => {
      const m = makeSvc();
      await expect(m.svc.create(input('sort', { payload: { ...VALID.sort, ghiChu: 'x'.repeat(4000) } }))).rejects.toThrow('quá dài');
      expect(m.prisma.gameContentItem.create).not.toHaveBeenCalled();
    });

    it.each(MINI_GAME_IDS)('%s: payload hợp lệ được lưu nguyên', async (game) => {
      const m = makeSvc();
      await m.svc.create(input(game));
      expect(createdData(m).payload).toEqual(VALID[game]);
    });
  });

  describe('kind, active và các trường khác', () => {
    it('bảng kind theo game đúng như cột kind của DB', () => {
      expect(MINI_CONTENT_KIND).toEqual({
        sort: 'sort_item',
        daily_quiz: 'quiz_question',
        match: 'match_pair',
        origin: 'origin_question',
        basket: 'basket_task',
        kitchen_swap: 'kitchen_swap_item',
      });
    });

    it.each(MINI_GAME_IDS)('%s: kind do máy chủ đặt theo game, admin gửi kind khác cũng bị bỏ qua', async (game) => {
      const m = makeSvc();
      await m.svc.create({ ...input(game), kind: 'admin_tu_dat' } as MiniContentCreateInput);
      expect(createdData(m).kind).toBe(MINI_CONTENT_KIND[game]);
      expect(createdData(m).game).toBe(game);
    });

    it('mục mới mặc định TẮT (active false); chỉ bật khi admin gửi active true', async () => {
      const m = makeSvc();
      await m.svc.create(input('sort'));
      expect(createdData(m).active).toBe(false);
      m.prisma.gameContentItem.create.mockClear();
      await m.svc.create(input('sort', { active: undefined }));
      expect(createdData(m).active).toBe(false);
      m.prisma.gameContentItem.create.mockClear();
      await m.svc.create(input('sort', { active: true }));
      expect(createdData(m).active).toBe(true);
    });

    it('chỉ ghi các trường đã kiểm: bỏ id, version và trường lạ admin cố gửi', async () => {
      const m = makeSvc();
      await m.svc.create({ ...input('sort'), id: 'tu-dat-id', version: 99, createdAt: 'x' } as unknown as MiniContentCreateInput);
      const data = createdData(m);
      expect(data).not.toHaveProperty('id');
      expect(data).not.toHaveProperty('version');
      expect(data).not.toHaveProperty('createdAt');
      expect(Object.keys(data).sort()).toEqual(['active', 'explanation', 'game', 'kind', 'payload', 'productSlug', 'sourceCheckedAt', 'sourceUrl']);
    });

    it.each([[''], ['   '], [undefined], [null]])('productSlug %j → lưu null', async (productSlug) => {
      const m = makeSvc();
      await m.svc.create(input('daily_quiz', { productSlug }));
      expect(createdData(m).productSlug).toBeNull();
    });

    it('productSlug hợp lệ được cắt khoảng trắng và lưu; slug sai dạng hoặc quá dài → 400', async () => {
      const m = makeSvc();
      await m.svc.create(input('daily_quiz', { productSlug: '  san-pham-a  ' }));
      expect(createdData(m).productSlug).toBe('san-pham-a');
      for (const bad of ['San-Pham', 'san pham', 'san_pham', '-san-pham', 'san-pham-', 'a'.repeat(161)]) {
        await expect(m.svc.create(input('daily_quiz', { productSlug: bad }))).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('explanation: cắt khoảng trắng; rỗng hoặc dài quá 220 ký tự → 400; đúng 220 thì nhận', async () => {
      const m = makeSvc();
      await m.svc.create(input('sort', { explanation: '  Lời giải thích  ' }));
      expect(createdData(m).explanation).toBe('Lời giải thích');
      await expect(m.svc.create(input('sort', { explanation: '' }))).rejects.toBeInstanceOf(BadRequestException);
      await expect(m.svc.create(input('sort', { explanation: '   ' }))).rejects.toBeInstanceOf(BadRequestException);
      await expect(m.svc.create(input('sort', { explanation: 'a'.repeat(MINI_EXPLANATION_MAX + 1) }))).rejects.toBeInstanceOf(BadRequestException);
      await expect(m.svc.create(input('sort', { explanation: 'a'.repeat(MINI_EXPLANATION_MAX) }))).resolves.toBeDefined();
    });

    it('sourceCheckedAt: YYYY-MM-DD thành nửa đêm UTC; rỗng hoặc null thành null; sai dạng → 400', async () => {
      const m = makeSvc();
      await m.svc.create(input('sort', { sourceCheckedAt: '2026-11-16' }));
      expect(createdData(m).sourceCheckedAt).toEqual(new Date('2026-11-16T00:00:00.000Z'));
      m.prisma.gameContentItem.create.mockClear();
      await m.svc.create(input('sort', { sourceCheckedAt: '' }));
      expect(createdData(m).sourceCheckedAt).toBeNull();
      for (const bad of ['16/11/2026', 'hôm qua', '2026-13-45']) {
        await expect(m.svc.create(input('sort', { sourceCheckedAt: bad }))).rejects.toBeInstanceOf(BadRequestException);
      }
    });
  });

  describe('kết quả trả về', () => {
    it('kèm payloadError null và usableToday theo luật của game', async () => {
      const m = makeSvc();
      const row = await m.svc.create(input('sort'));
      expect(row).toMatchObject({ id: 'item-1', game: 'sort', payloadError: null, usableToday: true });
    });

    it('đề Giỏ Đúng Việc: usableToday false khi sản phẩm chưa bán, true khi đủ 6 sản phẩm và 3 sản phẩm đúng còn hàng', async () => {
      const m = makeSvc();
      expect((await m.svc.create(input('basket'))).usableToday).toBe(false);
      m.content.products.mockResolvedValue(new Map(SLUGS.map((s) => [s, card(s)] as const)));
      expect((await m.svc.create(input('basket'))).usableToday).toBe(true);
      m.content.products.mockResolvedValue(new Map(SLUGS.map((s) => [s, card(s, s !== 'gio-dung-2')] as const)));
      expect((await m.svc.create(input('basket'))).usableToday).toBe(false);
    });
  });
});

describe('GameMiniAdminService.update', () => {
  it('id không có: 404 NotFoundException, không ghi DB', async () => {
    const m = makeSvc();
    m.prisma.gameContentItem.findUnique.mockResolvedValue(null);
    await expect(m.svc.update('khong-co', { explanation: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    expect(m.prisma.gameContentItem.update).not.toHaveBeenCalled();
  });

  describe('version', () => {
    it('đổi payload → version tăng 1, payload mới được lưu', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort'));
      const next = { label: 'Lon nhôm', bin: 'recycle' };
      await m.svc.update('item-1', { payload: next });
      expect(m.prisma.gameContentItem.update).toHaveBeenCalledTimes(1);
      expect(m.prisma.gameContentItem.update.mock.calls[0]![0].where).toEqual({ id: 'item-1' });
      expect(updatedData(m).payload).toEqual(next);
      expect(updatedData(m).version).toEqual({ increment: 1 });
    });

    it.each([
      ['explanation', { explanation: 'Giải thích mới' }],
      ['sourceUrl', { sourceUrl: 'https://nguon.example.vn/moi' }],
      ['productSlug', { productSlug: 'san-pham-moi' }],
      ['productSlug bỏ gắn (rỗng thành null)', { productSlug: '' }],
    ])('đổi %s cũng tăng version (nội dung ván đã phát đổi theo)', async (_n, patch) => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('daily_quiz'));
      await m.svc.update('item-1', patch);
      expect(updatedData(m).version).toEqual({ increment: 1 });
    });

    it('chỉ bật/tắt hoặc đổi ngày kiểm nguồn thì không tăng version', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort'));
      await m.svc.update('item-1', { active: true });
      expect(updatedData(m)).toEqual({ active: true });
      m.prisma.gameContentItem.update.mockClear();
      await m.svc.update('item-1', { sourceCheckedAt: '2026-11-17' });
      expect(updatedData(m)).toEqual({ sourceCheckedAt: new Date('2026-11-17T00:00:00.000Z') });
    });

    it('không gửi gì (input rỗng): không ghi DB, trả lại mục hiện tại', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort'));
      const row = await m.svc.update('item-1', {});
      expect(m.prisma.gameContentItem.update).not.toHaveBeenCalled();
      expect(row).toMatchObject({ id: 'item-1', version: 3, payloadError: null });
    });

    it('trường không gửi thì không bị ghi đè (cập nhật từng phần)', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort'));
      await m.svc.update('item-1', { explanation: 'Mới' });
      expect(Object.keys(updatedData(m)).sort()).toEqual(['explanation', 'version']);
    });
  });

  describe('bật mục', () => {
    it('bật mục có payload cũ sai (luật đã đổi sau khi nhập) → 400 với câu của game, không ghi DB', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort', { payload: INVALID.sort }));
      const promise = m.svc.update('item-1', { active: true });
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(MINI_GAMES.sort.payloadError(INVALID.sort)!);
      expect(m.prisma.gameContentItem.update).not.toHaveBeenCalled();
    });

    it.each(MINI_GAME_IDS)('%s: payload cũ sai thì không bật được, payload cũ đúng thì bật được', async (game) => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored(game, { payload: INVALID[game] }));
      await expect(m.svc.update('item-1', { active: true })).rejects.toThrow(GAME_NAME[game]);
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored(game));
      await expect(m.svc.update('item-1', { active: true })).resolves.toBeDefined();
    });

    it('payload cũ dạng không phải đối tượng (null) cũng không bật được', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort', { payload: null }));
      await expect(m.svc.update('item-1', { active: true })).rejects.toThrow('đối tượng JSON');
    });

    it('bật kèm payload mới hợp lệ thì được (payload cũ sai bị thay)', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort', { payload: INVALID.sort }));
      await m.svc.update('item-1', { active: true, payload: VALID.sort });
      expect(updatedData(m)).toMatchObject({ active: true, payload: VALID.sort, version: { increment: 1 } });
    });

    it('bật kèm payload mới vẫn sai thì 400', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort'));
      await expect(m.svc.update('item-1', { active: true, payload: INVALID.sort })).rejects.toBeInstanceOf(BadRequestException);
      expect(m.prisma.gameContentItem.update).not.toHaveBeenCalled();
    });

    it('tắt mục có payload cũ sai vẫn được (tắt không đòi payload hợp lệ)', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort', { payload: INVALID.sort, active: true }));
      await m.svc.update('item-1', { active: false });
      expect(updatedData(m)).toEqual({ active: false });
    });
  });

  describe('kiểm trường khi sửa', () => {
    it.each(MINI_GAME_IDS)('%s: sửa payload sai → 400 với câu của game', async (game) => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored(game));
      await expect(m.svc.update('item-1', { payload: INVALID[game] })).rejects.toThrow(GAME_NAME[game]);
      expect(m.prisma.gameContentItem.update).not.toHaveBeenCalled();
    });

    it('sửa sourceUrl thành http:// hoặc không phải URL → 400', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort'));
      await expect(m.svc.update('item-1', { sourceUrl: 'http://nguon.example.vn/x' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(m.svc.update('item-1', { sourceUrl: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
      expect(m.prisma.gameContentItem.update).not.toHaveBeenCalled();
    });

    it('sửa explanation rỗng hoặc quá dài, productSlug sai dạng → 400', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort'));
      await expect(m.svc.update('item-1', { explanation: ' ' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(m.svc.update('item-1', { explanation: 'a'.repeat(MINI_EXPLANATION_MAX + 1) })).rejects.toBeInstanceOf(BadRequestException);
      await expect(m.svc.update('item-1', { productSlug: 'Sai Slug' })).rejects.toBeInstanceOf(BadRequestException);
      expect(m.prisma.gameContentItem.update).not.toHaveBeenCalled();
    });

    it('mục thuộc game không còn tồn tại: 400 "Game của mục này không còn tồn tại"', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort', { game: 'arcade' }));
      await expect(m.svc.update('item-1', { explanation: 'x' })).rejects.toThrow('không còn tồn tại');
      expect(m.prisma.gameContentItem.update).not.toHaveBeenCalled();
    });

    it('kiểm trước khi ghi: một trường sai thì không trường nào được ghi', async () => {
      const m = makeSvc();
      m.prisma.gameContentItem.findUnique.mockResolvedValue(stored('sort'));
      await expect(m.svc.update('item-1', { explanation: 'Hợp lệ', sourceUrl: 'http://khong-an-toan.vn' })).rejects.toBeInstanceOf(BadRequestException);
      expect(m.prisma.gameContentItem.update).not.toHaveBeenCalled();
    });
  });
});

describe('GameMiniAdminService: nội dung Chọn Chuẩn Xanh (game = matcher)', () => {
  const TRIVIA = { prompt: 'Vết máu là vết gì?', options: ['Vết đạm', 'Vết dầu'], answer: 0 };
  const matcherRow = (over: Record<string, unknown> = {}) => ({ ...stored('sort'), game: 'matcher', kind: 'trivia', payload: TRIVIA, ...over });

  it('lọc danh sách theo game matcher; payloadError theo luật matcher', async () => {
    const m = makeSvc();
    m.prisma.gameContentItem.findMany.mockResolvedValue([matcherRow(), matcherRow({ id: 'item-2', payload: { prompt: 'x' } })]);
    m.prisma.gameContentItem.count.mockResolvedValue(2);
    const res = await m.svc.list({ game: 'matcher', page: 1, limit: 20 });
    expect(m.prisma.gameContentItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { game: 'matcher' } }));
    expect(res.data.map((r) => [r.payloadError === null, r.usableToday])).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  it('bật mục matcher hợp lệ được; payload hỏng thì 400, không ghi DB', async () => {
    const m = makeSvc();
    // Mock của makeSvc gõ `game` theo 5 game mini; dòng matcher là game thứ sáu nên ép kiểu ở đây.
    m.prisma.gameContentItem.update.mockImplementation((async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ ...matcherRow(), id: where.id, ...data })) as never);
    m.prisma.gameContentItem.findUnique.mockResolvedValue(matcherRow());
    await m.svc.update('item-1', { active: true });
    expect(updatedData(m)).toEqual({ active: true });

    const bad = makeSvc();
    bad.prisma.gameContentItem.findUnique.mockResolvedValue(matcherRow({ payload: { prompt: 'x', options: ['A'], answer: 0 } }));
    await expect(bad.svc.update('item-1', { active: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(bad.prisma.gameContentItem.update).not.toHaveBeenCalled();
  });

  it('sửa payload matcher theo đúng loại mục (câu đố không nhận payload của bộ kết quả)', async () => {
    const m = makeSvc();
    m.prisma.gameContentItem.findUnique.mockResolvedValue(matcherRow());
    await expect(m.svc.update('item-1', { payload: { code: 'x', title: 'Bộ', need: 'a', require: [], slots: [], fallbackCategory: 'c' } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(m.prisma.gameContentItem.update).not.toHaveBeenCalled();
  });
});
