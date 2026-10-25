/**
 * Gợi ý bố cục Trang chủ cho khách đã có phiên: trình duyệt ghi cookie `tubu_home_hint` cùng lúc với cờ phiên, middleware đọc để chọn bản ISR
 * dựng sẵn đúng khung chờ (thẻ thành viên, Việc cần làm, Mua lại) ngay trong HTML đầu, nhờ vậy Danh mục không nhảy khi JS tải xong.
 * Module thuần (không 'use client', không đụng window) vì middleware chạy ở edge.
 */
import type { HomeCustomerKind } from '@tubutree/app-core/home-layout';

export const SESSION_COOKIE = 'tubu_web_session';
export const HOME_HINT_COOKIE = 'tubu_home_hint';

export interface HomeRestoreHint {
  /** Loại khách nhớ lần trước trên máy; 'unknown' khi chưa nhớ (khung chờ trung tính, không dựng bố cục khách mới). */
  kind: HomeCustomerKind | 'unknown';
  /** Số dòng "Việc cần làm" lần trước (0, 1 hoặc 2); chỉ có nghĩa với khách cũ. */
  rows: 0 | 1 | 2;
}

export const HOME_HINT_SLUGS = ['unknown', 'new', 'returning-0', 'returning-1', 'returning-2'] as const;
export type HomeHintSlug = (typeof HOME_HINT_SLUGS)[number];

export function hintSlug(hint: HomeRestoreHint): HomeHintSlug {
  if (hint.kind === 'returning') return `returning-${hint.rows}`;
  return hint.kind;
}

/** Slug lạ hoặc thiếu thì 'unknown': cookie là dữ liệu của trình duyệt nên không tin. */
export function parseHintSlug(raw: string | null | undefined): HomeHintSlug {
  return (HOME_HINT_SLUGS as readonly string[]).includes(raw ?? '') ? (raw as HomeHintSlug) : 'unknown';
}

export function hintOfSlug(slug: HomeHintSlug): HomeRestoreHint {
  if (slug === 'new' || slug === 'unknown') return { kind: slug, rows: 0 };
  return { kind: 'returning', rows: Number(slug.slice('returning-'.length)) as 0 | 1 | 2 };
}
