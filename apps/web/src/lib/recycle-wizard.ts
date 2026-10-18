import type { WasteLineInput, WasteMethod, WastePointDTO } from '@tubutree/shared-types';
import { safeReturnPath } from './return-to';

export type WasteWizardDraft = {
  lines: Record<string, number>;
  method: WasteMethod | null;
  pointId: string | null;
  pickedPoint: WastePointDTO | null;
  provinceCode: string | null;
};
export type WastePointsNav = { returnTo: string; draft: WasteWizardDraft; selectedItemIds: string[] };

export const EMPTY_DRAFT: WasteWizardDraft = { lines: {}, method: null, pointId: null, pickedPoint: null, provinceCode: null };

// Mini App giữ nháp trong navigation state; web không có thứ tương đương qua nạp lại trang nên dùng sessionStorage
// (sống trong tab, mất khi đóng tab, không lẫn giữa các tab).
const DRAFT_KEY = 'tubu_recycle_draft';
const NAV_KEY = 'tubu_recycle_points_nav';
const RETURN_KEY = 'tubu_recycle_points_return';
const RESUME_KEY = 'tubu_recycle_resume';
const METHODS: readonly string[] = ['DROP_OFF', 'MAIL_IN', 'PICKUP'];

const codeUnitCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function toLineInputs(lines: Record<string, number>): WasteLineInput[] {
  return Object.entries(lines)
    .filter(([, qty]) => qty > 0)
    .map(([itemId, declaredQty]) => ({ itemId, declaredQty }))
    .sort((a, b) => codeUnitCompare(a.itemId, b.itemId));
}

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    store()?.setItem(key, JSON.stringify(value));
  } catch {
    /* không có storage thì mất nháp khi nạp lại trang, bước đi tiếp vẫn chạy */
  }
}

function read(key: string): unknown {
  try {
    const raw = store()?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function remove(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    /* không có storage thì không có gì để xoá */
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseDraft(v: unknown): WasteWizardDraft | null {
  if (!isRecord(v) || !isRecord(v.lines)) return null;
  const lines: Record<string, number> = {};
  for (const [id, qty] of Object.entries(v.lines)) {
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 0) return null;
    lines[id] = qty;
  }
  if (v.method !== null && !(typeof v.method === 'string' && METHODS.includes(v.method))) return null;
  if (v.pointId !== null && typeof v.pointId !== 'string') return null;
  if (v.provinceCode !== null && typeof v.provinceCode !== 'string') return null;
  if (v.pickedPoint !== null && !isRecord(v.pickedPoint)) return null;
  return {
    lines,
    method: v.method as WasteMethod | null,
    pointId: v.pointId as string | null,
    pickedPoint: v.pickedPoint as WastePointDTO | null,
    provinceCode: v.provinceCode as string | null,
  };
}

export const loadDraft = (): WasteWizardDraft | null => parseDraft(read(DRAFT_KEY));
export const saveDraft = (draft: WasteWizardDraft): void => write(DRAFT_KEY, draft);
export const clearDraft = (): void => remove(DRAFT_KEY);

/** Cờ "đang đi trong wizard": chỉ khi có cờ mới nạp lại nháp, để vào mới từ trang chủ luôn bắt đầu rỗng như Mini App. */
export const markResume = (): void => write(RESUME_KEY, true);
export const peekResume = (): boolean => read(RESUME_KEY) === true;
export function takeResume(): boolean {
  const on = peekResume();
  remove(RESUME_KEY);
  return on;
}
export const clearPointsNav = (): void => remove(NAV_KEY);
export function clearWizardStorage(): void {
  [DRAFT_KEY, NAV_KEY, RETURN_KEY, RESUME_KEY].forEach(remove);
}

export function savePointsNav(nav: WastePointsNav): void {
  const returnTo = safeReturnPath(nav.returnTo);
  if (!returnTo) {
    remove(NAV_KEY);
    return;
  }
  write(NAV_KEY, { ...nav, returnTo });
}

export function loadPointsNav(): WastePointsNav | null {
  const v = read(NAV_KEY);
  if (!isRecord(v) || typeof v.returnTo !== 'string') return null;
  const returnTo = safeReturnPath(v.returnTo);
  const draft = parseDraft(v.draft);
  if (!returnTo || !draft) return null;
  if (!Array.isArray(v.selectedItemIds) || !v.selectedItemIds.every((x) => typeof x === 'string')) return null;
  return { returnTo, draft, selectedItemIds: v.selectedItemIds as string[] };
}

export const saveReturn = (draft: WasteWizardDraft): void => write(RETURN_KEY, draft);

/** Nháp trang chọn điểm trả về; đọc xong xoá để nạp lại trang không áp lần hai. */
export function takeReturn(): WasteWizardDraft | null {
  const draft = parseDraft(read(RETURN_KEY));
  remove(RETURN_KEY);
  return draft;
}
