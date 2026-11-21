import { parseRichText, type RichBlock, type RichInline } from '@tubutree/app-core/rich-text';

const MAX_ITEMS = 10;
const QUESTION_END = /[?？]$/;

const inlineText = (inlines: readonly RichInline[]) => inlines.map((x) => x.text).join('').replace(/\s+/g, ' ').trim();

/** Tiêu đề (h1–h6) hoặc đoạn mà mọi chữ đều in đậm: cách mô tả Pancake/WordPress đánh dấu một mục. */
function isHeadingLike(b: RichBlock): b is Extract<RichBlock, { inlines: RichInline[] }> {
  if (b.kind === 'h') return true;
  if (b.kind !== 'p') return false;
  const visible = b.inlines.filter((x) => x.text.trim() !== '');
  return visible.length > 0 && visible.every((x) => x.bold);
}

function blockText(b: RichBlock): string {
  if ('items' in b) return b.items.map((it) => inlineText(it)).filter(Boolean).map((t) => `• ${t}`).join('\n');
  return inlineText(b.inlines);
}

/**
 * Cặp hỏi–đáp mà chính mô tả sản phẩm đã viết sẵn, để khai FAQPage đúng chữ khách đọc được ở khối "Mô tả sản phẩm" (cùng `parseRichText` với
 * phần hiển thị). Câu hỏi là một tiêu đề, hoặc đoạn in đậm trọn vẹn, kết thúc bằng dấu hỏi; câu trả lời là các khối sau nó tới mục kế tiếp.
 * Không dựng câu hỏi từ tiêu đề thường ("Hướng dẫn sử dụng"): câu hỏi phải có nguyên văn trên trang. Câu hỏi không có trả lời thì bỏ.
 */
export function productFaqItems(description: string | null | undefined): { q: string; a: string }[] {
  const blocks = parseRichText(description);
  const out: { q: string; a: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < blocks.length && out.length < MAX_ITEMS; i++) {
    const head = blocks[i]!;
    if (!isHeadingLike(head)) continue;
    const q = inlineText(head.inlines);
    if (!QUESTION_END.test(q)) continue;
    const answer: string[] = [];
    let j = i + 1;
    for (; j < blocks.length && !isHeadingLike(blocks[j]!); j++) {
      const text = blockText(blocks[j]!);
      if (text) answer.push(text);
    }
    i = j - 1;
    const a = answer.join('\n').trim();
    if (!a || seen.has(q)) continue;
    seen.add(q);
    out.push({ q, a });
  }
  return out;
}
