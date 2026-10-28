import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AdminGameQuizController, CreateQuizDto, UpdateQuizDto } from './admin-game-quiz.controller';
import { GameQuizService } from '../game/game-quiz.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const opts = { whitelist: true, forbidNonWhitelisted: true };
const valid = { question: ' Cây xanh hấp thụ khí nào? ', options: [' CO₂ ', 'O₂', 'N₂'], correct: 0, category: 'cay', difficulty: 2 };

type Row = { id: string; question: string; options: unknown; correct: number; rewardPts: number; category: string; difficulty: number; explanation: string | null; waterReward: number };

/** Bảng câu đố trong bộ nhớ, đủ cho các lời gọi của dịch vụ (count, findMany có skip/take, findUnique, create, update). */
function memory(seed: Row[] = []) {
  const rows = [...seed];
  const sorted = () => [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
  const gameQuiz = {
    count: jest.fn(async () => rows.length),
    findMany: jest.fn(async ({ skip = 0, take }: { skip?: number; take?: number } = {}) => sorted().slice(skip, take === undefined ? undefined : skip + take)),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null),
    create: jest.fn(async ({ data }: { data: Row }) => {
      rows.push(data);
      return data;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
  };
  const prisma = { gameQuiz, gameQuizAttempt: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService;
  const config = { get: async <T>(_k: string, fb?: T) => fb as T } as unknown as SystemConfigService;
  const svc = new GameQuizService(prisma, config);
  return { rows, gameQuiz, svc, controller: new AdminGameQuizController(svc) };
}
const seedRow = (id: string, over: Partial<Row> = {}): Row => ({ id, question: `Câu ${id}?`, options: ['A', 'B'], correct: 0, rewardPts: 0, category: 'cay', difficulty: 1, explanation: null, waterReward: 8, ...over });

describe('Câu đố Vườn Xanh (admin)', () => {
  it('chỉ ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminGameQuizController)).toEqual(['ADMIN']);
  });

  it('CreateQuizDto: câu hợp lệ được cắt khoảng trắng; thiếu đáp án, quá nhiều đáp án, độ khó/nhóm lạ, trường thưởng đều bị từ chối', () => {
    const ok = plainToInstance(CreateQuizDto, valid);
    expect(validateSync(ok, opts)).toEqual([]);
    expect(ok.question).toBe('Cây xanh hấp thụ khí nào?');
    expect(ok.options).toEqual(['CO₂', 'O₂', 'N₂']);
    const bad: Record<string, unknown>[] = [
      { ...valid, question: '   ' },
      { ...valid, options: ['Chỉ một'] },
      { ...valid, options: ['a', 'b', 'c', 'd', 'e'] },
      { ...valid, options: ['a', ''] },
      { ...valid, options: 'a,b' },
      { ...valid, correct: -1 },
      { ...valid, correct: 1.5 },
      { ...valid, difficulty: 4 },
      { ...valid, difficulty: 0 },
      { ...valid, category: 'la' },
      { ...valid, waterReward: 99 },
      { ...valid, rewardPts: 50 },
      { ...valid, id: 'hack' },
    ];
    for (const b of bad) expect(validateSync(plainToInstance(CreateQuizDto, b), opts).length).toBeGreaterThan(0);
  });

  it('UpdateQuizDto: bỏ trường là giữ nguyên, null cho câu hỏi/đáp án/độ khó bị chặn, giải thích rỗng là xoá', () => {
    expect(validateSync(plainToInstance(UpdateQuizDto, {}), opts)).toEqual([]);
    for (const k of ['question', 'options', 'correct', 'category', 'difficulty']) {
      expect(validateSync(plainToInstance(UpdateQuizDto, { [k]: null }), opts).length).toBeGreaterThan(0);
    }
    expect(validateSync(plainToInstance(UpdateQuizDto, { explanation: '' }), opts)).toEqual([]);
    expect(validateSync(plainToInstance(UpdateQuizDto, { waterReward: 99 }), opts).length).toBeGreaterThan(0);
  });

  it('tạo câu: waterReward theo độ khó 8/10/12, rewardPts 0, id riêng, đủ trường như câu seed', async () => {
    const { controller, rows } = memory();
    for (const [difficulty, water] of [[1, 8], [2, 10], [3, 12]] as const) {
      const made = await controller.create(plainToInstance(CreateQuizDto, { ...valid, difficulty, explanation: ' Vì quang hợp. ' }));
      expect(made).toMatchObject({ question: 'Cây xanh hấp thụ khí nào?', options: ['CO₂', 'O₂', 'N₂'], correct: 0, category: 'cay', difficulty, waterReward: water, explanation: 'Vì quang hợp.' });
    }
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(rows.every((r) => r.rewardPts === 0 && r.id.startsWith('nq_'))).toBe(true);
  });

  it('đáp án đúng ngoài danh sách → 400; đáp án trùng nhau → 400; không ghi gì', async () => {
    const { controller, gameQuiz } = memory();
    await expect(controller.create(plainToInstance(CreateQuizDto, { ...valid, correct: 3 }))).rejects.toThrow(/Đáp án đúng/);
    await expect(controller.create(plainToInstance(CreateQuizDto, { ...valid, options: ['A', 'a', 'B'] }))).rejects.toBeInstanceOf(BadRequestException);
    expect(gameQuiz.create).not.toHaveBeenCalled();
  });

  it('sửa: đổi độ khó thì waterReward theo độ khó mới; chỉ đổi đáp án đúng thì kiểm theo danh sách đang có; câu không có → 404', async () => {
    const { controller, rows } = memory([seedRow('nq_cay_1', { options: ['A', 'B', 'C'], waterReward: 8 })]);
    await controller.update('nq_cay_1', plainToInstance(UpdateQuizDto, { difficulty: 3 }));
    expect(rows[0]).toMatchObject({ difficulty: 3, waterReward: 12, rewardPts: 0 });
    await expect(controller.update('nq_cay_1', plainToInstance(UpdateQuizDto, { correct: 5 }))).rejects.toBeInstanceOf(BadRequestException);
    await controller.update('nq_cay_1', plainToInstance(UpdateQuizDto, { correct: 2 }));
    expect(rows[0]!.correct).toBe(2);
    await expect(controller.update('nq_cay_1', plainToInstance(UpdateQuizDto, { options: ['A', 'B'] }))).rejects.toThrow(/Đáp án đúng/);
    await expect(controller.update('khong-co', plainToInstance(UpdateQuizDto, { question: 'x' }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sửa giải thích rỗng thì xoá giải thích', async () => {
    const { controller, rows } = memory([seedRow('nq_cay_1', { explanation: 'Cũ' })]);
    await controller.update('nq_cay_1', plainToInstance(UpdateQuizDto, { explanation: '  ' }));
    expect(rows[0]!.explanation).toBeNull();
  });

  it('danh sách phân trang theo thứ tự id, kèm tổng; đáp án luôn là mảng chữ', async () => {
    const { controller } = memory([seedRow('nq_b'), seedRow('nq_a', { options: ['X', 'Y'] }), seedRow('nq_c')]);
    const page = await controller.list({ page: 1, limit: 2 });
    expect(page.meta).toEqual({ page: 1, limit: 2, total: 3 });
    expect(page.data.map((q) => q.id)).toEqual(['nq_a', 'nq_b']);
    expect(page.data[0]).toMatchObject({ options: ['X', 'Y'], correct: 0, waterReward: 8 });
    const last = await controller.list({ page: 2, limit: 2 });
    expect(last.data.map((q) => q.id)).toEqual(['nq_c']);
  });

  it('câu mới vào vòng xoay hằng ngày như câu seed: đủ vài ngày thì bộ câu của khách có cả câu vừa tạo', async () => {
    const { controller, svc, rows } = memory(['nq_cay_1', 'nq_cay_2', 'nq_dat_1', 'nq_nuoc_1', 'nq_tai_che_1'].map((id) => seedRow(id)));
    const made = await controller.create(plainToInstance(CreateQuizDto, valid));
    expect(rows).toHaveLength(6);
    const served = new Set<string>();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask'] });
    try {
      const ensure = jest.spyOn(svc as unknown as { ensure: (u: string) => Promise<unknown> }, 'ensure').mockResolvedValue(undefined);
      for (let day = 0; day < 6; day++) {
        jest.setSystemTime(new Date(Date.UTC(2026, 10, 2 + day, 5, 0, 0)));
        for (const q of await svc.getTodayQuiz('u1')) served.add(q.id);
      }
      ensure.mockRestore();
    } finally {
      jest.useRealTimers();
    }
    expect(served.has((made as { id: string }).id)).toBe(true);
    expect(served.size).toBe(6);
  });
});
