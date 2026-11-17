import type { Page } from '@playwright/test';

const keyOf = (name: string) => `\\"${name}\\":`;
const UNDEFINED_VALUE = '\\"$undefined\\"';

/** Hết giá trị mảng hoặc đối tượng bắt đầu tại `start` (chỉ số của `[` hoặc `{`), tính theo dạng JSON nằm trong chuỗi JS của script `self.__next_f.push`: ngoặc nằm trong chuỗi bị bỏ qua. */
function valueEnd(html: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '\\') {
      let j = i;
      while (html[j] === '\\') j += 1;
      // Dấu nháy mở/đóng chuỗi JSON nằm trong chuỗi JS là `\"`; dấu nháy nằm TRONG chuỗi JSON là `\\\"`.
      if (html[j] === '"' && j - i === 1) inString = !inString;
      i = html[j] === '"' ? j : j - 1;
      continue;
    }
    if (ch === '<' && html.startsWith('</script>', i)) throw new Error('giá trị cần gỡ bị cắt giữa hai đoạn dữ liệu RSC: đổi cách gỡ trong support/server-initial.ts');
    if (inString) continue;
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('không tìm thấy chỗ kết thúc giá trị cần gỡ trong HTML');
}

/**
 * Gỡ `initial.<name>` khỏi dữ liệu RSC mà server nhúng trong HTML (đổi thành `undefined`, đúng như lúc API đó lỗi khi server dựng trang).
 * `found` là số lần thấy khoá: 0 nghĩa là trang không còn truyền giá trị đó, hoặc dạng nhúng đã đổi.
 */
export function dropServerKey(html: string, name: string): { html: string; found: number } {
  const key = keyOf(name);
  let out = html;
  let found = 0;
  for (let from = 0; ; ) {
    const at = out.indexOf(key, from);
    if (at < 0) break;
    found += 1;
    const start = at + key.length;
    if (out[start] === '[' || out[start] === '{') {
      out = out.slice(0, start) + UNDEFINED_VALUE + out.slice(valueEnd(out, start));
    }
    from = start + 1;
  }
  return { html: out, found };
}

export const dropServerCampaigns = (html: string) => dropServerKey(html, 'campaigns');

/**
 * Trang chủ web được server dựng sẵn cùng danh sách chiến dịch (API thật trả mảng, kể cả rỗng) nên trình duyệt không hỏi lại, và spec đo banner về muộn
 * không còn gì để đo. Chặn tài liệu `/` để gỡ danh sách đó: trình duyệt phải tự hỏi `/campaigns`, như khi server dựng mà API chiến dịch lỗi. Trả về số lần
 * đã thấy khoá `campaigns` (spec khẳng định > 0 để đổi dạng nhúng thì spec đỏ chứ không lặng lẽ không đo gì).
 */
export async function serverWithoutCampaigns(page: Page, { alsoDrop = [] }: { alsoDrop?: string[] } = {}): Promise<{ found: () => number; foundAlso: () => number }> {
  let found = 0;
  let foundAlso = 0;
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      const rewritten = dropServerCampaigns(await response.text());
      found = rewritten.found;
      let html = rewritten.html;
      for (const name of alsoDrop) {
        const extra = dropServerKey(html, name);
        html = extra.html;
        foundAlso += extra.found;
      }
      const headers: Record<string, string> = { ...response.headers(), 'content-length': String(Buffer.byteLength(html)) };
      delete headers['content-encoding'];
      return route.fulfill({ response, headers, body: html });
    },
  );
  return { found: () => found, foundAlso: () => foundAlso };
}
