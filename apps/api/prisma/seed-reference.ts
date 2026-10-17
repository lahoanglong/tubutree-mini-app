/**
 * Nạp dữ liệu THAM CHIẾU mà app cần để chạy (chủ đề cộng đồng, quiz, nhiệm vụ, loài cây, mẫu thông báo, hạng thành viên,
 * khoá cấu hình...) lên DB thật ngay sau `prisma migrate deploy`. Prod không chạy `seed.ts` (seed.ts ghi đè sản phẩm, hạng
 * và khoá cấu hình, gồm tài khoản ngân hàng), nên phần này nằm ở đây:
 *
 *  - CREATE-ONLY: dòng đã có (theo khoá chính hoặc khoá duy nhất) thì bỏ qua, không bao giờ ghi đè chỉnh sửa của admin.
 *  - Idempotent và an toàn khi hai tiến trình chạy cùng lúc (INSERT ... ON CONFLICT DO NOTHING).
 *  - Không đụng sản phẩm, người dùng, mã giảm giá, đối tác cashback, tài khoản ngân hàng nhận tiền.
 *
 * Dữ liệu lấy từ các hằng số của seed.ts / seed-game-quiz.ts / reference-data, không chép lại.
 * Chạy: `npm run prisma:seed:reference` (trong apps/api).
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
import { selectReferenceConfigs } from './reference-data/config-selection';
import { COMMUNITY_CATEGORIES } from '../src/modules/feed/community-categories-seed';

export interface GroupResult {
  group: string;
  /** Số dòng nằm trong dữ liệu tham chiếu của nhóm. */
  total: number;
  /** Số dòng vừa tạo; phần còn lại đã có sẵn nên được giữ nguyên. */
  created: number;
  note?: string;
}

export async function seedReference(prisma: PrismaClient, now: Date = new Date()): Promise<GroupResult[]> {
  const results: GroupResult[] = [];
  const add = (group: string, total: number, created: number, note?: string) => results.push({ group, total, created, note });

  const configs = selectReferenceConfigs(SYSTEM_CONFIGS).map(({ createOnly: _createOnly, ...row }) => row);
  add('system_configs', configs.length, (await prisma.systemConfig.createMany({ data: configs, skipDuplicates: true })).count);

  add('membership_tiers', TIERS.length, (await prisma.membershipTier.createMany({ data: TIERS, skipDuplicates: true })).count);
  add('dealer_tiers', DEALER_TIERS.length, (await prisma.dealerTier.createMany({ data: DEALER_TIERS, skipDuplicates: true })).count);

  const templates = NOTIFICATION_TEMPLATES.map(({ createOnly: _createOnly, ...row }) => row);
  add('notification_templates', templates.length, (await prisma.notificationTemplate.createMany({ data: templates, skipDuplicates: true })).count);

  add(
    'community_categories',
    COMMUNITY_CATEGORIES.length,
    (await prisma.communityCategory.createMany({ data: COMMUNITY_CATEGORIES, skipDuplicates: true })).count,
  );

  const quizzes = NATURE_QUIZZES.map((q) => ({ ...q, rewardPts: 0 }));
  add('game_quizzes', quizzes.length, (await prisma.gameQuiz.createMany({ data: quizzes, skipDuplicates: true })).count);
  add('missions', MISSIONS.length, (await prisma.mission.createMany({ data: MISSIONS, skipDuplicates: true })).count);

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
  return results.map((r) => {
    if (r.created === 0 && r.note) return `[seed-reference] ${r.group}: ${r.note}`;
    const detail = r.created === 0 ? `đủ sẵn (${r.total})` : `+${r.created} mới, ${r.total - r.created} đã có`;
    return `[seed-reference] ${r.group}: ${detail}`;
  });
}

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const line of formatResults(await seedReference(prisma))) console.log(line);
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
