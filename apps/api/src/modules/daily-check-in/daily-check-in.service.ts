import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GameEconomyService } from '../game/game-economy.service';
import { planCheckInSeeds, projectCheckIn } from '../game/checkin-streak';

type PointsResult = Awaited<ReturnType<LoyaltyService['dailyCheckIn']>>;
type WaterResult = Awaited<ReturnType<GameEconomyService['checkIn']>>;

export interface DailyCheckInResult {
  /** Kết quả cộng Điểm Xanh của LẦN GỌI NÀY; null = đã điểm danh từ trước (hoặc phần này vừa lỗi, xem `pending`). */
  points: PointsResult | null;
  /** Kết quả cộng giọt nước của lần gọi này; null = đã làm từ trước hoặc vừa lỗi. */
  water: WaterResult | null;
  /** true khi cả hai phần đều đã xong từ trước: lần gọi này không cộng gì. */
  alreadyDone: boolean;
  /** Phần còn thiếu do lỗi bất ngờ; client gọi lại sẽ bù đúng phần đó (cả hai phần idempotent theo ngày). */
  pending: Array<'points' | 'water'>;
}

/**
 * Một nút điểm danh cho cả Điểm Xanh và giọt nước Vườn Xanh. Mỗi bên giữ nguyên luật, mức thưởng và chốt chặn trùng ngày
 * (unique DB / CAS) của mình; lớp này chỉ gọi cả hai và coi bên đã xong hôm nay là xong, không phải lỗi.
 */
@Injectable()
export class DailyCheckInService {
  private readonly log = new Logger(DailyCheckInService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly loyalty: LoyaltyService,
    private readonly economy: GameEconomyService,
  ) {}

  private async waterToday(userId: string) {
    const p = await this.prisma.gameProfile.findUnique({
      where: { userId },
      select: { lastCheckInAt: true, totalSeeds: true, streakDays: true, streakFreezes: true },
    });
    const proj = projectCheckIn(p);
    return { done: proj.doneToday, totalSeeds: p?.totalSeeds ?? 0, first: !p?.lastCheckInAt, proj };
  }

  private async waterDoneToday(userId: string): Promise<boolean> {
    return (await this.waterToday(userId)).done;
  }

  private async pointsDoneToday(userId: string): Promise<boolean> {
    return (await this.loyalty.getDailyCheckInStatus(userId)).checkedInToday;
  }

  /**
   * Chạy một phần. Lỗi 400 của chính bên đó mà đọc lại thấy đã xong hôm nay = bên khác trong cùng ngày thắng race: coi là xong.
   * Mọi lỗi còn lại ném ra cho `run` quyết định.
   */
  private async part<T>(call: () => Promise<T>, isDone: () => Promise<boolean>): Promise<{ value: T | null; error: unknown }> {
    // Kiểm "đã xong" nằm trong try: lỗi DB ở bước này không được thành 500 sau khi phần kia đã cộng.
    try {
      if (await isDone()) return { value: null, error: null };
      return { value: await call(), error: null };
    } catch (error) {
      if (error instanceof BadRequestException) {
        try {
          if (await isDone()) return { value: null, error: null };
        } catch {
          /* đọc lại cũng lỗi: giữ lỗi gốc */
        }
      }
      return { value: null, error };
    }
  }

  async run(userId: string): Promise<DailyCheckInResult> {
    const points = await this.part(() => this.loyalty.dailyCheckIn(userId), () => this.pointsDoneToday(userId));
    const water = await this.part(() => this.economy.checkIn(userId), () => this.waterDoneToday(userId));

    const pending: Array<'points' | 'water'> = [];
    if (points.error) pending.push('points');
    if (water.error) pending.push('water');
    if (pending.length > 0) {
      const gained = points.value !== null || water.value !== null;
      // Chưa cộng được gì thì báo lỗi thật như endpoint cũ; đã cộng một phần thì trả phần đó để khách không mất thông tin.
      if (!gained) throw points.error ?? water.error;
      this.log.warn(`Điểm danh gộp của ${userId} thiếu phần ${pending.join(',')}: ${String(points.error ?? water.error)}`);
    }
    return {
      points: points.value,
      water: water.value,
      alreadyDone: pending.length === 0 && points.value === null && water.value === null,
      pending,
    };
  }

  /**
   * Trạng thái gộp: `checkedInToday` = cả hai phần đã xong hôm nay. Dải 7 ngày (`streakDay`) và chuỗi là MỘT chuỗi chung của hồ sơ Vườn: Điểm Xanh chỉ đọc ngày của chuỗi đó.
   * Phần đã xong trả 0 ở `todayPoints`/`todayWater` để màn hình không hứa lại phần thưởng đã nhận.
   */
  async status(userId: string) {
    const [pointsStatus, water, tankCap] = await Promise.all([
      this.loyalty.getDailyCheckInStatus(userId),
      this.waterToday(userId),
      this.config.get<number>('game.tank_capacity', 500),
    ]);
    const waterDone = water.done;
    const { seeds } = await planCheckInSeeds(this.config, {
      first: water.first,
      gapDays: water.proj.gapDays,
      streakDays: water.proj.streakDays,
    });
    const pointsDone = pointsStatus.checkedInToday;
    return {
      ...pointsStatus,
      checkedInToday: pointsDone && waterDone,
      pointsDone,
      waterDone,
      todayPoints: pointsDone ? 0 : pointsStatus.todayPoints,
      /**
       * Giọt nước khách THỰC SỰ nhận ở lần điểm danh kế tiếp: bình đầy thì phần tràn bị cắt (cùng luật với economy.checkIn).
       * Gồm thưởng mốc chuỗi 3/7 ngày, quà lần đầu và quà quay lại: cùng một nguồn với số toast sau khi bấm. 0 khi đã xong hoặc bình đầy.
       */
      tankFull: water.totalSeeds >= tankCap,
      todayWater: waterDone ? 0 : Math.max(0, Math.min(seeds, tankCap - water.totalSeeds)),
    };
  }
}
