import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

export interface CreateFaqInput {
  category?: string;
  question: string;
  answer: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface UpdateFaqInput {
  category?: string;
  question?: string;
  answer?: string;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * FAQ/câu trả lời nhanh CSKH: admin quản lý nội dung, đồng thời nạp vào ngữ cảnh
 * của AI tư vấn (§ AiAdvisorService) để trả lời nhất quán các câu hỏi thường gặp.
 */
@Injectable()
export class FaqService {
  constructor(private readonly prisma: PrismaService) {}

  /** Entry đang bật, sắp theo sortOrder — dùng cho AI tư vấn + trang công khai. */
  listActive() {
    return this.prisma.faqEntry.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Admin: toàn bộ entry (gồm cả đang tắt). */
  listAll() {
    return this.prisma.faqEntry.findMany({
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
    });
  }

  create(dto: CreateFaqInput) {
    return this.prisma.faqEntry.create({
      data: {
        category: dto.category ?? null,
        question: dto.question,
        answer: dto.answer,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  update(id: string, dto: UpdateFaqInput) {
    return this.prisma.faqEntry.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.prisma.faqEntry.delete({ where: { id } });
    return { ok: true };
  }
}
