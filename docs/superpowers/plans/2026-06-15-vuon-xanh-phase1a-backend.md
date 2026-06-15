# Vườn Xanh 2.0 — Phase 1A (Backend foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển game sang kinh tế "tách tiền tệ" — quiz thiên nhiên (chủ đề/độ khó/giải thích) sinh 💧, daily action thưởng 💧 (không mint điểm Xanh), thêm vé giữ lửa (streak-freeze) và giọt sương sáng (dew); tất cả có unit test.

**Architecture:** Tách logic mới khỏi `GameService` 376 dòng thành 2 service thuần, dễ test: `GameEconomyService` (check-in/💧/streak/streak-freeze/dew) và `GameQuizService` (quiz theo chủ đề + thưởng 💧 + giải thích). Controller gọi service mới; service cũ giữ tree/spin/missions (Phase 2 đụng tiếp). Tiền tệ thao tác atomic, daily action idempotent theo `dayKey`.

**Tech Stack:** NestJS + Prisma (Postgres) + Jest. Config qua `SystemConfigService`. Test theo mẫu mock thuần trong `game.service.spec.ts`.

**Spec:** [docs/superpowers/specs/2026-06-15-vuon-xanh-game-retention-design.md](../specs/2026-06-15-vuon-xanh-game-retention-design.md) — Phase 1.

---

## File Structure

- `apps/api/prisma/schema.prisma` — thêm field `GameQuiz` (category/difficulty/explanation/waterReward), `GameProfile` (streakFreezes/lastDewAt).
- `apps/api/prisma/migrations/<ts>_game_phase1/migration.sql` — migration.
- `apps/api/src/modules/game/game-economy.service.ts` *(mới)* — check-in (💧), streak + streak-freeze, dew, buy-freeze.
- `apps/api/src/modules/game/game-economy.service.spec.ts` *(mới)* — unit test.
- `apps/api/src/modules/game/game-quiz.service.ts` *(mới)* — getTodayQuiz theo category/difficulty, answerQuiz (💧 + explanation).
- `apps/api/src/modules/game/game-quiz.service.spec.ts` *(mới)* — unit test.
- `apps/api/src/modules/game/game.service.ts` — bỏ `checkIn`, `getTodayQuiz`, `answerQuiz` (chuyển sang service mới); giữ helper dùng chung bằng cách export.
- `apps/api/src/modules/game/game.controller.ts` — inject service mới + endpoint `dew/collect`, `streak-freeze/buy`.
- `apps/api/src/modules/game/game.module.ts` — providers.
- `apps/api/prisma/seed-game-quiz.ts` *(mới)* — seed ~40 câu thiên nhiên; gọi trong `prisma/seed.ts`.
- `packages/shared-types` — không bắt buộc (FE tự khai báo ở 1B); BE trả shape mới.

> Lưu ý refactor an toàn: di chuyển code theo "copy → test xanh → xoá bản cũ → đổi controller" để không gãy giữa chừng.

---

## Task 1: Schema + migration + prisma generate

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `GameQuiz`, `GameProfile`)
- Create: `apps/api/prisma/migrations/20260615130000_game_phase1/migration.sql`

- [ ] **Step 1: Sửa schema** — thêm field vào `GameQuiz` và `GameProfile`:

```prisma
model GameQuiz {
  id          String  @id
  question    String
  options     Json
  correct     Int
  rewardPts   Int
  brand       String?
  category    String  @default("nature")
  difficulty  Int     @default(1)
  explanation String?
  waterReward Int     @default(8)

  @@map("game_quizzes")
}
```

```prisma
model GameProfile {
  // ...giữ nguyên các field hiện có...
  badges        String[]  @default([])
  lastWateredAt DateTime?
  streakFreezes Int       @default(0)
  lastDewAt     DateTime?

  @@map("game_profiles")
}
```

- [ ] **Step 2: Tạo migration SQL thủ công** (tránh `migrate dev` đụng EPERM engine):

```sql
-- game_phase1: quiz theo chủ đề + thưởng 💧, streak-freeze, dew
ALTER TABLE "game_quizzes" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'nature';
ALTER TABLE "game_quizzes" ADD COLUMN "difficulty" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "game_quizzes" ADD COLUMN "explanation" TEXT;
ALTER TABLE "game_quizzes" ADD COLUMN "waterReward" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "game_profiles" ADD COLUMN "streakFreezes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "game_profiles" ADD COLUMN "lastDewAt" TIMESTAMP(3);
```

- [ ] **Step 3: Generate client** (types, không cần DB):

Run: `cd apps/api && pnpm prisma:generate`
Expected: client cập nhật (nếu EPERM do server đang chạy → bỏ qua, types vẫn sinh; restart server sau).

- [ ] **Step 4: Apply migration vào DB dev:**

Run: `cd apps/api && pnpm prisma:migrate deploy`
Expected: "Your database is now in sync" + migration `20260615130000_game_phase1` applied.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260615130000_game_phase1
git commit -m "feat(game): schema phase1 — quiz category/difficulty/explanation/waterReward + streakFreezes/lastDewAt"
```

---

## Task 2: GameEconomyService — check-in 💧 + streak-freeze + dew (TDD)

**Files:**
- Create: `apps/api/src/modules/game/game-economy.service.ts`
- Test: `apps/api/src/modules/game/game-economy.service.spec.ts`

Mô tả hành vi:
- `checkIn(userId)`: 1 lần/ngày (dayKey, idempotent). Streak: liên tiếp +1; nếu **lỡ đúng 1 ngày** và `streakFreezes > 0` → tiêu 1 freeze, streak vẫn +1 (giữ lửa); lỡ >1 ngày hoặc hết freeze → streak = 1. Thưởng **💧** (`game.daily_login_seeds`, default 10) + bonus chuỗi 3/7; **KHÔNG** cộng điểm Xanh. Cap `game.tank_capacity` (nâng default 500).
- `collectDew(userId)`: 1 lần/ngày → +`game.dew_seeds` (default 15) 💧 (cap), set `lastDewAt`. Lần 2 trong ngày → BadRequest.
- `buyStreakFreeze(userId)`: trừ `game.streak_freeze_cost` (default 80) 💧 **atomic** (updateMany gte), +1 `streakFreezes`. Không đủ → BadRequest.

- [ ] **Step 1: Viết test thất bại** — tạo file với mock theo mẫu spec hiện có:

```ts
import { BadRequestException } from '@nestjs/common';
import { GameEconomyService } from './game-economy.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const DAY = 24 * 3600 * 1000;
function cfg(over: Record<string, unknown> = {}): SystemConfigService {
  return { get: async <T>(k: string, fb?: T): Promise<T> => (k in over ? (over[k] as T) : (fb as T)) } as unknown as SystemConfigService;
}
function prisma(profile: Record<string, unknown> | null, over: Record<string, unknown> = {}) {
  const base = {
    gameProfile: {
      findUnique: jest.fn().mockResolvedValue(profile),
      create: jest.fn().mockResolvedValue(profile),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { ...base, ...over } as unknown as PrismaService;
}
function prof(extra: Record<string, unknown> = {}) {
  return { userId: 'u1', totalSeeds: 100, streakDays: 2, longestStreak: 5, streakFreezes: 0,
    lastCheckInAt: new Date(Date.now() - DAY), lastDewAt: null, ecoImpact: {}, ...extra };
}

describe('GameEconomyService.checkIn', () => {
  it('chuỗi liên tiếp +1 và thưởng 💧, KHÔNG cộng điểm Xanh', async () => {
    const p = prisma(prof());
    const svc = new GameEconomyService(p, cfg({ 'game.daily_login_seeds': 10 }));
    const r = await svc.checkIn('u1');
    expect(r.streakDays).toBe(3);
    expect(r.seedsEarned).toBe(10);
    expect(r.pointsEarned).toBe(0);
    // không gọi bảng điểm
    expect((p as any).pointsTransaction).toBeUndefined();
  });

  it('chặn điểm danh 2 lần/ngày', async () => {
    const svc = new GameEconomyService(prisma(prof({ lastCheckInAt: new Date() })), cfg());
    await expect(svc.checkIn('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lỡ 1 ngày + có vé giữ lửa → tiêu 1 vé, streak vẫn +1', async () => {
    const p = prisma(prof({ streakDays: 4, streakFreezes: 1, lastCheckInAt: new Date(Date.now() - 2 * DAY) }));
    const svc = new GameEconomyService(p, cfg());
    const r = await svc.checkIn('u1');
    expect(r.streakDays).toBe(5);
    expect(r.streakFrozeUsed).toBe(true);
    const upd = (p.gameProfile.update as jest.Mock).mock.calls[0][0].data;
    expect(upd.streakFreezes).toBe(0);
  });

  it('lỡ 1 ngày + hết vé → reset streak = 1', async () => {
    const p = prisma(prof({ streakDays: 4, streakFreezes: 0, lastCheckInAt: new Date(Date.now() - 2 * DAY) }));
    const r = await new GameEconomyService(p, cfg()).checkIn('u1');
    expect(r.streakDays).toBe(1);
    expect(r.streakFrozeUsed).toBe(false);
  });
});

describe('GameEconomyService.collectDew', () => {
  it('lần đầu trong ngày → +💧 và set lastDewAt', async () => {
    const p = prisma(prof({ lastDewAt: null }));
    const r = await new GameEconomyService(p, cfg({ 'game.dew_seeds': 15 })).collectDew('u1');
    expect(r.seedsEarned).toBe(15);
  });
  it('lần 2 trong ngày → BadRequest', async () => {
    const p = prisma(prof({ lastDewAt: new Date() }));
    await expect(new GameEconomyService(p, cfg()).collectDew('u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GameEconomyService.buyStreakFreeze', () => {
  it('đủ 💧 → trừ atomic, +1 vé', async () => {
    const p = prisma(prof({ totalSeeds: 200 }));
    (p.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const r = await new GameEconomyService(p, cfg({ 'game.streak_freeze_cost': 80 })).buyStreakFreeze('u1');
    expect(r.streakFreezes).toBeGreaterThanOrEqual(1);
  });
  it('không đủ 💧 → BadRequest', async () => {
    const p = prisma(prof({ totalSeeds: 10 }));
    (p.gameProfile.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(new GameEconomyService(p, cfg({ 'game.streak_freeze_cost': 80 })).buyStreakFreeze('u1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Chạy test — phải FAIL**

Run: `cd apps/api && pnpm test -- game-economy`
Expected: FAIL ("Cannot find module './game-economy.service'").

- [ ] **Step 3: Viết implementation tối thiểu:**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

const DAY = 864e5;

@Injectable()
export class GameEconomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  private dayKey(d: Date): string {
    return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }

  private async ensure(userId: string) {
    const target = await this.config.get<number>('game.tree_default_target', 600);
    const existing = await this.prisma.gameProfile.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.gameProfile.create({
      data: { userId, ecoImpact: { progress: 0, target, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 } as object },
    });
  }

  async checkIn(userId: string) {
    const p = await this.ensure(userId);
    const today = this.dayKey(new Date());
    if (p.lastCheckInAt && this.dayKey(p.lastCheckInAt) === today) {
      throw new BadRequestException('Hôm nay bạn đã điểm danh rồi 🌿');
    }
    const yesterday = this.dayKey(new Date(Date.now() - DAY));
    const consecutive = p.lastCheckInAt && this.dayKey(p.lastCheckInAt) === yesterday;

    let streakDays: number;
    let streakFreezes = p.streakFreezes;
    let streakFrozeUsed = false;
    if (consecutive) {
      streakDays = p.streakDays + 1;
    } else if (p.lastCheckInAt && p.streakFreezes > 0) {
      // lỡ ngày nhưng có vé giữ lửa → tiêu 1 vé, giữ chuỗi
      streakDays = p.streakDays + 1;
      streakFreezes = p.streakFreezes - 1;
      streakFrozeUsed = true;
    } else {
      streakDays = 1;
    }

    const loginSeeds = await this.config.get<number>('game.daily_login_seeds', 10);
    const tankCap = await this.config.get<number>('game.tank_capacity', 500);
    let seeds = loginSeeds;
    let bonusNote = '';
    if (streakDays % 7 === 0) {
      const bonus = await this.config.get<{ seeds: number }>('game.streak_7_bonus', { seeds: 20 });
      seeds += bonus.seeds ?? 20;
      bonusNote = `+${bonus.seeds ?? 20} 💧 chuỗi 7 ngày!`;
    } else if (streakDays % 3 === 0) {
      seeds += 5;
      bonusNote = '+5 💧 chuỗi 3 ngày!';
    }
    const totalSeeds = Math.min(tankCap, p.totalSeeds + seeds);
    await this.prisma.gameProfile.update({
      where: { userId },
      data: {
        totalSeeds,
        streakDays,
        streakFreezes,
        longestStreak: Math.max(p.longestStreak, streakDays),
        lastCheckInAt: new Date(),
      },
    });
    return { seedsEarned: seeds, pointsEarned: 0, streakDays, totalSeeds, streakFrozeUsed, bonusNote };
  }

  async collectDew(userId: string) {
    const p = await this.ensure(userId);
    if (p.lastDewAt && this.dayKey(p.lastDewAt) === this.dayKey(new Date())) {
      throw new BadRequestException('Hôm nay bạn đã hứng giọt sương rồi 🌿');
    }
    const dew = await this.config.get<number>('game.dew_seeds', 15);
    const tankCap = await this.config.get<number>('game.tank_capacity', 500);
    const totalSeeds = Math.min(tankCap, p.totalSeeds + dew);
    await this.prisma.gameProfile.update({ where: { userId }, data: { totalSeeds, lastDewAt: new Date() } });
    return { seedsEarned: dew, totalSeeds };
  }

  async buyStreakFreeze(userId: string) {
    await this.ensure(userId);
    const cost = await this.config.get<number>('game.streak_freeze_cost', 80);
    const dec = await this.prisma.gameProfile.updateMany({
      where: { userId, totalSeeds: { gte: cost } },
      data: { totalSeeds: { decrement: cost }, streakFreezes: { increment: 1 } },
    });
    if (dec.count === 0) throw new BadRequestException(`Cần ${cost} 💧 để mua vé giữ lửa.`);
    const p = await this.prisma.gameProfile.findUnique({ where: { userId } });
    return { streakFreezes: p?.streakFreezes ?? 1, totalSeeds: p?.totalSeeds ?? 0 };
  }
}
```

- [ ] **Step 4: Chạy test — phải PASS**

Run: `cd apps/api && pnpm test -- game-economy`
Expected: PASS (tất cả describe).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/game/game-economy.service.ts apps/api/src/modules/game/game-economy.service.spec.ts
git commit -m "feat(game): GameEconomyService — check-in 💧 (bỏ điểm Xanh) + vé giữ lửa + giọt sương (TDD)"
```

---

## Task 3: GameQuizService — quiz thiên nhiên → 💧 + giải thích (TDD)

**Files:**
- Create: `apps/api/src/modules/game/game-quiz.service.ts`
- Test: `apps/api/src/modules/game/game-quiz.service.spec.ts`

Hành vi:
- `getTodayQuiz(userId)`: trả tối đa `game.quiz_daily_count` (default 5) câu CHƯA trả lời hôm nay; **ẩn `correct` và `explanation`**; kèm `category`, `difficulty`, `waterReward`.
- `answerQuiz(userId, quizId, choice)`: chặn trả lời lại trong ngày; đúng → cộng **💧** (`waterReward` của câu, cap tank), sai → 0; **trả `explanation` + `correct` + `waterEarned`** để FE hiện "Bạn có biết".

- [ ] **Step 1: Viết test thất bại:**

```ts
import { BadRequestException } from '@nestjs/common';
import { GameQuizService } from './game-quiz.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

function cfg(over: Record<string, unknown> = {}): SystemConfigService {
  return { get: async <T>(k: string, fb?: T): Promise<T> => (k in over ? (over[k] as T) : (fb as T)) } as unknown as SystemConfigService;
}
const QUIZ = { id: 'q1', question: 'Rừng ngập mặn hấp thụ CO₂ ra sao?', options: ['Ít hơn', 'Gấp ~4 lần'], correct: 1,
  rewardPts: 0, category: 'water', difficulty: 2, explanation: 'Rừng ngập mặn hấp thụ CO₂ gấp ~4 lần rừng thường.', waterReward: 12 };

function prisma(over: Record<string, unknown> = {}) {
  const base = {
    gameProfile: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1', totalSeeds: 50 }), update: jest.fn().mockResolvedValue({}) },
    gameQuiz: { findUnique: jest.fn().mockResolvedValue(QUIZ), findMany: jest.fn().mockResolvedValue([QUIZ]) },
    gameQuizAttempt: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
  };
  return { ...base, ...over } as unknown as PrismaService;
}

describe('GameQuizService', () => {
  it('getTodayQuiz ẩn correct + explanation, kèm category/waterReward', async () => {
    const list = await new GameQuizService(prisma(), cfg()).getTodayQuiz('u1');
    expect(list[0]).toEqual({ id: 'q1', question: QUIZ.question, options: QUIZ.options, category: 'water', difficulty: 2, waterReward: 12 });
    expect((list[0] as any).correct).toBeUndefined();
    expect((list[0] as any).explanation).toBeUndefined();
  });

  it('answer đúng → cộng 💧 = waterReward, trả explanation', async () => {
    const p = prisma();
    const r = await new GameQuizService(p, cfg()).answerQuiz('u1', 'q1', 1);
    expect(r.isCorrect).toBe(true);
    expect(r.waterEarned).toBe(12);
    expect(r.explanation).toBe(QUIZ.explanation);
    const upd = (p.gameProfile.update as jest.Mock).mock.calls[0][0].data;
    expect(upd.totalSeeds).toBe(62); // 50 + 12
  });

  it('answer sai → 0 💧, vẫn trả explanation + correct', async () => {
    const r = await new GameQuizService(prisma(), cfg()).answerQuiz('u1', 'q1', 0);
    expect(r.isCorrect).toBe(false);
    expect(r.waterEarned).toBe(0);
    expect(r.correct).toBe(1);
  });

  it('trả lời lại trong ngày → BadRequest', async () => {
    const p = prisma({ gameQuizAttempt: { findFirst: jest.fn().mockResolvedValue({ id: 'a1' }), create: jest.fn() } });
    await expect(new GameQuizService(p, cfg()).answerQuiz('u1', 'q1', 1)).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Chạy test — FAIL**

Run: `cd apps/api && pnpm test -- game-quiz`
Expected: FAIL ("Cannot find module './game-quiz.service'").

- [ ] **Step 3: Implementation:**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

@Injectable()
export class GameQuizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  private startOfDay(d: Date): Date {
    const utc7 = new Date(d.getTime() + 7 * 3600 * 1000);
    utc7.setUTCHours(0, 0, 0, 0);
    return new Date(utc7.getTime() - 7 * 3600 * 1000);
  }

  async getTodayQuiz(userId: string) {
    const count = await this.config.get<number>('game.quiz_daily_count', 5);
    const since = this.startOfDay(new Date());
    const done = await this.prisma.gameQuizAttempt.findMany({
      where: { userId, attemptedAt: { gte: since } },
      select: { quizId: true },
    });
    const quizzes = await this.prisma.gameQuiz.findMany({
      where: { id: { notIn: done.map((d) => d.quizId) } },
      take: count,
    });
    return quizzes.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
      category: q.category,
      difficulty: q.difficulty,
      waterReward: q.waterReward,
    }));
  }

  async answerQuiz(userId: string, quizId: string, choice: number) {
    const quiz = await this.prisma.gameQuiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new BadRequestException('Câu hỏi không tồn tại.');
    const since = this.startOfDay(new Date());
    const already = await this.prisma.gameQuizAttempt.findFirst({
      where: { userId, quizId, attemptedAt: { gte: since } },
    });
    if (already) throw new BadRequestException('Bạn đã trả lời câu này hôm nay.');

    const isCorrect = quiz.correct === choice;
    await this.prisma.gameQuizAttempt.create({ data: { userId, quizId, isCorrect } });

    let waterEarned = 0;
    if (isCorrect) {
      const tankCap = await this.config.get<number>('game.tank_capacity', 500);
      const p = await this.prisma.gameProfile.findUnique({ where: { userId } });
      waterEarned = quiz.waterReward;
      await this.prisma.gameProfile.update({
        where: { userId },
        data: { totalSeeds: Math.min(tankCap, (p?.totalSeeds ?? 0) + waterEarned) },
      });
    }
    return { isCorrect, correct: quiz.correct, waterEarned, explanation: quiz.explanation ?? null };
  }
}
```

- [ ] **Step 4: Chạy test — PASS**

Run: `cd apps/api && pnpm test -- game-quiz`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/game/game-quiz.service.ts apps/api/src/modules/game/game-quiz.service.spec.ts
git commit -m "feat(game): GameQuizService — quiz thiên nhiên → 💧 + reveal giải thích (TDD)"
```

---

## Task 4: Gỡ logic cũ khỏi GameService + wiring controller/module

**Files:**
- Modify: `apps/api/src/modules/game/game.service.ts` (xoá `checkIn`, `getTodayQuiz`, `answerQuiz`)
- Modify: `apps/api/src/modules/game/game.service.spec.ts` (xoá describe của 3 hàm đã chuyển)
- Modify: `apps/api/src/modules/game/game.controller.ts`
- Modify: `apps/api/src/modules/game/game.module.ts`

- [ ] **Step 1: Xoá 3 method khỏi `game.service.ts`** — `checkIn` (dòng ~63-103), `getTodayQuiz` (~154-168), `answerQuiz` (~170-184). Giữ `creditPoints`, `dayKey`, `startOfDay`, `addDays`, `ensureProfile`, `eco` (còn dùng bởi tree/spin). Nếu `addDays` chỉ dùng bởi checkIn → xoá luôn.

- [ ] **Step 2: Xoá describe tương ứng trong `game.service.spec.ts`** (các test `checkIn`/`getTodayQuiz`/`answerQuiz`).

- [ ] **Step 3: Sửa controller** — inject service mới + endpoint mới:

```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GameService } from './game.service';
import { GameEconomyService } from './game-economy.service';
import { GameQuizService } from './game-quiz.service';

class AnswerDto { @IsInt() @Min(0) choice!: number; }
class WaterDto { @IsInt() @Min(1) drops!: number; }

@Controller('game')
export class GameController {
  constructor(
    private readonly game: GameService,
    private readonly economy: GameEconomyService,
    private readonly quiz: GameQuizService,
  ) {}

  @Get('profile')
  profile(@CurrentUser('sub') userId: string) { return this.game.getProfile(userId); }

  @Post('check-in')
  checkIn(@CurrentUser('sub') userId: string) { return this.economy.checkIn(userId); }

  @Post('dew/collect')
  dew(@CurrentUser('sub') userId: string) { return this.economy.collectDew(userId); }

  @Post('streak-freeze/buy')
  buyFreeze(@CurrentUser('sub') userId: string) { return this.economy.buyStreakFreeze(userId); }

  @Post('spin')
  spin(@CurrentUser('sub') userId: string) { return this.game.spin(userId); }

  @Get('quiz/today')
  quizToday(@CurrentUser('sub') userId: string) { return this.quiz.getTodayQuiz(userId); }

  @Post('quiz/:id/answer')
  answer(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: AnswerDto) {
    return this.quiz.answerQuiz(userId, id, dto.choice);
  }

  @Post('tree/water')
  water(@CurrentUser('sub') userId: string, @Body() dto: WaterDto) { return this.game.waterTree(userId, dto.drops); }

  @Get('missions')
  missions(@CurrentUser('sub') userId: string) { return this.game.getMissions(userId); }

  @Get('forest')
  forest(@CurrentUser('sub') userId: string) { return this.game.getForest(userId); }

  @Public()
  @Get('leaderboard')
  leaderboard() { return this.game.getLeaderboard(); }
}
```

- [ ] **Step 4: Sửa module providers:**

```ts
import { Module } from '@nestjs/common';
import { GameController } from './game.controller';
import { GameService } from './game.service';
import { GameEconomyService } from './game-economy.service';
import { GameQuizService } from './game-quiz.service';

@Module({
  controllers: [GameController],
  providers: [GameService, GameEconomyService, GameQuizService],
  exports: [GameService],
})
export class GameModule {}
```

> Kiểm tra `game.module.ts` hiện có import gì khác (vd SystemConfig) — giữ nguyên, chỉ thêm providers mới. `SystemConfigService` cần khả dụng (đã global hoặc import module).

- [ ] **Step 5: Typecheck + test toàn module + build**

Run: `cd apps/api && pnpm typecheck && pnpm test -- game && pnpm build`
Expected: typecheck 0 lỗi; test xanh; build OK.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/game
git commit -m "refactor(game): controller/module dùng GameEconomy+GameQuiz; gỡ logic cũ khỏi GameService"
```

---

## Task 5: Seed ~40 câu hỏi thiên nhiên (chủ đề/độ khó/giải thích)

**Files:**
- Create: `apps/api/prisma/seed-game-quiz.ts`
- Modify: `apps/api/prisma/seed.ts` (gọi hàm seed quiz)

- [ ] **Step 1: Tạo file seed** với ~40 câu, mỗi câu có `category` (cay/nuoc/dat/khong_khi/dong_vat/tai_che/nang_luong), `difficulty` 1-3, `explanation`, `waterReward` (8/10/12 theo độ khó). Cấu trúc:

```ts
import { PrismaClient } from '@prisma/client';

interface SeedQuiz {
  id: string; question: string; options: string[]; correct: number;
  category: string; difficulty: number; explanation: string; waterReward: number;
}

const QUIZZES: SeedQuiz[] = [
  { id: 'nq_water_1', category: 'nuoc', difficulty: 2, waterReward: 10,
    question: 'Rừng ngập mặn hấp thụ CO₂ như thế nào so với rừng thường?',
    options: ['Ít hơn', 'Tương đương', 'Gấp khoảng 4 lần', 'Không hấp thụ'], correct: 2,
    explanation: 'Rừng ngập mặn (đước, mắm) lưu trữ carbon trong bùn gấp ~4 lần rừng nhiệt đới thường.' },
  { id: 'nq_tree_1', category: 'cay', difficulty: 1, waterReward: 8,
    question: 'Một cây xanh trưởng thành hấp thụ khoảng bao nhiêu CO₂ mỗi năm?',
    options: ['~2 kg', '~21 kg', '~200 kg', '~2 tấn'], correct: 1,
    explanation: 'Trung bình ~21 kg CO₂/cây/năm — vì vậy trồng rừng giúp giảm khí nhà kính.' },
  // ... thêm ~38 câu nữa, đủ 7 chủ đề, trải 3 mức khó ...
];

export async function seedGameQuiz(prisma: PrismaClient): Promise<void> {
  for (const q of QUIZZES) {
    await prisma.gameQuiz.upsert({
      where: { id: q.id },
      update: { question: q.question, options: q.options, correct: q.correct,
        category: q.category, difficulty: q.difficulty, explanation: q.explanation, waterReward: q.waterReward, rewardPts: 0 },
      create: { id: q.id, question: q.question, options: q.options, correct: q.correct,
        category: q.category, difficulty: q.difficulty, explanation: q.explanation, waterReward: q.waterReward, rewardPts: 0 },
    });
  }
  console.log(`[seed] ${QUIZZES.length} câu quiz thiên nhiên`);
}
```

> Nội dung 40 câu: implementer soạn dựa trên kiến thức sinh thái VN (hoặc xin user). Mỗi chủ đề ≥5 câu, mỗi câu `explanation` ngắn gọn đúng sự thật. Tránh đáp án mơ hồ.

- [ ] **Step 2: Gọi trong `prisma/seed.ts`** — thêm `import { seedGameQuiz } from './seed-game-quiz';` và gọi `await seedGameQuiz(prisma);` trong hàm main (sau các seed khác).

- [ ] **Step 3: Chạy seed:**

Run: `cd apps/api && pnpm prisma:seed`
Expected: log "[seed] 40 câu quiz thiên nhiên" không lỗi.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/seed-game-quiz.ts apps/api/prisma/seed.ts
git commit -m "feat(game): seed ~40 câu hỏi thiên nhiên (chủ đề/độ khó/giải thích)"
```

---

## Task 6: SystemConfig defaults + smoke verify

**Files:**
- (Tùy) `apps/api/prisma/seed.ts` hoặc nơi seed SystemConfig — thêm key mới nếu dự án seed config vào DB.

- [ ] **Step 1:** Bổ sung/seed các config key mới (nếu dự án lưu config DB): `game.tank_capacity=500`, `game.dew_seeds=15`, `game.streak_freeze_cost=80`. Nếu chỉ dùng default trong code thì bỏ qua (default đã đặt ở service).

- [ ] **Step 2: Smoke test live** (server chạy port test, vd 3009) các endpoint mới:

```bash
# (đăng nhập lấy token trước theo luồng có sẵn) rồi:
curl -s -XPOST localhost:3009/api/game/check-in -H "Authorization: Bearer $T" | head -c 200
curl -s -XPOST localhost:3009/api/game/dew/collect -H "Authorization: Bearer $T" | head -c 200
curl -s localhost:3009/api/game/quiz/today -H "Authorization: Bearer $T" | head -c 300
```
Expected: check-in trả `seedsEarned/streakDays/pointsEarned:0`; dew trả `seedsEarned`; quiz trả list có `category/waterReward`, KHÔNG có `correct`.

- [ ] **Step 3: Commit (nếu có thay đổi config)**

```bash
git add -A && git commit -m "chore(game): config defaults phase1 (tank/dew/streak-freeze)"
```

---

## Self-Review (đã chạy khi viết plan)

- **Spec coverage:** quiz→💧 (Task 3) ✓ · daily reward sang 💧/bỏ điểm Xanh (Task 2) ✓ · streak + vé giữ lửa (Task 2) ✓ · giọt sương (Task 2) ✓ · tách module sạch (Task 2,3,4) ✓ · TDD (Task 2,3) ✓ · schema/migration (Task 1) ✓ · ngân hàng câu hỏi (Task 5) ✓. **Chưa trong 1A (đúng phạm vi):** DailyGoalCard/GardenHero/QuizSheet (FE → Plan 1B); push nhắc (Plan 1C — cron + notifications); mốc thưởng streak xa (gộp Plan 1B UI + config). Ghi rõ để không tưởng nhầm là sót.
- **Placeholder:** nội dung 40 câu seed là phần soạn nội dung (Task 5 nêu rõ tiêu chí) — không phải placeholder code.
- **Type consistency:** `checkIn` trả `{seedsEarned, pointsEarned, streakDays, totalSeeds, streakFrozeUsed, bonusNote}`; `answerQuiz` trả `{isCorrect, correct, waterEarned, explanation}`; controller khớp. `totalSeeds` = 💧 xuyên suốt.

## Tiếp theo
- **Plan 1B (FE):** GardenHero + DailyGoalCard + QuizSheet (reveal "Bạn có biết") + StreakStrip (vé giữ lửa) + dew + harvest đẹp; wire endpoint mới; cập nhật game-api.ts shape.
- **Plan 1C (push):** cron nhắc điểm danh/cây khát qua notifications (OA/in-app; ZNS gate).
