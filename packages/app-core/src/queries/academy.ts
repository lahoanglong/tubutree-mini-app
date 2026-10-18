import type { HttpClient } from '../http';
import { fetchCourse, fetchCourses } from '../api/academy';

export const academyCoursesQuery = (http: HttpClient) => ({
  queryKey: ['academy-courses'] as const,
  queryFn: () => fetchCourses(http),
});
export const academyCourseQuery = (http: HttpClient, courseId: string) => ({
  queryKey: ['academy-course', courseId] as const,
  queryFn: () => fetchCourse(http, courseId),
});
