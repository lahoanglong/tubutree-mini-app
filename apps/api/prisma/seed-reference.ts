/**
 * Nạp dữ liệu THAM CHIẾU mà app cần để chạy (chủ đề cộng đồng, quiz, loài cây, mẫu thông báo, khoá cấu hình...) lên DB
 * thật ngay sau `prisma migrate deploy`. Prod không chạy `seed.ts` (seed.ts ghi đè sản phẩm, hạng
 * và khoá cấu hình, gồm tài khoản ngân hàng), nên phần này nằm ở đây:
 *
 *  - CREATE-ONLY: dòng đã có (theo khoá chính hoặc khoá duy nhất) thì bỏ qua, không bao giờ ghi đè chỉnh sửa của admin.
 *  - Idempotent và an toàn khi hai tiến trình chạy cùng lúc (INSERT ... ON CONFLICT DO NOTHING).
 *  - Không đụng sản phẩm, người dùng, mã giảm giá, đối tác cashback, tài khoản ngân hàng nhận tiền.
 *
 * Dữ liệu lấy từ các hằng số của seed.ts / seed-game-quiz.ts / reference-data, không chép lại.
 * Chạy: `npm run prisma:seed:reference` (trong apps/api). Thêm `--with-business-defaults` để nạp luôn hạng thành viên, bậc
 * đại lý, nhiệm vụ và 6 khoá có giá trị kinh doanh; chỉ dùng sau khi chủ dự án đã duyệt bảng giá trị (impl/refseed.md).
 */
import { PrismaClient } from '@prisma/client';
import {
  DEALER_TIERS,
  MISSIONS,
  NOTIFICATION_TEMPLATES,
  PLANT_SPECIES,
  SYSTEM_CONFIGS,
  TIERS,
} from './seed';
import { QUIZZES as NATURE_QUIZZES } from './seed-game-quiz';
import { COMMUNITY_GOAL_SEED, SEASON_SEED } from './reference-data/garden';
import { selectBusinessConfigs, selectReferenceConfigs } from './reference-data/config-selection';
import { COMMUNITY_CATEGORIES } from '../src/modules/feed/community-categories-seed';

export const WITH_BUSINESS_DEFAULTS_FLAG = '--with-business-defaults';

export const POINTS_1D_MIGRATION = '20261018210000_points_1d';

/**
 * Seed gieo `loyalty.vnd_per_point_redeem` = 1 (createOnly). Migration points_1d từng coi dòng đó là dấu "đã nhân 1.000", nên seed
 * chạy trước migrate làm phép nhân bị bỏ qua. Dấu giờ là dòng lịch sử của chính migration, nhưng vẫn từ chối seed khi migration chưa
 * hoàn tất để không dựng cấu hình theo đơn vị mới trên dữ liệu còn đơn vị cũ.
 */
export async function assertPoints1dApplied(prisma: Pick<PrismaClient, '$queryRaw'>): Promise<void> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "_prisma_migrations"
     WHERE "migration_name" = ${POINTS_1D_MIGRATION} AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
  if (rows[0]?.n !== 1) {
    throw new Error(
      `seed-reference: migration ${POINTS_1D_MIGRATION} chưa hoàn tất trên DB này. Chạy \`prisma migrate deploy\` trước (API đã dừng, đã backup), rồi mới seed-reference.`,
    );
  }
}

export interface SeedReferenceOptions {
  now?: Date;
  /**
   * Hạng thành viên, bậc đại lý, nhiệm vụ và 6 khoá cấu hình có giá trị kinh doanh khác mặc định trong mã. Chủ dự án chưa
   * quyết thì giữ hành vi như bảng trống, nên chỉ nạp sau khi đã duyệt bảng giá trị trong impl/refseed.md.
   */
  withBusinessDefaults?: boolean;
}

export interface GroupResult {
  group: string;
  /** Số dòng nằm trong dữ liệu của nhóm. */
  total: number;
  /** Số dòng vừa tạo; phần còn lại đã có sẵn nên được giữ nguyên. */
  created: number;
  note?: string;
  /** Nhóm giá trị kinh doanh chưa nạp vì không có cờ. */
  skipped?: boolean;
}

export async function seedReference(prisma: PrismaClient, options: SeedReferenceOptions = {}): Promise<GroupResult[]> {
  const { now = new Date(), withBusinessDefaults = false } = options;
  await assertPoints1dApplied(prisma);
  const results: GroupResult[] = [];
  const add = (group: string, total: number, created: number, note?: string) => results.push({ group, total, created, note });
  const strip = <T extends { createOnly?: boolean }>({ createOnly: _createOnly, ...row }: T) => row;

  const configs = selectReferenceConfigs(SYSTEM_CONFIGS).map(strip);
  add('system_configs', configs.length, (await prisma.systemConfig.createMany({ data: configs, skipDuplicates: true })).count);

  const businessConfigs = selectBusinessConfigs(SYSTEM_CONFIGS).map(strip);
  if (withBusinessDefaults) {
    add('business_configs', businessConfigs.length, (await prisma.systemConfig.createMany({ data: businessConfigs, skipDuplicates: true })).count);
    add('membership_tiers', TIERS.length, (await prisma.membershipTier.createMany({ data: TIERS, skipDuplicates: true })).count);
    add('dealer_tiers', DEALER_TIERS.length, (await prisma.dealerTier.createMany({ data: DEALER_TIERS, skipDuplicates: true })).count);
    add('missions', MISSIONS.length, (await prisma.mission.createMany({ data: MISSIONS, skipDuplicates: true })).count);
  } else {
    for (const [group, total] of [
      ['business_configs', businessConfigs.length],
      ['membership_tiers', TIERS.length],
      ['dealer_tiers', DEALER_TIERS.length],
      ['missions', MISSIONS.length],
    ] as const) {
      results.push({ group, total, created: 0, skipped: true });
    }
  }

  const templates = NOTIFICATION_TEMPLATES.map(strip);
  add('notification_templates', templates.length, (await prisma.notificationTemplate.createMany({ data: templates, skipDuplicates: true })).count);

  add(
    'community_categories',
    COMMUNITY_CATEGORIES.length,
    (await prisma.communityCategory.createMany({ data: COMMUNITY_CATEGORIES, skipDuplicates: true })).count,
  );

  const quizzes = NATURE_QUIZZES.map((q) => ({ ...q, rewardPts: 0 }));
  add('game_quizzes', quizzes.length, (await prisma.gameQuiz.createMany({ data: quizzes, skipDuplicates: true })).count);

  const species = PLANT_SPECIES.map((sp) => ({ ...sp }));
  add('plant_species', species.length, (await prisma.plantSpecies.createMany({ data: species, skipDuplicates: true })).count);

  // Mốc cộng đồng chỉ có một dòng ACTIVE tại một thời điểm: DB đã có mốc đang mở (hay chính mốc mẫu, kể cả đã chốt) thì giữ nguyên.
  const goalExists = (await prisma.communityGoal.count({ where: { OR: [{ id: COMMUNITY_GOAL_SEED.id }, { status: 'ACTIVE' }] } })) > 0;
  add(
    'community_goals',
    1,
    goalExists ? 0 : (await prisma.communityGoal.createMany({ data: [COMMUNITY_GOAL_SEED], skipDuplicates: true })).count,
    goalExists ? 'đã có mốc, giữ nguyên' : undefined,
  );

  // Mùa mẫu là mùa hè 2026; nạp một mùa đã hết hạn chỉ thêm dòng chết, nên chỉ nạp khi còn hạn.
  const seasonCurrent = SEASON_SEED.endAt > now;
  add(
    'seasons',
    1,
    seasonCurrent ? (await prisma.season.createMany({ data: [SEASON_SEED], skipDuplicates: true })).count : 0,
    seasonCurrent ? undefined : 'bỏ qua: mùa mẫu đã hết hạn, cần mùa mới do chủ dự án chốt',
  );

  return results;
}

export function formatResults(results: GroupResult[]): string[] {
  const lines = results
    .filter((r) => !r.skipped)
    .map((r) => {
      if (r.created === 0 && r.note) return `[seed-reference] ${r.group}: ${r.note}`;
      const detail = r.created === 0 ? `đủ sẵn (${r.total})` : `+${r.created} mới, ${r.total - r.created} đã có`;
      return `[seed-reference] ${r.group}: ${detail}`;
    });
  const skipped = results.filter((r) => r.skipped).map((r) => r.group);
  if (skipped.length > 0) {
    lines.push(`[seed-reference] chưa nạp (giá trị kinh doanh chờ chủ dự án duyệt): ${skipped.join(', ')}. Chạy lại với ${WITH_BUSINESS_DEFAULTS_FLAG} sau khi duyệt.`);
  }
  return lines;
}

/** Cờ gõ sai (vd `--with-business-default`) phải lỗi: lặng lẽ chạy không cờ làm người chạy tưởng đã nạp. */
export function parseArgs(argv: readonly string[]): SeedReferenceOptions {
  const flags = argv.filter((a) => a !== '--');
  const unknown = flags.filter((a) => a !== WITH_BUSINESS_DEFAULTS_FLAG);
  if (unknown.length > 0) throw new Error(`Tham số không hợp lệ: ${unknown.join(' ')}. Chỉ nhận ${WITH_BUSINESS_DEFAULTS_FLAG}.`);
  return { withBusinessDefaults: flags.includes(WITH_BUSINESS_DEFAULTS_FLAG) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    for (const line of formatResults(await seedReference(prisma, options))) console.log(line);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
