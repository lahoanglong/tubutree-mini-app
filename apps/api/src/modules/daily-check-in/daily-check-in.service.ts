import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { vnDateKey } from '../../common/vn-time';
import { SystemConfigService } from '../system-config/system-config.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GameEconomyService } from '../game/game-economy.service';

type PointsResult = Awaited<ReturnType<LoyaltyService['dailyCheckIn']>>;
type WaterResult = Awaited<ReturnType<GameEconomyService['checkIn']>>;

export interface DailyCheckInResult {
  /** Kết quả cộng Điểm Xanh của LẦN GỌI NÀY; null = đã điểm danh từ trước (hoặc phần này vừa lỗi, xem `pending`). */
  points: PointsResult | null;
  /** Kết quả cộng giọt nước của lần gọi này; null = đã làm từ trước, game tắt, hoặc vừa lỗi. */
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

  private gameEnabled(): Promise<boolean> {
    return this.config.get<boolean>('game.enabled', true);
  }

  private async waterDoneToday(userId: string): Promise<boolean> {
    const p = await this.prisma.gameProfile.findUnique({ where: { userId }, select: { lastCheckInAt: true } });
    return !!p?.lastCheckInAt && vnDateKey(p.lastCheckInAt) === vnDateKey();
  }

  private async pointsDoneToday(userId: string): Promise<boolean> {
    return (await this.loyalty.getDailyCheckInStatus(userId)).checkedInToday;
  }

  /**
   * Chạy một phần. Lỗi 400 của chính bên đó mà đọc lại thấy đã xong hôm nay = bên khác trong cùng ngày thắng race: coi là xong.
   * Mọi lỗi còn lại ném ra cho `run` quyết định.
   */
  private async part<T>(call: () => Promise<T>, isDone: () => Promise<boolean>): Promise<{ value: T | null; error: unknown }> {
    if (await isDone()) return { value: null, error: null };
    try {
      return { value: await call(), error: null };
    } catch (error) {
      if (error instanceof BadRequestException && (await isDone())) return { value: null, error: null };
      return { value: null, error };
    }
  }

  async run(userId: string): Promise<DailyCheckInResult> {
    const withWater = await this.gameEnabled();
    const points = await this.part(() => this.loyalty.dailyCheckIn(userId), () => this.pointsDoneToday(userId));
    const water = withWater
      ? await this.part(() => this.economy.checkIn(userId), () => this.waterDoneToday(userId))
      : { value: null, error: null };

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

  /** Trạng thái gộp: `checkedInToday` = mọi phần đang bật đều đã xong hôm nay. Dải 7 ngày và chuỗi là của Điểm Xanh. */
  async status(userId: string) {
    const withWater = await this.gameEnabled();
    const [pointsStatus, waterDone] = await Promise.all([
      this.loyalty.getDailyCheckInStatus(userId),
      withWater ? this.waterDoneToday(userId) : Promise.resolve(true),
    ]);
    return {
      ...pointsStatus,
      checkedInToday: pointsStatus.checkedInToday && waterDone,
      pointsDone: pointsStatus.checkedInToday,
      waterDone,
      gameEnabled: withWater,
    };
  }
}
