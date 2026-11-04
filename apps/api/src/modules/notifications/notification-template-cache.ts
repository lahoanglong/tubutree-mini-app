import type { NotificationTemplate } from '@prisma/client';

export const TEMPLATE_CACHE_TTL_MS = 60_000;

type Entry = { tpl: NotificationTemplate | null; at: number };
type Reader = { notificationTemplate: { findUnique: (args: { where: { code: string } }) => Promise<NotificationTemplate | null> } };

// Khoá theo đối tượng prisma: một tiến trình chỉ có một PrismaService nên service gửi tin và service admin sửa mẫu dùng chung
// bộ nhớ đệm, còn mỗi test (prisma giả riêng) có bộ nhớ đệm riêng. Entry lỗi thời nhiều nhất TTL ở tiến trình khác khi chạy nhiều instance.
const stores = new WeakMap<object, Map<string, Entry>>();
// Tăng ở mỗi lần xoá cache: lần đọc DB bắt đầu trước lúc xoá (bản cũ) không được ghi đè lên cache sau đó.
const generations = new WeakMap<object, number>();

function storeOf(prisma: object): Map<string, Entry> {
  let s = stores.get(prisma);
  if (!s) stores.set(prisma, (s = new Map()));
  return s;
}

/** Mẫu thông báo theo mã, đọc DB tối đa một lần mỗi TTL; mẫu thiếu (null) cũng được nhớ để mã sai không đọc DB mỗi lần gửi. */
export async function getTemplateCached(prisma: Reader, code: string, now = Date.now()): Promise<NotificationTemplate | null> {
  const store = storeOf(prisma);
  const hit = store.get(code);
  if (hit && now - hit.at < TEMPLATE_CACHE_TTL_MS) return hit.tpl;
  const gen = generations.get(prisma) ?? 0;
  const tpl = await prisma.notificationTemplate.findUnique({ where: { code } });
  if ((generations.get(prisma) ?? 0) === gen) store.set(code, { tpl, at: now });
  return tpl;
}

export function invalidateTemplateCache(prisma: object, code?: string): void {
  generations.set(prisma, (generations.get(prisma) ?? 0) + 1);
  const store = stores.get(prisma);
  if (!store) return;
  if (code === undefined) store.clear();
  else store.delete(code);
}
