import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateQuickReplyInput {
  category?: string;
  keywords: string[];
  title: string;
  content: string;
  isGreeting?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}

export interface UpdateQuickReplyInput {
  category?: string;
  keywords?: string[];
  title?: string;
  content?: string;
  isGreeting?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * Kho mẫu tin nhanh CSKH: admin quản lý nội dung, dùng để auto-reply tin khách nhắn vào
 * Zalo OA (§ ZaloOaEventsProcessor) — so khớp từ khoá đơn giản, KHÔNG phải chatbot AI
 * (việc đó là `ai-advisor`).
 */
@Injectable()
export class CskhService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admin: toàn bộ template (gồm cả đang tắt). */
  listAll() {
    return this.prisma.quickReplyTemplate.findMany({
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
    });
  }

  create(dto: CreateQuickReplyInput) {
    return this.prisma.quickReplyTemplate.create({
      data: {
        category: dto.category ?? null,
        keywords: dto.keywords,
        title: dto.title,
        content: dto.content,
        isGreeting: dto.isGreeting ?? false,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  update(id: string, dto: UpdateQuickReplyInput) {
    return this.prisma.quickReplyTemplate.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.prisma.quickReplyTemplate.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * So khớp tin khách gửi với 1 template đang bật (case-insensitive substring theo keywords),
   * ưu tiên sortOrder nhỏ nhất khi có nhiều template khớp. Không xét template dùng làm lời chào.
   */
  async matchTemplate(text: string) {
    if (!text?.trim()) return null;
    const needle = text.toLowerCase();
    const candidates = await this.prisma.quickReplyTemplate.findMany({
      where: { isActive: true, isGreeting: false },
      orderBy: { sortOrder: 'asc' },
    });
    return (
      candidates.find((t) => t.keywords.some((k) => k.trim() && needle.includes(k.toLowerCase()))) ??
      null
    );
  }

  /** Lời chào tự động — bậc sortOrder thấp nhất trong các template isGreeting đang bật. */
  getGreetingTemplate() {
    return this.prisma.quickReplyTemplate.findFirst({
      where: { isActive: true, isGreeting: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
