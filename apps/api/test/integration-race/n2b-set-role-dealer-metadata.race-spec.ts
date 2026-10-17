import { partnerHarness } from './n2b-harness';
import { sleep } from './helpers';

/**
 * setUserRole → DEALER gộp dealerTierId vào metadata đọc bằng findUnique không khoá, nên một lần ghi metadata chen giữa (nhóm da từ
 * onboarding, mốc onboardedAt) bị ghi đè. Duyệt hồ sơ đã đọc dòng users FOR NO KEY UPDATE trước khi gộp; setUserRole làm giống vậy.
 */
describe('setUserRole DEALER không làm mất ghi metadata chen giữa (real Postgres)', () => {
  let h: Awaited<ReturnType<typeof partnerHarness>>;
  beforeAll(async () => {
    h = await partnerHarness();
  });
  afterAll(async () => {
    await h?.cleanup();
  });

  const metadataOf = async (id: string) => (await h.prisma.user.findUniqueOrThrow({ where: { id } })).metadata as Record<string, unknown>;

  it('ghi metadata (segments) landed giữa lúc đọc và lúc cập nhật vẫn còn sau khi cấp DEALER, cùng dealerTierId', async () => {
    const adminUser = await h.user('ADMIN');
    const target = await h.user('CUSTOMER', { metadata: { onboardedAt: '2026-01-01T00:00:00.000Z' } });
    const tier = await h.tier();

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const writer = h.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${target.id} FOR NO KEY UPDATE`;
        await held;
        await tx.user.update({ where: { id: target.id }, data: { metadata: { onboardedAt: '2026-01-01T00:00:00.000Z', segments: ['mom_baby'] } } });
      },
      { timeout: 30_000 },
    );
    await sleep(100);
    const granting = h.admin.setUserRole(adminUser.id, target.phone!, 'DEALER', tier.id);
    await sleep(400);
    release();
    await writer;
    await expect(granting).resolves.toMatchObject({ role: 'DEALER', previousRole: 'CUSTOMER' });

    expect(await metadataOf(target.id)).toEqual({ onboardedAt: '2026-01-01T00:00:00.000Z', segments: ['mom_baby'], dealerTierId: tier.id });
  });

  it('không có ghi chen: metadata cũ được giữ, dealerTierId được thêm; không có tier (vai trò khác) không đụng metadata', async () => {
    const adminUser = await h.user('ADMIN');
    const target = await h.user('AFFILIATE', { metadata: { segments: ['skin'] } });
    const tier = await h.tier();
    await h.admin.setUserRole(adminUser.id, target.phone!, 'DEALER', tier.id);
    expect(await metadataOf(target.id)).toEqual({ segments: ['skin'], dealerTierId: tier.id });
    await h.admin.setUserRole(adminUser.id, target.phone!, 'CUSTOMER');
    expect(await metadataOf(target.id)).toEqual({ segments: ['skin'], dealerTierId: tier.id });
  });
});
