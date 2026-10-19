import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { completeLesson, fetchCourse, fetchCourses } from './academy';

describe('academy — đúng route', () => {
  it('danh sách, chi tiết, hoàn thành bài (POST không body)', async () => {
    const { http, calls } = fakeHttp();
    await fetchCourses(http);
    await fetchCourse(http, 'c1');
    await completeLesson(http, 'l1');
    expect(calls).toEqual([
      { method: 'get', path: '/academy/courses' },
      { method: 'get', path: '/academy/courses/c1' },
      { method: 'post', path: '/academy/lessons/l1/complete' },
    ]);
  });
});
