import { BadRequestException, ConflictException } from '@nestjs/common';
import type { WasteConfirmLineInput, WasteShortfallReason } from '@tubutree/shared-types';
import { lineDrops, linePoints } from '../waste-points';

export interface WasteStoredLine {
  id: string;
  itemId: string;
  declaredQty: number;
  unitsPerPoint: number;
  pointsPerGroup: number;
  dropsPerUnit: number;
  gramsPerUnit: number | null;
}

export interface WasteValidatedLine {
  lineId: string;
  itemId: string;
  declaredQty: number;
  receivedQty: number;
  shortfallReason: WasteShortfallReason | null;
  pointsAwarded: number;
  drops: number;
}

const STALE_REQUEST = 'Khách vừa sửa yêu cầu, vui lòng tra lại mã';
const RECEIVED_OUT_OF_RANGE = 'Số thực nhận phải là số nguyên từ 0 tới số khai';
const SHORT_NEEDS_REASON = 'Dòng nhận thiếu phải có lý do';

/**
 * Checks the desk's confirm body against the lines stored on the request (spec 15.5 step 5). The rates come from the
 * stored snapshot, never from the catalogue, so a later rate change cannot alter what the customer was promised.
 * Pure: totals and the grant ceiling are checked by the caller.
 */
export function validateConfirmLines(stored: ReadonlyArray<WasteStoredLine>, body: ReadonlyArray<WasteConfirmLineInput>): WasteValidatedLine[] {
  if (body.length !== stored.length) throw new ConflictException(STALE_REQUEST);
  const byItem = new Map<string, WasteConfirmLineInput>();
  for (const b of body) {
    if (byItem.has(b.itemId)) throw new ConflictException(STALE_REQUEST);
    byItem.set(b.itemId, b);
  }
  for (const s of stored) {
    const b = byItem.get(s.itemId);
    if (!b || b.declaredQty !== s.declaredQty) throw new ConflictException(STALE_REQUEST);
  }

  return stored.map((s) => {
    const b = byItem.get(s.itemId) as WasteConfirmLineInput;
    const received = b.receivedQty;
    if (!Number.isInteger(received) || received < 0 || received > s.declaredQty) throw new BadRequestException(RECEIVED_OUT_OF_RANGE);
    const short = received < s.declaredQty;
    if (short && !b.shortfallReason) throw new BadRequestException(SHORT_NEEDS_REASON);
    return {
      lineId: s.id,
      itemId: s.itemId,
      declaredQty: s.declaredQty,
      receivedQty: received,
      shortfallReason: short ? (b.shortfallReason as WasteShortfallReason) : null,
      pointsAwarded: linePoints(received, s),
      drops: lineDrops(received, s),
    };
  });
}
