import { Injectable } from '@nestjs/common';
import type { WasteDeskPointRefDTO, WasteMeDTO, WasteMeItemDTO, WasteRequestSummaryDTO, WasteRulesDTO } from '@tubutree/shared-types';
import { vnDateKey, vnMonthKey } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { remainingQty } from '../core/waste-caps';
import { eligibilityOf, WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { computeWastePublicFlags } from '../core/waste-public-config';
import { WasteHoldService } from '../core/waste-hold.service';
import { WASTE_OPEN_STATUSES } from '../waste.constants';
import { toWasteItemDTO } from './waste-catalogue.service';
import { toRequestSummary, WASTE_REQUEST_SUMMARY_INCLUDE } from './waste-request.mapper';

@Injectable()
export class WasteMeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly systemConfig: SystemConfigService,
    private readonly access: WasteAccessService,
    private readonly hold: WasteHoldService,
    private readonly loyalty: LoyaltyService,
  ) {}

  async me(userId: string): Promise<WasteMeDTO> {
    const now = new Date();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        zaloId: true,
        role: true,
        isBlocked: true,
        mergedIntoId: true,
        pointsBalance: true,
        pointsConvertedBalance: true,
        wasteFlags: { select: { blockedAt: true, shipLockedAt: true } },
      },
    });
    const eligibility = user ? eligibilityOf(user) : 'GUEST';
    const [snapshot, flags] = await Promise.all([this.config.snapshot(), computeWastePublicFlags(this.systemConfig)]);
    const itemRows = await this.prisma.wasteItem.findMany({
      where: { status: { in: ['ACTIVE', 'COMING_SOON'] } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const deskPoints: WasteDeskPointRefDTO[] = user
      ? (await this.access.listOperablePoints(userId, snapshot.enabled)).map((p) => ({ id: p.pointId, name: p.name, kind: p.kind }))
      : [];

    const common = {
      programmeEnabled: snapshot.enabled,
      eligibility,
      blocked: !!user?.wasteFlags?.blockedAt,
      shipLockedAt: user?.wasteFlags?.shipLockedAt?.toISOString() ?? null,
      laneFlags: { dropoff: flags.dropoff, mailin: flags.mailin, pickup: flags.pickup },
      parcelLimits: { maxWeightKg: snapshot.mailinMaxWeightKg, maxEdgeCm: snapshot.mailinMaxEdgeCm },
      thresholds: { mailinMinPoints: snapshot.mailinMinPoints, pickupMinPoints: snapshot.pickupMinPoints, maxOpenRequests: snapshot.maxOpenRequests },
      deskPoints,
    };

    if (!user || eligibility !== 'OK') {
      const items: WasteMeItemDTO[] = itemRows.map((i) => ({ ...toWasteItemDTO(i), monthRemainingQty: i.monthlyCapQty, dayRemainingQty: i.dailyCapQty }));
      return { ...common, balance: null, monthUsage: null, impactGrams: null, items, openRequests: [] };
    }

    const monthKey = vnMonthKey(now);
    const usage = await this.hold.capUsage(this.prisma, userId, vnDateKey(now), monthKey);
    const locked = (await this.loyalty.lockedOrderPoints(userId, now)).locked;
    const openRows = await this.prisma.wasteRequest.findMany({
      where: { userId, status: { in: [...WASTE_OPEN_STATUSES] } },
      include: WASTE_REQUEST_SUMMARY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const completed = await this.prisma.wasteRequest.findMany({
      where: { userId, status: 'COMPLETED' },
      select: { lines: { select: { receivedQty: true, gramsPerUnit: true } } },
    });

    let impactGrams: number | null = null;
    for (const r of completed) {
      if (!r.lines.every((l) => l.gramsPerUnit !== null)) continue;
      impactGrams = (impactGrams ?? 0) + r.lines.reduce((sum, l) => sum + (l.receivedQty ?? 0) * (l.gramsPerUnit as number), 0);
    }

    const items: WasteMeItemDTO[] = itemRows.map((i) => ({
      ...toWasteItemDTO(i),
      monthRemainingQty: remainingQty(i.monthlyCapQty, usage.itemMonth.get(i.id) ?? 0),
      dayRemainingQty: remainingQty(i.dailyCapQty, usage.itemDay.get(i.id) ?? 0),
    }));
    const openRequests: WasteRequestSummaryDTO[] = openRows.map(toRequestSummary);
    return {
      ...common,
      balance: {
        pointsBalance: user.pointsBalance,
        pointsConvertedBalance: user.pointsConvertedBalance,
        redeemablePoints: Math.max(0, user.pointsBalance - locked),
      },
      monthUsage: { capMonthKey: monthKey, pointsUsed: usage.pointsMonth, pointsCap: snapshot.customerMonthlyCapPoints },
      impactGrams,
      items,
      openRequests,
    };
  }

  async rules(): Promise<WasteRulesDTO> {
    const { rulesText } = await this.config.snapshot();
    return { text: rulesText === '' ? null : rulesText };
  }
}
