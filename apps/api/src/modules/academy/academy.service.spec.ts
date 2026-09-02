import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { AcademyService } from './academy.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    course: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    lesson: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    userLessonProgress: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
    ...overrides,
  } as unknown as PrismaService;
}

describe('AcademyService.listCourses', () => {
  it('chỉ lấy course isPublished=true, sắp theo sortOrder tăng dần', async () => {
    const prisma = makePrisma();
    const svc = new AcademyService(prisma);
    await svc.listCourses('u1');
    expect((prisma as any).course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isPublished: true },
        orderBy: expect.arrayContaining([{ sortOrder: 'asc' }]),
      }),
    );
  });

  it('trả lessonCount + completedCount đúng theo tiến độ user', async () => {
    const prisma = makePrisma();
    (prisma as any).course.findMany.mockResolvedValue([
      { id: 'c1', title: 'Khoá 1', lessons: [{ id: 'l1' }, { id: 'l2' }] },
      { id: 'c2', title: 'Khoá 2', lessons: [{ id: 'l3' }] },
    ]);
    (prisma as any).userLessonProgress.findMany.mockResolvedValue([{ lessonId: 'l1' }]);

    const svc = new AcademyService(prisma);
    const out = await svc.listCourses('u1');

    expect(out).toEqual([
      { id: 'c1', title: 'Khoá 1', lessonCount: 2, completedCount: 1, isCompleted: false },
      { id: 'c2', title: 'Khoá 2', lessonCount: 1, completedCount: 0, isCompleted: false },
    ]);
  });

  it('isCompleted=true khi completedCount===lessonCount và lessonCount>0', async () => {
    const prisma = makePrisma();
    (prisma as any).course.findMany.mockResolvedValue([
      { id: 'c1', title: 'Khoá 1', lessons: [{ id: 'l1' }, { id: 'l2' }] },
    ]);
    (prisma as any).userLessonProgress.findMany.mockResolvedValue([{ lessonId: 'l1' }, { lessonId: 'l2' }]);

    const svc = new AcademyService(prisma);
    const out = await svc.listCourses('u1');

    expect(out[0]).toMatchObject({ completedCount: 2, lessonCount: 2, isCompleted: true });
  });

  it('course không có bài học nào → isCompleted=false dù completedCount===lessonCount===0', async () => {
    const prisma = makePrisma();
    (prisma as any).course.findMany.mockResolvedValue([{ id: 'c1', title: 'Khoá rỗng', lessons: [] }]);

    const svc = new AcademyService(prisma);
    const out = await svc.listCourses('u1');

    expect(out[0]).toMatchObject({ lessonCount: 0, completedCount: 0, isCompleted: false });
  });
});

describe('AcademyService.getCourse', () => {
  it('trả course + lessons (sắp theo sortOrder) + danh sách lessonId đã hoàn thành của user', async () => {
    const prisma = makePrisma();
    (prisma as any).course.findUnique.mockResolvedValue({
      id: 'c1',
      title: 'Khoá 1',
      isPublished: true,
      lessons: [
        { id: 'l1', title: 'Bài 1', sortOrder: 0 },
        { id: 'l2', title: 'Bài 2', sortOrder: 1 },
      ],
    });
    (prisma as any).userLessonProgress.findMany.mockResolvedValue([{ lessonId: 'l1' }]);

    const svc = new AcademyService(prisma);
    const out = await svc.getCourse('u1', 'c1');

    expect((prisma as any).course.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        include: { lessons: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      }),
    );
    expect(out.id).toBe('c1');
    expect(out.lessons).toHaveLength(2);
    expect(out.completedLessonIds).toEqual(['l1']);
  });

  it('course chưa publish + không phải admin → NotFoundException', async () => {
    const prisma = makePrisma();
    (prisma as any).course.findUnique.mockResolvedValue({
      id: 'c1',
      title: 'Khoá nháp',
      isPublished: false,
      lessons: [],
    });

    const svc = new AcademyService(prisma);
    await expect(svc.getCourse('u1', 'c1')).rejects.toThrow(NotFoundException);
  });

  it('course chưa publish nhưng isAdmin=true → vẫn trả về được', async () => {
    const prisma = makePrisma();
    (prisma as any).course.findUnique.mockResolvedValue({
      id: 'c1',
      title: 'Khoá nháp',
      isPublished: false,
      lessons: [],
    });

    const svc = new AcademyService(prisma);
    await expect(svc.getCourse('u1', 'c1', true)).resolves.toMatchObject({ id: 'c1' });
  });

  it('course không tồn tại → NotFoundException', async () => {
    const prisma = makePrisma();
    (prisma as any).course.findUnique.mockResolvedValue(null);

    const svc = new AcademyService(prisma);
    await expect(svc.getCourse('u1', 'khong-ton-tai')).rejects.toThrow(NotFoundException);
  });
});

describe('AcademyService.completeLesson', () => {
  it('upsert UserLessonProgress theo unique [userId, lessonId], trả {ok:true}', async () => {
    const prisma = makePrisma();
    (prisma as any).userLessonProgress.upsert.mockResolvedValue({ id: 'p1' });

    const svc = new AcademyService(prisma);
    const out = await svc.completeLesson('u1', 'l1');

    expect((prisma as any).userLessonProgress.upsert).toHaveBeenCalledWith({
      where: { userId_lessonId: { userId: 'u1', lessonId: 'l1' } },
      create: { userId: 'u1', lessonId: 'l1' },
      update: {},
    });
    expect(out).toEqual({ ok: true });
  });

  it('gọi lại lần 2 (đã hoàn thành trước đó) vẫn trả {ok:true}, không lỗi', async () => {
    const prisma = makePrisma();
    (prisma as any).userLessonProgress.upsert.mockResolvedValue({ id: 'p1' });

    const svc = new AcademyService(prisma);
    await svc.completeLesson('u1', 'l1');
    const out = await svc.completeLesson('u1', 'l1');

    expect(out).toEqual({ ok: true });
    expect((prisma as any).userLessonProgress.upsert).toHaveBeenCalledTimes(2);
  });
});

describe('AcademyService.adminListCourses', () => {
  it('lấy tất cả course (gồm cả chưa publish), kèm lessons sắp theo sortOrder', async () => {
    const prisma = makePrisma();
    const svc = new AcademyService(prisma);
    await svc.adminListCourses();

    expect((prisma as any).course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { lessons: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      }),
    );
    const call = (prisma as any).course.findMany.mock.calls[0][0];
    expect(call.where).toBeUndefined();
  });
});

describe('AcademyService — admin CRUD course', () => {
  it('createCourse: tạo course mới với default sortOrder=0, isPublished=false', async () => {
    const prisma = makePrisma();
    (prisma as any).course.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', ...data }));
    const svc = new AcademyService(prisma);

    const out = await svc.createCourse({ title: 'Khoá nhập môn' });

    expect((prisma as any).course.create).toHaveBeenCalledWith({
      data: {
        title: 'Khoá nhập môn',
        description: null,
        coverUrl: null,
        sortOrder: 0,
        isPublished: false,
      },
    });
    expect(out.id).toBe('c1');
  });

  it('createCourse: giữ nguyên description/coverUrl/sortOrder/isPublished khi truyền vào', async () => {
    const prisma = makePrisma();
    (prisma as any).course.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', ...data }));
    const svc = new AcademyService(prisma);

    await svc.createCourse({
      title: 'Khoá nâng cao',
      description: 'Mô tả',
      coverUrl: 'https://x/cover.jpg',
      sortOrder: 3,
      isPublished: true,
    });

    expect((prisma as any).course.create).toHaveBeenCalledWith({
      data: {
        title: 'Khoá nâng cao',
        description: 'Mô tả',
        coverUrl: 'https://x/cover.jpg',
        sortOrder: 3,
        isPublished: true,
      },
    });
  });

  it('updateCourse: gọi prisma.course.update với data truyền vào', async () => {
    const prisma = makePrisma();
    (prisma as any).course.update.mockResolvedValue({ id: 'c1', title: 'Mới' });
    const svc = new AcademyService(prisma);

    await svc.updateCourse('c1', { title: 'Mới' });

    expect((prisma as any).course.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { title: 'Mới' } });
  });

  it('deleteCourse: xoá course + trả {ok:true}', async () => {
    const prisma = makePrisma();
    (prisma as any).course.delete.mockResolvedValue({});
    const svc = new AcademyService(prisma);

    const out = await svc.deleteCourse('c1');

    expect((prisma as any).course.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(out).toEqual({ ok: true });
  });
});

describe('AcademyService — admin CRUD lesson', () => {
  it('addLesson: tạo lesson mới trong course với default videoUrl/body=null, sortOrder=0', async () => {
    const prisma = makePrisma();
    (prisma as any).lesson.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'l1', ...data }));
    const svc = new AcademyService(prisma);

    await svc.addLesson('c1', { title: 'Bài 1', contentType: 'ARTICLE' });

    expect((prisma as any).lesson.create).toHaveBeenCalledWith({
      data: {
        courseId: 'c1',
        title: 'Bài 1',
        contentType: 'ARTICLE',
        videoUrl: null,
        body: null,
        sortOrder: 0,
      },
    });
  });

  it('addLesson: giữ nguyên videoUrl/body/sortOrder khi truyền vào', async () => {
    const prisma = makePrisma();
    (prisma as any).lesson.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'l1', ...data }));
    const svc = new AcademyService(prisma);

    await svc.addLesson('c1', {
      title: 'Bài video',
      contentType: 'VIDEO',
      videoUrl: 'https://x/v.mp4',
      sortOrder: 2,
    });

    expect((prisma as any).lesson.create).toHaveBeenCalledWith({
      data: {
        courseId: 'c1',
        title: 'Bài video',
        contentType: 'VIDEO',
        videoUrl: 'https://x/v.mp4',
        body: null,
        sortOrder: 2,
      },
    });
  });

  it('updateLesson: gọi prisma.lesson.update với data truyền vào', async () => {
    const prisma = makePrisma();
    (prisma as any).lesson.update.mockResolvedValue({ id: 'l1', title: 'Mới' });
    const svc = new AcademyService(prisma);

    await svc.updateLesson('l1', { title: 'Mới' });

    expect((prisma as any).lesson.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { title: 'Mới' } });
  });

  it('deleteLesson: xoá lesson + trả {ok:true}', async () => {
    const prisma = makePrisma();
    (prisma as any).lesson.delete.mockResolvedValue({});
    const svc = new AcademyService(prisma);

    const out = await svc.deleteLesson('l1');

    expect((prisma as any).lesson.delete).toHaveBeenCalledWith({ where: { id: 'l1' } });
    expect(out).toEqual({ ok: true });
  });
});
