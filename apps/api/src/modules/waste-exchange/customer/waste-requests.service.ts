import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { WasteRequestDetailDTO, WasteRequestSummaryDTO } from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteHoldService } from '../core/waste-hold.service';
import { WASTE_MESSAGES } from '../core/waste-messages';
import { toRequestDetail, toRequestSummary, WASTE_REQUEST_FULL_INCLUDE, WASTE_REQUEST_SUMMARY_INCLUDE, type WasteRequestFull } from './waste-request.mapper';

@Injectable()
export class WasteRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WasteAccessService,
    private readonly hold: WasteHoldService,
    private readonly config: WasteConfigService,
  ) {}

  async list(userId: string): Promise<WasteRequestSummaryDTO[]> {
    const rows = await this.prisma.wasteRequest.findMany({
      where: { userId },
      include: WASTE_REQUEST_SUMMARY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toRequestSummary);
  }

  detail(userId: string, id: string): Promise<WasteRequestDetailDTO> {
    return this.loadDetail(this.prisma, userId, id);
  }

  byOrder(userId: string, orderId: string): Promise<WasteRequestDetailDTO> {
    return this.loadOwned(this.prisma, { orderId, userId });
  }

  loadDetail(db: Prisma.TransactionClient, userId: string, id: string): Promise<WasteRequestDetailDTO> {
    return this.loadOwned(db, { id, userId });
  }

  private async loadOwned(db: Prisma.TransactionClient, where: Prisma.WasteRequestWhereInput): Promise<WasteRequestDetailDTO> {
    const row: WasteRequestFull | null = await db.wasteRequest.findFirst({ where, include: WASTE_REQUEST_FULL_INCLUDE });
    if (!row) throw new NotFoundException(WASTE_MESSAGES.REQUEST_NOT_FOUND);
    const pointAvailable = (await this.access.availablePointIds(db, [row.pointId])).has(row.pointId);
    return toRequestDetail(row, pointAvailable);
  }
}
