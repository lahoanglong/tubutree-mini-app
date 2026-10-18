import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, WasteGift } from '@prisma/client';
import type { AdminWasteGiftDTO, WasteGiftUpsertRequest, WasteReorderRequest, WasteVoucherSpec } from '@tubutree/shared-types';
import { assertActiveAdmin } from '../../../common/staff-access';
import { PrismaService } from '../../../prisma/prisma.service';
import { COUPON_AMOUNT_MAX } from '../../admin/admin.controller';
import { voucherSpecOf } from '../../loyalty/loyalty.service';
import { formatVnd } from '../../orders/refund-destination';
import { writeWasteEvent } from '../core/waste-events';

const TREE_ALLOWED_KEYS = ['name', 'sortOrder', 'imageUrl', 'status'];
const PLAIN_KEYS = ['name', 'description', 'label', 'pointsCost', 'status', 'sortOrder', 'imageUrl', 'stock', 'claimInstructions'] as const;
const VOUCHER_ON_NON_VOUCHER = 'Chỉ mã giảm giá mới có thông tin giảm giá.';

const pick = (o: Record<string, unknown>, keys: string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, o[k]]));
// Value equality, so a Json, Date or array value is never "changed" by reference.
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const voucherColumns = (v: WasteVoucherSpec | undefined | null) => ({
  voucherType: v?.type ?? null,
  voucherValue: v?.value ?? null,
  voucherMinOrder: v?.minOrder ?? null,
  voucherMaxDiscount: v?.maxDiscount ?? null,
  voucherValidDays: v?.validDays ?? null,
});

// Same rules as the coupon form (admin/coupon-input-rules.ts), so a gift can never mint a code that discounts a whole order.
export function assertVoucherSpec(v: WasteVoucherSpec): void {
  if (v.type !== 'FREESHIP' && v.value <= 0) throw new BadRequestException('Mức giảm phải lớn hơn 0.');
  if (v.type === 'PERCENT' && v.value > 100) throw new BadRequestException('Mức giảm theo % tối đa 100.');
  if (v.type === 'PERCENT' && v.value >= 50 && !v.maxDiscount) {
    throw new BadRequestException('Mã giảm từ 50% phải đặt Giảm tối đa (đ) để một đơn lớn không được giảm gần hết.');
  }
  if (v.type === 'AMOUNT' && v.value > COUPON_AMOUNT_MAX) {
    throw new BadRequestException('Mức giảm tối đa 5.000.000đ cho mã giảm theo số tiền.');
  }
  if (v.type === 'AMOUNT' && v.minOrder && v.value >= v.minOrder) {
    throw new BadRequestException(
      `Mức giảm ${formatVnd(v.value)} phải nhỏ hơn đơn tối thiểu ${formatVnd(v.minOrder)} — không thì đơn ở mức tối thiểu được giảm hết tiền hàng. Kiểm tra lại số 0 của hai ô.`,
    );
  }
}

function toAdminGiftDTO(row: WasteGift, redemptionCount: number, fundTreeTotal?: number): AdminWasteGiftDTO {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    label: row.label,
    pointsCost: row.pointsCost,
    status: row.status,
    sortOrder: row.sortOrder,
    imageUrl: row.imageUrl,
    stock: row.stock,
    claimInstructions: row.claimInstructions,
    voucher: row.kind === 'VOUCHER' ? voucherSpecOf(row) : null,
    redemptionCount,
    ...(row.kind === 'TREE' ? { fundTreeTotal } : {}),
  };
}

@Injectable()
export class WasteAdminGiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(adminUserId: string): Promise<AdminWasteGiftDTO[]> {
    await assertActiveAdmin(this.prisma, adminUserId);
    const rows = await this.prisma.wasteGift.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    return this.toDtos(rows);
  }

  async create(adminUserId: string, body: WasteGiftUpsertRequest): Promise<AdminWasteGiftDTO> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    if (!body.kind) throw new BadRequestException('Chọn loại quà.');
    if (body.kind === 'TREE') throw new BadRequestException('Chỉ có một thẻ góp quỹ trồng cây, không tạo thêm.');
    if (body.pointsCost === undefined || body.pointsCost === null) throw new BadRequestException('Nhập số điểm đổi từ 1 đến 2.000.000.');
    if (body.kind === 'VOUCHER' && !body.voucher) throw new BadRequestException('Mã giảm giá cần loại giảm, giá trị và số ngày hiệu lực.');
    if (body.kind !== 'VOUCHER' && body.voucher) throw new BadRequestException(VOUCHER_ON_NON_VOUCHER);
    if (body.kind === 'VOUCHER') assertVoucherSpec(body.voucher!);

    const kind = body.kind;
    const pointsCost = body.pointsCost;
    const status = body.status ?? 'HIDDEN';
    const id = `gift-${randomBytes(5).toString('hex')}`;
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.wasteGift.create({
        data: {
          id,
          kind,
          name: body.name,
          description: body.description ?? null,
          label: body.label ?? null,
          pointsCost,
          status,
          sortOrder: body.sortOrder ?? 0,
          imageUrl: body.imageUrl ?? null,
          stock: body.stock ?? null,
          claimInstructions: body.claimInstructions ?? null,
          ...voucherColumns(body.voucher),
        },
      });
      await writeWasteEvent(tx, {
        kind: 'GIFT_CREATED',
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        meta: { giftId: id, before: null, after: { kind, pointsCost, stock: body.stock ?? null, status } },
      });
      return row;
    });
    return toAdminGiftDTO(created, 0);
  }

  async update(adminUserId: string, id: string, body: Partial<WasteGiftUpsertRequest>): Promise<AdminWasteGiftDTO> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    if ('kind' in body) throw new BadRequestException('Không đổi được loại quà.');

    const result = await this.prisma.$transaction(async (tx) => {
      // FOR UPDATE: the logged "before" is the committed value, even right after a redeem took stock.
      const [cur] = await tx.$queryRaw<WasteGift[]>`SELECT * FROM "waste_gifts" WHERE "id" = ${id} FOR UPDATE`;
      if (!cur) throw new NotFoundException('Không tìm thấy quà.');
      const present = Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined);
      if (cur.kind === 'TREE' && present.some((k) => !TREE_ALLOWED_KEYS.includes(k))) {
        throw new BadRequestException('Thẻ góp quỹ trồng cây chỉ sửa được tên, thứ tự, ảnh và trạng thái.');
      }
      if (cur.kind !== 'VOUCHER' && body.voucher) throw new BadRequestException(VOUCHER_ON_NON_VOUCHER);
      if (body.voucher) assertVoucherSpec(body.voucher);

      const data: Record<string, unknown> = {};
      for (const k of PLAIN_KEYS) if (body[k] !== undefined) data[k] = body[k];
      if (body.voucher) Object.assign(data, voucherColumns(body.voucher));
      const curRecord = cur as unknown as Record<string, unknown>;
      const changed = Object.keys(data).filter((k) => !same(data[k], curRecord[k]));
      if (changed.length === 0) return { row: cur, written: false };

      const updated = await tx.wasteGift.update({ where: { id }, data: data as Prisma.WasteGiftUncheckedUpdateInput });
      await writeWasteEvent(tx, {
        kind: 'GIFT_UPDATED',
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        meta: {
          giftId: id,
          before: pick(curRecord, changed) as Prisma.InputJsonObject,
          after: pick(updated as unknown as Record<string, unknown>, changed) as Prisma.InputJsonObject,
        },
      });
      return { row: updated, written: true };
    });
    const [dto] = await this.toDtos([result.row]);
    return dto!;
  }

  async reorder(adminUserId: string, body: WasteReorderRequest): Promise<AdminWasteGiftDTO[]> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    const ids = body.ids;
    await this.prisma.$transaction(async (tx) => {
      // Every row locked in one global order, so two reorders with opposite bodies queue instead of deadlocking.
      await tx.$queryRaw`SELECT "id" FROM "waste_gifts" ORDER BY "id" FOR UPDATE`;
      const all = await tx.wasteGift.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } });
      const known = new Set(all.map((g) => g.id));
      if (new Set(ids).size !== ids.length || ids.length !== all.length || !ids.every((i) => known.has(i))) {
        throw new BadRequestException('Danh sách sắp xếp phải gồm đủ mọi quà, mỗi quà một lần.');
      }
      for (const [i, giftId] of ids.entries()) {
        await tx.wasteGift.update({ where: { id: giftId }, data: { sortOrder: (i + 1) * 10 } });
      }
      await writeWasteEvent(tx, {
        kind: 'GIFTS_REORDERED',
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        meta: { before: { ids: all.map((g) => g.id) }, after: { ids } },
      });
    });
    return this.list(adminUserId);
  }

  private async toDtos(rows: WasteGift[]): Promise<AdminWasteGiftDTO[]> {
    const [grouped, treeCount, fundTreeTotal] = await Promise.all([
      this.prisma.wasteGiftRedemption.groupBy({ by: ['giftId'], where: { status: { in: ['READY', 'FULFILLED'] } }, _count: { _all: true } }),
      rows.some((r) => r.kind === 'TREE')
        ? this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(DISTINCT "reason")::int AS "n" FROM "points_transactions" WHERE "reason" LIKE 'GAME_BUY_TREE:%'`
        : Promise.resolve([{ n: 0 }]),
      rows.some((r) => r.kind === 'TREE') ? this.prisma.plantedTree.count() : Promise.resolve(0),
    ]);
    const counts = new Map(grouped.map((g) => [g.giftId, g._count._all]));
    return rows.map((r) => toAdminGiftDTO(r, r.kind === 'TREE' ? (treeCount[0]?.n ?? 0) : (counts.get(r.id) ?? 0), fundTreeTotal));
  }
}
