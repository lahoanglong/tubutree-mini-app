import { Page, useSnackbar, useNavigate, useParams } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlayCircle, FileText, ChevronLeft, CheckCircle2, BookOpen } from 'lucide-react';
import {
  fetchCourses,
  fetchCourse,
  completeLesson,
  type AcademyCourseSummary,
  type AcademyCourseDetail,
} from '../services/academy-api';
import { getErrorMessage } from '../services/api';
import { EmptyState, ErrorState } from '../components/ui/empty-state';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Icon } from '../components/ui/icon';
import { ListRow } from '../components/ui/list-row';
import { PageHeader } from '../components/ui/page-header';
import { ProgressBar } from '../components/ui/progress-bar';
import { Heading, Text } from '../components/ui/text';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { isDirectVideoUrl } from '../utils/video-url';
import { isHttpError } from '../services/http';

/** API chỉ mở cho CTV/đại lý/nhân viên: khách thường vào thẳng link thì được chỉ đường, Thử lại không đổi được kết quả. */
function isForbidden(e: unknown): boolean {
  return isHttpError(e) && e.response?.status === 403;
}

function CtvOnlyNotice() {
  const navigate = useNavigate();
  return (
    <EmptyState
      art="leaf"
      heading={vi.academy.ctvOnlyTitle}
      body={vi.academy.ctvOnlyBody}
      ctaLabel={vi.academy.ctvOnlyCta}
      onCta={() => navigate('/affiliate')}
    />
  );
}

export default function AcademyPage() {
  // Khoá đang mở nằm trên URL, KHÔNG phải state cục bộ: trước đây back của Zalo thoát thẳng
  // khỏi Học viện thay vì quay về danh sách, và không có cách nào gửi link tới một khoá.
  const { courseId } = useParams<{ courseId?: string }>();
  const navigate = useNavigate();

  return (
    <Page style={{ background: 'var(--color-bg-canvas)' }}>
      <PageHeader title={vi.academy.title} subtitle={courseId ? undefined : vi.academy.subtitle} />
      {courseId ? (
        <CourseDetail courseId={courseId} onBack={() => navigate('/academy', { replace: true })} />
      ) : (
        <CourseList onOpen={(id) => navigate(`/academy/${id}`)} />
      )}
    </Page>
  );
}

function CourseList({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['academy-courses'], queryFn: fetchCourses });

  return (
    <div style={{ padding: 16 }}>
      {q.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Skeleton height={92} radius="var(--radius-card)" />
          <Skeleton height={92} radius="var(--radius-card)" />
        </div>
      ) : q.isError && isForbidden(q.error) ? (
        <CtvOnlyNotice />
      ) : q.isError ? (
        <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {q.data.map((c) => (
            <CourseCard key={c.id} course={c} onOpen={() => onOpen(c.id)} />
          ))}
        </div>
      ) : (
        <EmptyState art="sprout" heading={vi.academy.empty} body={vi.academy.emptyBody} />
      )}
    </div>
  );
}

const ellipsis = { display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

function CourseCard({ course, onOpen }: { course: AcademyCourseSummary; onOpen: () => void }) {
  const pct = course.lessonCount > 0 ? Math.round((course.completedCount / course.lessonCount) * 100) : 0;

  return (
    <Card padding={0}>
      <ListRow
        icon={
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 'var(--radius-control)',
              overflow: 'hidden',
              background: 'var(--color-action-secondary-bg)',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {course.coverUrl ? (
              <img src={course.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Icon icon={BookOpen} size="lg" tone="brand" />
            )}
          </div>
        }
        title={<span style={ellipsis}>{course.title}</span>}
        subtitle={
          <>
            {course.description && <span style={ellipsis}>{course.description}</span>}
            <div style={{ margin: '8px 0 4px' }}>
              <ProgressBar value={pct} max={100} />
            </div>
            {course.isCompleted ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon icon={CheckCircle2} size="sm" tone="brand" />
                {vi.academy.completed}
              </span>
            ) : (
              <span>{vi.academy.progress(course.completedCount, course.lessonCount)}</span>
            )}
          </>
        }
        onPress={onOpen}
        style={{ padding: 12 }}
      />
    </Card>
  );
}

function CourseDetail({ courseId, onBack }: { courseId: string; onBack: () => void }) {
  const { openSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['academy-course', courseId], queryFn: () => fetchCourse(courseId) });

  const complete = useMutation({
    mutationFn: (lessonId: string) => completeLesson(lessonId),
    onSuccess: () => {
      haptic('medium');
      openSnackbar({ text: vi.academy.markDoneOk, type: 'success' });
      void qc.invalidateQueries({ queryKey: ['academy-course', courseId] });
      void qc.invalidateQueries({ queryKey: ['academy-courses'] });
    },
    onError: (e) => openSnackbar({ text: getErrorMessage(e), type: 'error' }),
  });

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <Button variant="ghost" icon={ChevronLeft} onPress={onBack}>
          {vi.academy.backToList}
        </Button>
      </div>

      {q.isLoading ? (
        <Skeleton height={200} radius="var(--radius-card)" />
      ) : q.isError && isForbidden(q.error) ? (
        <CtvOnlyNotice />
      ) : q.isError ? (
        <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <CourseDetailBody
          course={q.data}
          onComplete={(id) => complete.mutate(id)}
          completingId={complete.isPending ? complete.variables : undefined}
        />
      ) : null}
    </div>
  );
}

function CourseDetailBody({
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
      <Heading variant="title-md" as="h2">{course.title}</Heading>
      {course.description && (
        <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 4 }}>
          {course.description}
        </Text>
      )}

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {course.lessons.map((lesson, i) => {
          const done = course.completedLessonIds.includes(lesson.id);
          return (
            <Card key={lesson.id} padding={12}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon icon={lesson.contentType === 'VIDEO' ? PlayCircle : FileText} size="md" tone="brand" />
                <Text variant="body-md" as="div" style={{ flex: 1, fontWeight: 600 }}>
                  {i + 1}. {lesson.title}
                </Text>
                {done && <Icon icon={CheckCircle2} size="md" tone="brand" />}
              </div>

              {lesson.contentType === 'VIDEO' && lesson.videoUrl && (
                <div style={{ marginTop: 8 }}>
                  {isDirectVideoUrl(lesson.videoUrl) ? (
                    <video
                      src={lesson.videoUrl}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label={lesson.title}
                      style={{ width: '100%', borderRadius: 'var(--radius-media)', background: 'var(--stone-900)' }}
                    />
                  ) : (
                    <Text variant="body-sm" tone="secondary" as="div">
                      {vi.academy.videoOnWeb}
                    </Text>
                  )}
                </div>
              )}
              {lesson.contentType === 'ARTICLE' && lesson.body && (
                <Text variant="body-sm" tone="secondary" as="div" style={{ marginTop: 8, whiteSpace: 'pre-line' }}>
                  {lesson.body}
                </Text>
              )}

              {/* Khoá nút các bài khác khi một bài đang gửi; bài đang gửi giữ loading để Button chặn bấm đôi và vẫn hiện vòng quay. */}
              <Button
                variant={done ? 'secondary' : 'primary'}
                disabled={done || (completingId !== undefined && completingId !== lesson.id)}
                loading={completingId === lesson.id}
                icon={done ? CheckCircle2 : undefined}
                onPress={() => onComplete(lesson.id)}
                style={{ marginTop: 10 }}
              >
                {done ? vi.academy.alreadyDone : vi.academy.markDone}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
