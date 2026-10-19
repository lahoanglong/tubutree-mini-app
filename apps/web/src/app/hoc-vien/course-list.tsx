'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CheckCircle2 } from 'lucide-react';
import type { AcademyCourseSummary } from '@tubutree/app-core/api/academy';
import { academyCoursesQuery } from '@tubutree/app-core/queries/academy';
import { safeMediaUrl } from '@/components/community/post-parts';
import { ErrorState } from '@/components/ui/error-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { coreHttp } from '@/lib/core-http';
import { ui } from '@/lib/guest-ui';
import { miniCard } from '@/components/loyalty/mini-surface';
import { AcademyAuthGate } from './academy-auth';

export const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Đã có lỗi xảy ra — Vui lòng thử lại');

function CourseCard({ course }: { course: AcademyCourseSummary }) {
  const pct = course.lessonCount > 0 ? Math.round((course.completedCount / course.lessonCount) * 100) : 0;
  const cover = safeMediaUrl(course.coverUrl);
  return (
    <Link href={`/hoc-vien/${encodeURIComponent(course.id)}`} className={`${miniCard} flex min-h-11 items-start gap-3 p-3 transition active:scale-[0.99]`}>
      <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-control bg-forest-50 text-forest-600">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <BookOpen className="h-6 w-6" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-stone-900 max-md:text-[length:var(--type-body-sm-size)]">{course.title}</span>
        {course.description && (
          <span className="block truncate text-sm text-stone-700 max-md:text-[length:var(--type-caption-size)] max-md:text-stone-600">{course.description}</span>
        )}
        <span className="my-2 block">
          <ProgressBar value={pct} max={100} />
        </span>
        {course.isCompleted ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-forest-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Đã hoàn thành
          </span>
        ) : (
          <span className="text-xs text-stone-600">{`${course.completedCount}/${course.lessonCount} bài đã học`}</span>
        )}
      </span>
    </Link>
  );
}

function Courses() {
  const q = useQuery(academyCoursesQuery(coreHttp));
  if (q.isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-2" aria-hidden="true">
        <Skeleton height={92} rounded="rounded-card" />
        <Skeleton height={92} rounded="rounded-card" />
      </div>
    );
  }
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data || q.data.length === 0) {
    return (
      <section className={`${ui.card} p-8 text-center`}>
        <h2 className="font-display text-base font-semibold text-stone-900">Chưa có khoá học nào</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">Tubu sẽ sớm thêm khoá học đào tạo cho CTV.</p>
      </section>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {q.data.map((c) => (
        <CourseCard key={c.id} course={c} />
      ))}
    </div>
  );
}

/** Danh sách khoá học + tiến độ (cùng nội dung `academy.tsx` của Mini App); API chỉ cho người đã đăng nhập. */
export function CourseList() {
  return <AcademyAuthGate returnTo="/hoc-vien"><Courses /></AcademyAuthGate>;
}
