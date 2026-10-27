import { Injectable } from '@nestjs/common';
import type { WastePreviewBlockDTO, WastePreviewDTO, WastePreviewRequest } from '@tubutree/shared-types';
import { vnDateKey, vnMonthKey } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { remainingQty } from '../core/waste-caps';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteHoldService, type WasteHoldConfig } from '../core/waste-hold.service';
import { computeWastePublicFlags } from '../core/waste-public-config';
import { requestTotals } from '../waste-points';
import { CUSTOMER_VISIBLE_ITEMS_WHERE } from './waste-catalogue.service';
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

    const usage = await this.hold.capUsage(this.prisma, userId, vnDateKey(now), vnMonthKey(now));
    const items = await this.prisma.wasteItem.findMany({
      where: { AND: [{ id: { in: body.lines.map((l) => l.itemId) } }, CUSTOMER_VISIBLE_ITEMS_WHERE] },
      select: { id: true, dailyCapQty: true, monthlyCapQty: true },
    });
    // Món nguy hại chưa ACTIVE (pin) khách không được thấy: không tính điểm, không lộ trần; khối ITEM_NOT_ACTIVE vẫn do máy chủ báo.
    const visibleIds = new Set(items.map((i) => i.id));
    const shown = result.lines.filter((l) => visibleIds.has(l.itemId));
    const totals = shown.length === result.lines.length
      ? { points: result.estimatedPoints, drops: result.estimatedDrops, grams: null as number | null }
      : requestTotals(shown.map((l) => ({ qty: l.declaredQty, snap: l })));
    const grams = shown.some((l) => l.gramsPerUnit === null)
      ? null
      : shown.reduce((sum, l) => sum + l.declaredQty * (l.gramsPerUnit as number), 0);
    const itemCaps = body.lines.map((l) => {
      const it = items.find((i) => i.id === l.itemId);
      return {
        itemId: l.itemId,
        monthRemainingQty: it ? remainingQty(it.monthlyCapQty, usage.itemMonth.get(l.itemId) ?? 0) : null,
        dayRemainingQty: it ? remainingQty(it.dailyCapQty, usage.itemDay.get(l.itemId) ?? 0) : null,
      };
    });

    let feeEstimate: WastePreviewDTO['feeEstimate'] = null;
    if (body.method === 'MAIL_IN') {
      const province = await this.province(userId, body.provinceCode);
      if (province) feeEstimate = estimateMailinFee(snap.mailinFeeTable, province);
      else blocks.push({ code: 'NEED_PROVINCE' });
    }

    return {
      estimatedPoints: totals.points,
      estimatedDrops: totals.drops,
      estimatedGrams: grams,
      pointsValueVnd: totals.points * vndPerPoint,
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
