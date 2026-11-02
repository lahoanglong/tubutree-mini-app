import { PrismaClient } from '@prisma/client';
import { readApiSql, runSqlScriptIn } from './sql-script';

/**
 * R-112: migration bỏ emoji khỏi mẫu tin COMMUNITY_*. Chạy CHÍNH file migration.sql trên schema nháp (bảng dựng bằng
 * LIKE public.notification_templates) để bản admin đã sửa phải giữ nguyên và chạy lại không đổi gì.
 */
const SCHEMA = 'comm_tpl_noemoji';
const MIGRATION = readApiSql('prisma/migrations/20261102120000_community_templates_no_emoji/migration.sql');

const OLD_TO_NEW: Array<[code: string, oldBody: string, newBody: string]> = [
  ['COMMUNITY_EVENT_WINNER', '🏆 Chúc mừng! Bạn là người thắng sự kiện "{{title}}" của cộng đồng Tubu.{{reward}}', 'Chúc mừng! Bạn là người thắng sự kiện "{{title}}" của cộng đồng Tubu.{{reward}}'],
  ['COMMUNITY_NEW_ANSWER', '💬 {{author}} vừa trả lời câu hỏi "{{title}}" của bạn.', '{{author}} vừa trả lời câu hỏi "{{title}}" của bạn.'],
  ['COMMUNITY_EXPERT_REPLIED', '🌿 Chuyên gia Tubu vừa trả lời câu hỏi "{{title}}" của bạn.', 'Chuyên gia Tubu vừa trả lời câu hỏi "{{title}}" của bạn.'],
  ['COMMUNITY_BEST_ANSWER', 'Câu trả lời của bạn được chọn là hay nhất! 🌿{{reward_note}}', 'Câu trả lời của bạn được chọn là hay nhất!{{reward_note}}'],
  ['COMMUNITY_POST_APPROVED', '🌱 Bài viết của bạn đã được duyệt và hiển thị trong cộng đồng.', 'Bài viết của bạn đã được duyệt và hiển thị trong cộng đồng.'],
  [
    'COMMUNITY_POST_REJECTED',
    '🌿 Bài viết "{{title}}" của bạn chưa được đăng vì {{reason}}. Bạn có thể chỉnh lại nội dung rồi đăng bài mới nhé.',
    'Bài viết "{{title}}" của bạn chưa được đăng vì {{reason}}. Bạn có thể chỉnh lại nội dung rồi đăng bài mới nhé.',
  ],
  ['COMMUNITY_POST_LIKED', '💚 Bài viết "{{title}}" của bạn vừa được thả tim.', 'Bài viết "{{title}}" của bạn vừa được thả tim.'],
  ['COMMUNITY_POST_COMMENTED', '💬 {{author}} vừa bình luận bài viết "{{title}}" của bạn.', '{{author}} vừa bình luận bài viết "{{title}}" của bạn.'],
  [
    'COMMUNITY_POST_HIDDEN',
    '🌿 Bài viết "{{title}}" của bạn đã được ẩn khỏi cộng đồng vì {{reason}}. Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.',
    'Bài viết "{{title}}" của bạn đã được ẩn khỏi cộng đồng vì {{reason}}. Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.',
  ],
];

describe('migration bỏ emoji mẫu tin COMMUNITY_* (real Postgres)', () => {
  const prisma = new PrismaClient();
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql);
  const run = () => runSqlScriptIn(prisma, SCHEMA, MIGRATION);
  const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

  async function bodies(): Promise<Map<string, string>> {
    const rows = await prisma.$queryRawUnsafe<Array<{ code: string; bodyTemplate: string }>>(
      `SELECT "code", "bodyTemplate" FROM ${SCHEMA}.notification_templates`,
    );
    return new Map(rows.map((r) => [r.code, r.bodyTemplate]));
  }

  beforeEach(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await exec(`CREATE SCHEMA ${SCHEMA}`);
    await exec(`CREATE TABLE ${SCHEMA}.notification_templates (LIKE public.notification_templates INCLUDING ALL)`);
  });

  afterAll(async () => {
    await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  async function insert(code: string, body: string) {
    await exec(
      `INSERT INTO ${SCHEMA}.notification_templates ("id", "code", "channel", "bodyTemplate") VALUES (${lit(`id-${code}`)}, ${lit(code)}, 'INAPP', ${lit(body)})`,
    );
  }

  it('mẫu còn đúng bản mặc định cũ thì đổi sang bản không emoji', async () => {
    for (const [code, oldBody] of OLD_TO_NEW) await insert(code, oldBody);
    await run();
    const after = await bodies();
    for (const [code, , newBody] of OLD_TO_NEW) expect(after.get(code)).toBe(newBody);
  });

  it('mẫu admin đã sửa tay giữ nguyên, kể cả khi vẫn còn emoji', async () => {
    const edited = '🌿 Bài viết của bạn đã lên sóng, cảm ơn bạn!';
    for (const [code, oldBody] of OLD_TO_NEW) await insert(code, code === 'COMMUNITY_POST_APPROVED' ? edited : oldBody);
    await insert('SOME_OTHER_CODE', '🌿 Mẫu khác không đụng tới');
    await run();
    const after = await bodies();
    expect(after.get('COMMUNITY_POST_APPROVED')).toBe(edited);
    expect(after.get('SOME_OTHER_CODE')).toBe('🌿 Mẫu khác không đụng tới');
    expect(after.get('COMMUNITY_POST_LIKED')).toBe(OLD_TO_NEW.find(([c]) => c === 'COMMUNITY_POST_LIKED')![2]);
  });

  it('chạy lại không đổi gì; DB thiếu mẫu cũng không lỗi', async () => {
    await insert('COMMUNITY_POST_LIKED', OLD_TO_NEW.find(([c]) => c === 'COMMUNITY_POST_LIKED')![1]);
    await run();
    const first = await bodies();
    await run();
    expect(await bodies()).toEqual(first);
    expect(first.size).toBe(1);
  });
});
