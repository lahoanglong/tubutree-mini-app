import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, WasteItem } from '@prisma/client';
import type { AdminWasteItemDTO, WasteItemUpsertRequest, WasteReorderRequest } from '@tubutree/shared-types';
import { assertActiveAdmin } from '../../../common/staff-access';
import { PrismaService } from '../../../prisma/prisma.service';
import { writeWasteEvent } from '../core/waste-events';

const HAZARDOUS_NOT_ACTIVE = 'Món nguy hại không được đặt Đang nhận.';
const CODE_TAKEN = 'Mã món đã tồn tại.';

const pick = (o: Record<string, unknown>, keys: string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, o[k]]));
// Value equality, so a null or Date value is never "changed" by reference.
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isCodeViolation = (e: unknown): boolean =>
  (e as { code?: unknown })?.code === 'P2002' && String((e as { meta?: { target?: unknown } }).meta?.target ?? '').includes('code');

function toAdminItemDTO(row: WasteItem): AdminWasteItemDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    unitLabel: row.unitLabel,
    unitsPerPoint: row.unitsPerPoint,
    pointsPerGroup: row.pointsPerGroup,
    dropsPerUnit: row.dropsPerUnit,
    dailyCapQty: row.dailyCapQty,
    monthlyCapQty: row.monthlyCapQty,
    status: row.status,
    prepInstructions: row.prepInstructions,
    imageUrl: row.imageUrl,
    gramsPerUnit: row.gramsPerUnit,
    hazardous: row.hazardous,
    warehouseOnly: row.warehouseOnly,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class WasteAdminItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(adminUserId: string): Promise<AdminWasteItemDTO[]> {
    await assertActiveAdmin(this.prisma, adminUserId);
    const rows = await this.prisma.wasteItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    return rows.map(toAdminItemDTO);
  }

  async create(adminUserId: string, body: WasteItemUpsertRequest): Promise<AdminWasteItemDTO> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    if (body.hazardous === true && body.status === 'ACTIVE') throw new BadRequestException(HAZARDOUS_NOT_ACTIVE);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.wasteItem.create({
          data: {
            code: body.code,
            name: body.name,
            unitLabel: body.unitLabel,
            unitsPerPoint: body.unitsPerPoint,
            pointsPerGroup: body.pointsPerGroup,
            dropsPerUnit: body.dropsPerUnit ?? 0,
            dailyCapQty: body.dailyCapQty ?? null,
            monthlyCapQty: body.monthlyCapQty ?? null,
            status: body.status ?? 'HIDDEN',
            prepInstructions: body.prepInstructions ?? null,
            imageUrl: body.imageUrl ?? null,
            sortOrder: body.sortOrder ?? 0,
            gramsPerUnit: body.gramsPerUnit ?? null,
            hazardous: body.hazardous ?? false,
          },
        });
        await writeWasteEvent(tx, {
          kind: 'ITEM_CREATED',
          actorUserId: admin.id,
          actorRole: 'ADMIN',
          meta: {
            itemId: row.id,
            before: null,
            after: {
              code: row.code,
              unitsPerPoint: row.unitsPerPoint,
              pointsPerGroup: row.pointsPerGroup,
              dropsPerUnit: row.dropsPerUnit,
              hazardous: row.hazardous,
            },
          },
        });
        return row;
      });
      return toAdminItemDTO(created);
    } catch (e) {
      if (isCodeViolation(e)) throw new ConflictException(CODE_TAKEN);
      throw e;
    }
  }

  async update(adminUserId: string, id: string, body: Partial<WasteItemUpsertRequest>): Promise<AdminWasteItemDTO> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // FOR UPDATE: the hazardous/ACTIVE check and the logged "before" read the committed row, not a stale one.
        const [cur] = await tx.$queryRaw<WasteItem[]>`SELECT * FROM "waste_items" WHERE "id" = ${id} FOR UPDATE`;
        if (!cur) throw new NotFoundException('Không tìm thấy món.');
        if (body.hazardous === false && cur.hazardous) throw new BadRequestException('Không gỡ được cờ nguy hại của món.');

        const nextHazardous = body.hazardous ?? cur.hazardous;
        const nextStatus = body.status ?? cur.status;
        if (nextHazardous && nextStatus === 'ACTIVE') {
          throw new BadRequestException(
            cur.hazardous || body.hazardous === undefined
              ? HAZARDOUS_NOT_ACTIVE
              : 'Món đang nhận không bật được cờ nguy hại; hãy chuyển món sang Sắp nhận hoặc Ẩn trước.',
          );
        }

        const data = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
        const curRecord = cur as unknown as Record<string, unknown>;
        const changed = Object.keys(data).filter((k) => !same(data[k], curRecord[k]));
        if (changed.length === 0) return cur;

        const updated = await tx.wasteItem.update({ where: { id }, data: data as Prisma.WasteItemUncheckedUpdateInput });
        await writeWasteEvent(tx, {
          kind: 'ITEM_UPDATED',
          actorUserId: admin.id,
          actorRole: 'ADMIN',
          meta: {
            itemId: id,
            before: pick(curRecord, changed) as Prisma.InputJsonObject,
            after: pick(updated as unknown as Record<string, unknown>, changed) as Prisma.InputJsonObject,
          },
        });
        return updated;
      });
      return toAdminItemDTO(row);
    } catch (e) {
      if (isCodeViolation(e)) throw new ConflictException(CODE_TAKEN);
      throw e;
    }
  }

  async reorder(adminUserId: string, body: WasteReorderRequest): Promise<AdminWasteItemDTO[]> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    const ids = body.ids;
    await this.prisma.$transaction(async (tx) => {
      // Every row locked in one global order, so two reorders with opposite bodies queue instead of deadlocking.
      // NO KEY UPDATE, not FOR UPDATE: it stays compatible with the KEY SHARE of a child FK insert, which locks in body order.
      await tx.$queryRaw`SELECT "id" FROM "waste_items" ORDER BY "id" FOR NO KEY UPDATE`;
      const all = await tx.wasteItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: { id: true } });
      const known = new Set(all.map((i) => i.id));
      if (new Set(ids).size !== ids.length || ids.length !== all.length || !ids.every((i) => known.has(i))) {
        throw new BadRequestException('Danh sách sắp xếp phải gồm đủ mọi món, mỗi món một lần.');
      }
      for (const [i, itemId] of ids.entries()) {
        await tx.wasteItem.update({ where: { id: itemId }, data: { sortOrder: (i + 1) * 10 } });
      }
      await writeWasteEvent(tx, {
        kind: 'ITEMS_REORDERED',
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        meta: { before: { ids: all.map((i) => i.id) }, after: { ids } },
      });
    });
    return this.list(adminUserId);
  }
}
