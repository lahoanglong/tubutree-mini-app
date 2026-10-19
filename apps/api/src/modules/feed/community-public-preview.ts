import { authorBadge } from './author-badge';

/** Cờ SystemConfig bật xem trước công khai; chỉ boolean true thật mới bật, mặc định bật. */
export const PUBLIC_PREVIEW_KEY = 'community.public_preview';
export const PUBLIC_PREVIEW_DEFAULT = true;

/** Số bài cho khách chưa đăng nhập xem thử: đủ để thấy cộng đồng có người, không thay cho việc đăng nhập để đọc tiếp. */
export const PUBLIC_PREVIEW_POSTS = 5;

/** Chỉ bài do người dùng viết: bài tự sinh (thu hoạch, mốc, loài) mang `meta` về vườn riêng của từng người. */
export const PUBLIC_PREVIEW_KINDS = ['MANUAL', 'QUESTION', 'SHOWCASE', 'TIP'] as const;

const SNIPPET_MAX = 160;
const ANONYMOUS_AUTHOR = 'Bạn Tubu';
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE = /\+?\d[\d .-]{7,}\d/g;

/**
 * Tên hiển thị cho người chưa đăng nhập: chỉ tên gọi (từ cuối của họ tên), không lộ họ tên đầy đủ. Tên có số hoặc "@"
 * (người dùng gõ số điện thoại/email làm tên) thì dùng tên chung.
 */
export function publicAuthorName(fullName: string | null | undefined): string {
  const name = fullName?.trim() ?? '';
  if (!name || /[\d@]/.test(name)) return ANONYMOUS_AUTHOR;
  return name.split(/\s+/).at(-1) ?? ANONYMOUS_AUTHOR;
}

function redactContact(text: string): string {
  return text.replace(EMAIL, '…').replace(PHONE, '…').replace(/\s+/g, ' ').trim();
}

/** Đoạn đầu bài: che số điện thoại/email người dùng tự gõ, gộp xuống dòng, cắt gọn. */
export function publicSnippet(body: string): string {
  const flat = redactContact(body);
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}…` : flat;
}

/** Tiêu đề do người dùng tự gõ nên che số điện thoại/email như đoạn đầu bài; không có tiêu đề thì null. */
export function publicTitle(title: string | null | undefined): string | null {
  return redactContact(title ?? '') || null;
}

interface PreviewRow {
  id: string;
  kind: string;
  title: string | null;
  body: string;
  isPinned: boolean;
  createdAt: Date;
  user: { fullName: string | null; role: string };
  category: { slug: string; name: string; icon: string | null } | null;
}

/** Trường công khai của một bài xem trước, dựng từ danh sách trường cho phép chứ không lọc bớt từ bản đầy đủ. */
export function toPublicPreviewItem(row: PreviewRow, counts: { likes: number; comments: number }, image: string | null) {
  return {
    id: row.id,
    kind: row.kind,
    title: publicTitle(row.title),
    snippet: publicSnippet(row.body),
    image,
    createdAt: row.createdAt,
    author: publicAuthorName(row.user.fullName),
    badge: authorBadge(row.user.role),
    category: row.category ? { slug: row.category.slug, name: row.category.name, icon: row.category.icon } : null,
    isPinned: row.isPinned,
    likeCount: counts.likes,
    commentCount: counts.comments,
  };
}
