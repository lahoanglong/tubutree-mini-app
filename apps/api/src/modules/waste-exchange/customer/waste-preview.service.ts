import { Injectable } from '@nestjs/common';
import type { WastePreviewBlockDTO, WastePreviewDTO, WastePreviewRequest } from '@tubutree/shared-types';
import { vnDateKey, vnMonthKey } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { remainingQty } from '../core/waste-caps';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteHoldService, type WasteHoldConfig } from '../core/waste-hold.service';
import { computeWastePublicFlags } from '../core/waste-public-config';
import { estimateMailinFee } from './waste-fee';

const METHOD_FREE_BLOCKS: ReadonlySet<string> = new Set(['ITEM_MONTH_CAP', 'POINTS_MONTH_CAP']);

@Injectable()
export class WastePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly systemConfig: SystemConfigService,
    private readonly hold: WasteHoldService,
  ) {}

  async preview(userId: string, body: WastePreviewRequest): Promise<WastePreviewDTO> {
    const now = new Date();
    const snap = await this.config.snapshot();
    const vndPerPoint = await this.systemConfig.get<number>('loyalty.vnd_per_point_redeem', 1);
    const holdCfg: WasteHoldConfig = {
      laneDropoff: snap.laneDropoff,
      laneMailin: snap.laneMailin,
      lanePickup: snap.lanePickup,
      mailinMinPoints: snap.mailinMinPoints,
      pickupMinPoints: snap.pickupMinPoints,
      customerMonthlyCapPoints: snap.customerMonthlyCapPoints,
      maxOpenRequests: snap.maxOpenRequests,
      requestHoldDays: snap.requestHoldDays,
    };
    if (body.method === 'PICKUP') holdCfg.lanePickup = (await computeWastePublicFlags(this.systemConfig)).pickup;

    const { result, blocks: allBlocks } = await this.hold.evaluate(
      this.prisma,
      { path: 'CREATE', userId, method: body.method ?? 'DROP_OFF', lines: body.lines, pointId: body.method === 'DROP_OFF' ? (body.pointId ?? null) : null, now },
      holdCfg,
    );
    const blocks: WastePreviewBlockDTO[] = body.method ? allBlocks : allBlocks.filter((b) => METHOD_FREE_BLOCKS.has(b.code));

    const grams = result.lines.some((l) => l.gramsPerUnit === null)
      ? null
      : result.lines.reduce((s, l) => s + l.declaredQty * (l.gramsPerUnit as number), 0);

    const usage = await this.hold.capUsage(this.prisma, userId, vnDateKey(now), vnMonthKey(now));
    const items = await this.prisma.wasteItem.findMany({
      where: { id: { in: body.lines.map((l) => l.itemId) } },
      select: { id: true, dailyCapQty: true, monthlyCapQty: true },
    });
    const itemCaps = body.lines.map((l) => {
      const it = items.find((i) => i.id === l.itemId);
      return {
        itemId: l.itemId,
        monthRemainingQty: remainingQty(it?.monthlyCapQty ?? null, usage.itemMonth.get(l.itemId) ?? 0),
        dayRemainingQty: remainingQty(it?.dailyCapQty ?? null, usage.itemDay.get(l.itemId) ?? 0),
      };
    });

    let feeEstimate: WastePreviewDTO['feeEstimate'] = null;
    if (body.method === 'MAIL_IN') {
      const province = await this.province(userId, body.provinceCode);
      if (province) feeEstimate = estimateMailinFee(snap.mailinFeeTable, province);
      else blocks.push({ code: 'NEED_PROVINCE' });
    }

    return {
      estimatedPoints: result.estimatedPoints,
      estimatedDrops: result.estimatedDrops,
      estimatedGrams: grams,
      pointsValueVnd: result.estimatedPoints * vndPerPoint,
      blocks,
      feeEstimate,
      itemCaps,
      pointsMonthRemaining: Math.max(0, snap.customerMonthlyCapPoints - usage.pointsMonth),
    };
  }

  private async province(userId: string, provinceCode?: string): Promise<{ code: string; name: string } | null> {
    if (provinceCode) {
      const addr = await this.prisma.address.findFirst({ where: { userId, provinceCode }, select: { province: true } });
      if (addr?.province) return { code: provinceCode, name: addr.province };
      const point = await this.prisma.wastePoint.findFirst({ where: { provinceCode }, select: { provinceName: true } });
      return { code: provinceCode, name: point?.provinceName ?? provinceCode };
    }
    const def = await this.prisma.address.findFirst({ where: { userId, isDefault: true }, select: { provinceCode: true, province: true } });
    return def?.provinceCode ? { code: def.provinceCode, name: def.province ?? def.provinceCode } : null;
  }
}
