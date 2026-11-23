'use client';

import type { GuestReorderDTO } from '@tubutree/shared-types';
import { addGuestLine, readGuestCart } from './store';

/** Lời báo cho trang giỏ sau "Mua lại đơn này" ở /don/<mã>: món nào không thêm được và vì sao. Sống trong tab, đọc một lần. */
export const GUEST_REORDER_NOTE_KEY = 'tubu.guestCart.reorderNote';
const NOTE_TTL_MS = 10 * 60_000;
const MAX_NOTED = 30;
const MAX_NAME = 120;

export type GuestReorderSkipReason = 'OUT_OF_STOCK' | 'INACTIVE' | 'NOT_ADDED';
const REASONS: readonly GuestReorderSkipReason[] = ['OUT_OF_STOCK', 'INACTIVE', 'NOT_ADDED'];

export interface GuestReorderNote {
  skipped: { name: string; reason: GuestReorderSkipReason }[];
}

export type GuestReorderOutcome =
  | { kind: 'added'; note: GuestReorderNote | null }
  | { kind: 'none'; note: GuestReorderNote }
  | { kind: 'storage' };

const lineName = (productName: string, variationName: string | null) => (variationName ? `${productName} (${variationName})` : productName);

/**
 * Thêm các món máy chủ cho mua lại vào giỏ khách, kẹp theo tồn kho máy chủ vừa báo. Món đã có đủ số hàng còn trong giỏ vẫn tính là đã có.
 * Món máy chủ bỏ (hết hàng, ngừng bán) và món giỏ không nhận (đủ 30 dòng) vào lời báo. Không món nào vào giỏ thì không sang trang giỏ.
 */
export function addReorderLines(dto: GuestReorderDTO, now: number = Date.now()): GuestReorderOutcome {
  const skipped: GuestReorderNote['skipped'] = dto.skipped.map((s) => ({ name: lineName(s.productName, s.variationName), reason: s.reason }));
  let inCart = 0;
  let storageFailed = 0;
  for (const l of dto.lines) {
    const r = addGuestLine({ variationId: l.variationId, slug: l.slug, quantity: l.quantity, maxQty: l.maxQty }, now);
    if (r.ok || (r.reason === 'max' && readGuestCart().some((g) => g.variationId === l.variationId))) {
      inCart++;
      continue;
    }
    if (!r.ok && r.reason === 'storage') storageFailed++;
    skipped.push({ name: lineName(l.productName, l.variationName), reason: 'NOT_ADDED' });
  }
  if (inCart === 0 && storageFailed > 0) return { kind: 'storage' };
  if (inCart === 0) return { kind: 'none', note: { skipped } };
  return { kind: 'added', note: skipped.length > 0 ? { skipped } : null };
}

function session(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveGuestReorderNote(note: GuestReorderNote, now: number = Date.now()): void {
  try {
    session()?.setItem(GUEST_REORDER_NOTE_KEY, JSON.stringify({ skipped: note.skipped.slice(0, MAX_NOTED), at: now }));
  } catch {
    /* không có bộ nhớ thì trang giỏ không báo, món đã vào giỏ vẫn đúng */
  }
}

/** Đọc rồi xoá lời báo mua lại; quá hạn, hỏng hay rỗng thì null. */
export function takeGuestReorderNote(now: number = Date.now()): GuestReorderNote | null {
  const s = session();
  if (!s) return null;
  try {
    const raw = s.getItem(GUEST_REORDER_NOTE_KEY);
    if (raw === null) return null;
    s.removeItem(GUEST_REORDER_NOTE_KEY);
    const v = JSON.parse(raw) as { skipped?: unknown; at?: unknown };
    if (typeof v.at !== 'number' || now - v.at > NOTE_TTL_MS || now < v.at || !Array.isArray(v.skipped)) return null;
    const skipped = v.skipped
      .flatMap((x: unknown) => {
        const { name, reason } = (x ?? {}) as Record<string, unknown>;
        if (typeof name !== 'string' || !name.trim() || !REASONS.includes(reason as GuestReorderSkipReason)) return [];
        return [{ name: name.trim().slice(0, MAX_NAME), reason: reason as GuestReorderSkipReason }];
      })
      .slice(0, MAX_NOTED);
    return skipped.length > 0 ? { skipped } : null;
  } catch {
    return null;
  }
}
