import { Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

export type LessonContentType = 'VIDEO' | 'ARTICLE';

export interface CreateCourseInput {
  title: string;
  description?: string;
  coverUrl?: string;
  sortOrder?: number;
  isPublished?: boolean;
}

export type UpdateCourseInput = Partial<CreateCourseInput>;

export interface CreateLessonInput {
  title: string;
  contentType: LessonContentType;
  videoUrl?: string;
  body?: string;
  sortOrder?: number;
}

export type UpdateLessonInput = Partial<CreateLessonInput>;

/**
 * CTV Academy — khoá học/bài học đào tạo CTV (onboarding/kỹ năng bán hàng),
 * theo dõi tiến độ học theo từng user. Phạm vi hiện tại: courses → lessons →
 * progress (chưa có quiz/chứng chỉ).
 */
@Injectable()
export class AcademyService {
  constructor(private readonly prisma: PrismaService) {}

  /** User: danh sách khoá đang publish, kèm tiến độ học của user. */
  async listCourses(userId: string) {
    const courses = await this.prisma.course.findMany({
      where: { isPublished: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { lessons: { select: { id: true } } },
    });

    const lessonIds = courses.flatMap((c: { lessons: { id: string }[] }) => c.lessons.map((l) => l.id));
    const completedIds = await this.completedLessonIdSet(userId, lessonIds);

    return courses.map((c: { id: string; lessons: { id: string }[]; [k: string]: unknown }) => {
      const { lessons, ...rest } = c;
      const lessonCount = lessons.length;
      const completedCount = lessons.filter((l) => completedIds.has(l.id)).length;
      return {
        ...rest,
        lessonCount,
        completedCount,
        isCompleted: lessonCount > 0 && completedCount === lessonCount,
      };
    });
  }

  /** User (hoặc admin): chi tiết khoá + bài học + các bài user đã hoàn thành. */
  async getCourse(userId: string, courseId: string, isAdmin = false) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { lessons: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!course) throw new NotFoundException('Không tìm thấy khoá học.');
    if (!course.isPublished && !isAdmin) throw new NotFoundException('Không tìm thấy khoá học.');

    const lessonIds = (course.lessons as { id: string }[]).map((l) => l.id);
    const completedIds = await this.completedLessonIdSet(userId, lessonIds);

    return { ...course, completedLessonIds: [...completedIds] };
  }

  /** User: đánh dấu đã học xong 1 bài — idempotent (upsert theo unique [userId, lessonId]). */
  async completeLesson(userId: string, lessonId: string) {
    await this.prisma.userLessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: { userId, lessonId },
      update: {},
    });
    return { ok: true };
  }

  private async completedLessonIdSet(userId: string, lessonIds: string[]): Promise<Set<string>> {
    if (lessonIds.length === 0) return new Set();
    const rows = await this.prisma.userLessonProgress.findMany({
      where: { userId, lessonId: { in: lessonIds } },
      select: { lessonId: true },
    });
    return new Set(rows.map((r: { lessonId: string }) => r.lessonId));
  }

  // ── Admin ────────────────────────────────────────────

  /** Admin: toàn bộ course (gồm cả chưa publish), kèm lessons để quản lý. */
  adminListCourses() {
    return this.prisma.course.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { lessons: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  createCourse(dto: CreateCourseInput) {
    return this.prisma.course.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        coverUrl: dto.coverUrl ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isPublished: dto.isPublished ?? false,
      },
    });
  }

  updateCourse(id: string, dto: UpdateCourseInput) {
    return this.prisma.course.update({ where: { id }, data: dto });
  }

  async deleteCourse(id: string) {
    await this.prisma.course.delete({ where: { id } });
    return { ok: true };
  }

  addLesson(courseId: string, dto: CreateLessonInput) {
    return this.prisma.lesson.create({
      data: {
        courseId,
        title: dto.title,
        contentType: dto.contentType,
        videoUrl: dto.videoUrl ?? null,
        body: dto.body ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  updateLesson(id: string, dto: UpdateLessonInput) {
    return this.prisma.lesson.update({ where: { id }, data: dto });
  }

  async deleteLesson(id: string) {
    await this.prisma.lesson.delete({ where: { id } });
    return { ok: true };
  }
}
