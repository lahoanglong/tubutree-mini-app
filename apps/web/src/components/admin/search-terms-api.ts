'use client';

import { apiFetch } from '@/lib/client-api';

/** Một dòng của `GET /admin/search-synonyms` (`SearchSynonymRow` ở `apps/api/src/modules/catalog/search-match.service.ts`). */
export interface SearchSynonym {
  id: string;
  term: string;
  canonical: string;
  isActive: boolean;
  updatedAt: string;
}

/** Trần mỗi vế (`@MaxLength(60)` của `CreateSearchSynonymDto`). */
export const SYNONYM_FIELD_MAX = 60;
/** Luật của `catalog.search_popular_terms` (`assertPopularTerms` ở admin-config-rules: tối đa 12 cụm, mỗi cụm 2–40 ký tự). */
export const POPULAR_TERMS_KEY = 'catalog.search_popular_terms';
export const POPULAR_TERMS_MAX = 12;
export const POPULAR_TERM_MAX_CHARS = 40;

const BASE = '/admin/search-synonyms';

export const listSynonyms = () => apiFetch<{ items: SearchSynonym[] }>(BASE).then((r) => r.items);

/** Một dòng của `GET /admin/search-synonyms/zero-results` (`ZeroResultTerm` ở `apps/api/src/modules/catalog/search-synonyms-zero-results.service.ts`). */
export interface ZeroResultTerm {
  term: string;
  count: number;
  people: number;
  lastSeenAt: string;
  synonym: { canonical: string; isActive: boolean } | null;
  /** Cụm tìm thay gợi ý: chạm một cụm là tạo từ đồng nghĩa ngay. */
  suggestions: string[];
}
/** Khung ngày của thẻ "Từ khoá tìm chưa ra" (API nhận 1..90, mặc định cũng 14). */
export const ZERO_RESULT_DAYS = 14;
/** Dòng thiếu cụm thì bỏ, không vẽ dòng trống có nút tạo. API cũ chưa gửi `suggestions` thì coi như không có gợi ý. */
export const listZeroResultTerms = () =>
  apiFetch<{ items?: unknown }>(`${BASE}/zero-results?days=${ZERO_RESULT_DAYS}`).then((r) =>
    Array.isArray(r.items)
      ? r.items
          .filter((t): t is ZeroResultTerm => typeof (t as ZeroResultTerm | null)?.term === 'string' && (t as ZeroResultTerm).term !== '')
          .map((t) => ({ ...t, suggestions: Array.isArray(t.suggestions) ? t.suggestions.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [] }))
      : [],
  );
export const createSynonym = (body: { term: string; canonical: string }) => apiFetch<SearchSynonym>(BASE, { method: 'POST', body });
export const updateSynonym = (id: string, body: { canonical?: string; isActive?: boolean }) =>
  apiFetch<SearchSynonym>(`${BASE}/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const removeSynonym = (id: string) => apiFetch<{ ok: true }>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });

export async function readPopularTerms(): Promise<string[]> {
  const rows = await apiFetch<{ key: string; value: unknown }[]>('/admin/config?category=catalog');
  const v = rows.find((r) => r.key === POPULAR_TERMS_KEY)?.value;
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
}

export const savePopularTerms = (terms: string[]) => apiFetch('/admin/config', { method: 'PUT', body: { key: POPULAR_TERMS_KEY, value: terms } });

/** Ô nhiều dòng → danh sách cụm: mỗi dòng một cụm, bỏ dòng trống, gộp dấu cách, bỏ cụm trùng (giữ thứ tự). */
export function parsePopularTerms(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim().replace(/\s+/g, ' ');
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Lỗi báo ngay ở form; máy chủ kiểm lại cùng luật nên đây chỉ để khỏi gửi một lần hỏng. */
export function popularTermsError(terms: string[]): string | null {
  if (terms.length > POPULAR_TERMS_MAX) return `Tối đa ${POPULAR_TERMS_MAX} cụm (đang có ${terms.length}).`;
  const bad = terms.find((t) => t.length < 2 || t.length > POPULAR_TERM_MAX_CHARS);
  if (bad) return `Mỗi cụm từ 2 tới ${POPULAR_TERM_MAX_CHARS} ký tự: "${bad}".`;
  if (terms.some((t) => t.includes('@') || /\d{6,}/.test(t.replace(/[\s.\-()+]/g, '')))) return 'Không ghi email hay dãy số dài (số điện thoại).';
  return null;
}
