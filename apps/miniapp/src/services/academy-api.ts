import { api } from './api';

export interface AcademyCourseSummary {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  sortOrder: number;
  isPublished: boolean;
  lessonCount: number;
  completedCount: number;
  isCompleted: boolean;
}

export type AcademyLessonContentType = 'VIDEO' | 'ARTICLE';

export interface AcademyLesson {
  id: string;
  courseId: string;
  title: string;
  contentType: AcademyLessonContentType;
  videoUrl: string | null;
  body: string | null;
  sortOrder: number;
}

export interface AcademyCourseDetail {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  isPublished: boolean;
  lessons: AcademyLesson[];
  completedLessonIds: string[];
}

export const fetchCourses = () => api.get<AcademyCourseSummary[]>('/academy/courses').then((r) => r.data);

export const fetchCourse = (id: string) =>
  api.get<AcademyCourseDetail>(`/academy/courses/${id}`).then((r) => r.data);

export const completeLesson = (lessonId: string) =>
  api.post<{ ok: boolean }>(`/academy/lessons/${lessonId}/complete`).then((r) => r.data);
