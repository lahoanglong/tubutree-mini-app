'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, FileText, PlayCircle } from 'lucide-react';
import { completeLesson, type AcademyCourseDetail } from '@tubutree/app-core/api/academy';
import { academyCourseQuery } from '@tubutree/app-core/queries/academy';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { AcademyAuthGate } from '../academy-auth';
import { CtvOnlyNotice, errorText } from '../course-list';
import { errorStatus } from '@tubutree/app-core/api/error-status';
import { isAuthError } from '@/lib/friendly-error';
import Link from 'next/link';
import { miniBtnSecondary, miniCard } from '@/components/loyalty/mini-surface';

/** Link video do quản trị nhập: chỉ http(s), `javascript:` và các scheme khác không được thành href. */
const safeVideoUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);

function CourseBody({
  course,
  onComplete,
  completingId,
}: {
  course: AcademyCourseDetail;
  onComplete: (lessonId: string) => void;
  completingId: string | undefined;
}) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-stone-900 max-md:text-[length:var(--type-title-md-size)] max-md:leading-[var(--type-title-md-lh)]">{course.title}</h2>
      {course.description && <p className="mt-1 text-sm text-stone-700">{course.description}</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {course.lessons.map((lesson, i) => {
          const done = course.completedLessonIds.includes(lesson.id);
          const video = lesson.contentType === 'VIDEO' ? safeVideoUrl(lesson.videoUrl) : null;
          const locked = done || (completingId !== undefined && completingId !== lesson.id);
          return (
            <section key={lesson.id} className={`${miniCard} flex flex-col p-3`}>
              <div className="flex items-center gap-2">
                {lesson.contentType === 'VIDEO' ? (
                  <PlayCircle className="h-5 w-5 shrink-0 text-forest-600" aria-hidden="true" />
                ) : (
                  <FileText className="h-5 w-5 shrink-0 text-forest-600" aria-hidden="true" />
                )}
                <h3 className="flex-1 text-base font-semibold text-stone-900">{`${i + 1}. ${lesson.title}`}</h3>
                {done && <CheckCircle2 className="h-5 w-5 shrink-0 text-forest-600" aria-label="Đã học" role="img" />}
              </div>
              {video && (
                <a href={video} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-forest-700 underline max-md:no-underline">
                  Mở video bài học
                </a>
              )}
              {lesson.contentType === 'ARTICLE' && lesson.body && <div className="mt-2 whitespace-pre-line break-words text-sm text-stone-700">{lesson.body}</div>}
              <button
                type="button"
                disabled={locked || completingId === lesson.id}
                aria-busy={completingId === lesson.id}
                onClick={() => onComplete(lesson.id)}
                className={`${done ? miniBtnSecondary : ui.btnPrimary} mt-3 gap-1.5 self-start`}
              >
                {done && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                {done ? 'Đã học xong' : 'Đánh dấu đã học'}
              </button>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const q = useQuery(academyCourseQuery(coreHttp, courseId));
  const complete = useMutation({
    mutationFn: (lessonId: string) => completeLesson(coreHttp, lessonId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['academy-course', courseId] });
      void qc.invalidateQueries({ queryKey: ['academy-courses'] });
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="max-md:hidden">
        {/* Điện thoại đã có nút lùi của trang, như Mini App; nút này chỉ cho máy tính. */}
        <Link href="/hoc-vien" className={ui.backLink}>
          <ChevronLeft className="mr-0.5 h-4 w-4" aria-hidden="true" />
          Danh sách khoá học
        </Link>
      </div>
      {complete.isSuccess && (
        <p role="status" className="rounded-control bg-forest-50 px-3 py-2 text-sm text-forest-800">
          Đã đánh dấu hoàn thành bài học! 🎉
        </p>
      )}
      {complete.isError && (
        <p role="alert" className={`rounded-control bg-danger-bg px-3 py-2 ${ui.error}`}>
          {errorText(complete.error)}
        </p>
      )}
      {q.isLoading ? (
        <Skeleton height={200} rounded="rounded-card" />
      ) : q.isError && errorStatus(q.error) === 403 ? (
        <CtvOnlyNotice />
      ) : q.isError ? (
        <ErrorState message={errorText(q.error)} onRetry={isAuthError(q.error) ? undefined : () => void q.refetch()} />
      ) : q.data ? (
        <CourseBody course={q.data} onComplete={(id) => complete.mutate(id)} completingId={complete.isPending ? complete.variables : undefined} />
      ) : null}
    </div>
  );
}

/** Chi tiết khoá học (cùng nội dung `academy.tsx` của Mini App): bài đánh số, video mở link, bài viết hiện nội dung, đánh dấu đã học. */
export function CourseDetailView({ courseId }: { courseId: string }) {
  return <AcademyAuthGate returnTo={`/hoc-vien/${encodeURIComponent(courseId)}`}><Detail courseId={courseId} /></AcademyAuthGate>;
}
