import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SystemConfigService } from './system-config.service';
import type { PrismaService } from '../../prisma/prisma.service';

const KEY = 'community.author_notify_interval_minutes';

// Khoá này gộp cả tin "câu hỏi của bạn có câu trả lời mới" (community-feed.service); 0 chỉ bỏ việc gộp tin đó, không tắt nó.
// Mô tả admin phải nói đúng điều đó, nếu không admin đặt 0 để tắt hết tin tương tác mà người hỏi vẫn nhận tin từng câu trả lời.
const NEW_ANSWER = /câu trả lời mới/;
const ZERO_KEEPS_ANSWERS = /vẫn gửi nhưng không gộp/;

describe(`${KEY}: mô tả cho admin`, () => {
  it('mô tả ở seed nhắc cả tin câu trả lời mới và nói 0 không tắt tin đó', () => {
    const seed = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf-8');
    const line = seed.split('\n').find((l) => l.includes(`key: '${KEY}'`));
    expect(line).toBeDefined();
    expect(line).toMatch(NEW_ANSWER);
    expect(line).toMatch(ZERO_KEEPS_ANSWERS);
  });

  it('ghi chú hiện khi admin nhập sai giá trị cũng nói như vậy', async () => {
    const prisma = { $transaction: jest.fn() } as unknown as PrismaService;
    const err = await new SystemConfigService(prisma).set(KEY, -1, 'admin-it').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(NEW_ANSWER);
    expect((err as Error).message).toMatch(ZERO_KEEPS_ANSWERS);
  });
});
