import type { HttpClient } from '../http';

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

export const fetchCourses = (http: HttpClient) =>
  http.get<AcademyCourseSummary[]>('/academy/courses');

export const fetchCourse = (http: HttpClient, id: string) =>
  http.get<AcademyCourseDetail>(`/academy/courses/${id}`);

export const completeLesson = (http: HttpClient, lessonId: string) =>
  http.post<{ ok: boolean }>(`/academy/lessons/${lessonId}/complete`);
