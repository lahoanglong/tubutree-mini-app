import type { SupportChatContext } from '@tubutree/shared-types';

export interface ForwardInput {
  code: string;
  name: string;
  phone: string | null;
  tier: string | null;
  context: SupportChatContext | null;
  items: { body: string; imageUrl: string | null }[];
}

/** Che giữa để nhân viên nhận ra khách mà không lộ đủ số; cần đủ thì tra ở trang admin. */
export function maskPhone(p: string): string {
  if (p.length <= 5) return '•'.repeat(p.length);
  return `${p.slice(0, 2)}${'•'.repeat(p.length - 5)}${p.slice(-3)}`;
}

/** Số ký tự một tin đóng góp vào tin nhóm; processor dùng để cắt ở hạn mức 3.000. */
export function forwardItemLength(item: { body: string; imageUrl: string | null }): number {
  return item.body.length + (item.imageUrl ? `Ảnh: ${item.imageUrl}`.length : 0) + 1;
}

export function formatForward(input: ForwardInput): string {
  const head = [`#${input.code}`, input.name, input.phone ? maskPhone(input.phone) : null, input.tier].filter(Boolean).join(' · ');
  const lines = [head];
  if (input.context?.orderCode) lines.push(`Về đơn ${input.context.orderCode}`);
  else if (input.context?.productSlug) lines.push(`Về sản phẩm ${input.context.productSlug}`);
  lines.push('—');
  for (const item of input.items) {
    if (item.body) lines.push(item.body);
    if (item.imageUrl) lines.push(`Ảnh: ${item.imageUrl}`);
  }
  lines.push(`(Trả lời tin này, hoặc gõ #${input.code} ở đầu câu, để gửi cho khách)`);
  return lines.join('\n');
}
