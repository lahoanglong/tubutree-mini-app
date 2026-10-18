import { isIPv4, isIPv6 } from 'node:net';
import { Injectable } from '@nestjs/common';
import type { Prisma, WasteActorRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { WASTE_EVENT_KINDS, type WasteEventKind } from '../waste.constants';

// Type alias, not interface: an interface is not assignable to Prisma.InputJsonObject inside event meta.
export type WasteDeviceMeta = { ip: string | null; userAgent: string | null };

export interface WasteEventInput {
  kind: WasteEventKind;
  actorUserId: string | null;
  actorRole: WasteActorRole;
  requestId?: string | null;
  pointId?: string | null;
  giftRedemptionId?: string | null;
  meta?: Prisma.InputJsonObject;
}

export async function writeWasteEvent(db: Prisma.TransactionClient, input: WasteEventInput): Promise<{ id: string }> {
  if (!(WASTE_EVENT_KINDS as readonly string[]).includes(input.kind)) throw new Error(`Unknown waste event kind: ${input.kind}`);
  return db.wasteEvent.create({
    data: {
      kind: input.kind,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      requestId: input.requestId ?? null,
      pointId: input.pointId ?? null,
      giftRedemptionId: input.giftRedemptionId ?? null,
      ...(input.meta === undefined ? {} : { meta: input.meta }),
    },
    select: { id: true },
  });
}

export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  let v = ip.trim();
  if (v.toLowerCase().startsWith('::ffff:') && isIPv4(v.slice(7))) v = v.slice(7);
  if (isIPv4(v)) return `${v.split('.').slice(0, 3).join('.')}.0`;
  if (!isIPv6(v)) return null;
  const [headRaw, tailRaw] = v.split('%')[0]!.split('::');
  const head = headRaw ? headRaw.split(':') : [];
  const tail = tailRaw === undefined ? [] : tailRaw ? tailRaw.split(':') : [];
  const groups = tailRaw === undefined ? head : [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return `${groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, '').toLowerCase()).join(':')}::`;
}

export function deviceMetaOf(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): WasteDeviceMeta {
  const ua = req.headers['user-agent'];
  const first = Array.isArray(ua) ? ua[0] : ua;
  return { ip: truncateIp(req.ip), userAgent: first ? first.slice(0, 200) : null };
}

@Injectable()
export class WasteEventsService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: WasteEventInput, db?: Prisma.TransactionClient): Promise<{ id: string }> {
    return writeWasteEvent(db ?? this.prisma, input);
  }
}
