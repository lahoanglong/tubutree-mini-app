import { useState } from 'react';
import { Box, Page, Text, Button, useSnackbar } from 'zmp-ui';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlayCircle, FileText, ChevronLeft, CheckCircle2 } from 'lucide-react';
import {
  fetchCourses,
  fetchCourse,
  completeLesson,
  type AcademyCourseSummary,
  type AcademyCourseDetail,
} from '../services/academy-api';
import { getErrorMessage } from '../services/api';
import { ErrorState } from '../components/ui/empty-state';
import { Skeleton } from '../components/ui/skeleton';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';

export default function AcademyPage() {
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);

  return (
    <Page className="page" style={{ background: 'var(--neutral-50)' }}>
      {openCourseId ? (
        <CourseDetail courseId={openCourseId} onBack={() => setOpenCourseId(null)} />
      ) : (
        <CourseList onOpen={setOpenCourseId} />
      )}
    </Page>
  );
}

function CourseList({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['academy-courses'], queryFn: fetchCourses });

  return (
    <Box p={4}>
      <Text bold size="xLarge">
        {vi.academy.title}
      </Text>
      <Text size="small" style={{ color: 'var(--neutral-400)', marginTop: 2, marginBottom: 16 }}>
        {vi.academy.subtitle}
      </Text>

      {q.isLoading ? (
        <Box flex flexDirection="column" style={{ gap: 12 }}>
          <Skeleton style={{ height: 92, borderRadius: 16 }} />
          <Skeleton style={{ height: 92, borderRadius: 16 }} />
        </Box>
      ) : q.isError ? (
        <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.length > 0 ? (
        <Box flex flexDirection="column" style={{ gap: 12 }}>
          {q.data.map((c) => (
            <CourseCard key={c.id} course={c} onOpen={() => onOpen(c.id)} />
          ))}
        </Box>
      ) : (
        <Box style={{ textAlign: 'center', padding: '48px 24px' }}>
          <Box style={{ marginBottom: 14 }}>
            <Text style={{ fontSize: 48, lineHeight: '1.2', display: 'inline-block' }}>🎓</Text>
          </Box>
          <Text style={{ color: 'var(--neutral-600)' }}>{vi.academy.empty}</Text>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
            {vi.academy.emptyBody}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function CourseCard({ course, onOpen }: { course: AcademyCourseSummary; onOpen: () => void }) {
  const pct = course.lessonCount > 0 ? Math.round((course.completedCount / course.lessonCount) * 100) : 0;

  return (
    <Box
      className="tubu-press"
      onClick={onOpen}
      p={3}
      style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)' }}
    >
      <Box flex style={{ gap: 12 }}>
        <Box
          style={{
            width: 64,
            height: 64,
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            background: 'var(--primary-50)',
            flexShrink: 0,
          }}
        >
          {course.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={course.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Box flex alignItems="center" justifyContent="center" style={{ width: '100%', height: '100%' }}>
              <Text style={{ fontSize: 28 }}>📘</Text>
            </Box>
          )}
        </Box>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text bold style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {course.title}
          </Text>
          {course.description && (
            <Text
              size="xSmall"
              style={{ color: 'var(--neutral-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {course.description}
            </Text>
          )}
          <Box mt={2} style={{ height: 6, background: 'var(--neutral-100)', borderRadius: 99, overflow: 'hidden' }}>
            <Box
              style={{
                width: `${pct}%`,
                height: '100%',
                background: course.isCompleted ? 'var(--leaf-600)' : 'var(--primary-600)',
              }}
            />
          </Box>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)', marginTop: 4 }}>
            {course.isCompleted ? vi.academy.completed : vi.academy.progress(course.completedCount, course.lessonCount)}
          </Text>
        </Box>
      </Box>
    </Box>
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
    <Box p={4}>
      <Box className="tubu-press" onClick={onBack} flex alignItems="center" style={{ gap: 4, marginBottom: 12 }}>
        <ChevronLeft size={18} />
        <Text size="small">{vi.academy.backToList}</Text>
      </Box>

      {q.isLoading ? (
        <Skeleton style={{ height: 200, borderRadius: 16 }} />
      ) : q.isError ? (
        <ErrorState message={getErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <CourseDetailBody course={q.data} onComplete={(id) => complete.mutate(id)} completing={complete.isPending} />
      ) : null}
    </Box>
  );
}

function CourseDetailBody({
  course,
  onComplete,
  completing,
}: {
  course: AcademyCourseDetail;
  onComplete: (lessonId: string) => void;
  completing: boolean;
}) {
  return (
    <Box>
      <Text bold size="xLarge">
        {course.title}
      </Text>
      {course.description && (
        <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 4 }}>
          {course.description}
        </Text>
      )}

      <Box mt={4} flex flexDirection="column" style={{ gap: 10 }}>
        {course.lessons.map((lesson, i) => {
          const done = course.completedLessonIds.includes(lesson.id);
          return (
            <Box
              key={lesson.id}
              p={3}
              style={{ background: 'var(--neutral-0)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xs)' }}
            >
              <Box flex alignItems="center" style={{ gap: 8 }}>
                {lesson.contentType === 'VIDEO' ? (
                  <PlayCircle size={18} color="var(--primary-600)" />
                ) : (
                  <FileText size={18} color="var(--primary-600)" />
                )}
                <Text bold style={{ flex: 1 }}>
                  {i + 1}. {lesson.title}
                </Text>
                {done && <CheckCircle2 size={18} color="var(--leaf-600)" />}
              </Box>

              {lesson.contentType === 'VIDEO' && lesson.videoUrl && (
                <Box mt={2}>
                  <a
                    href={lesson.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--primary-700)', fontSize: 13 }}
                  >
                    {vi.academy.openVideo}
                  </a>
                </Box>
              )}
              {lesson.contentType === 'ARTICLE' && lesson.body && (
                <Text size="small" style={{ color: 'var(--neutral-600)', marginTop: 8, whiteSpace: 'pre-line' }}>
                  {lesson.body}
                </Text>
              )}

              <Button
                size="small"
                variant={done ? 'secondary' : undefined}
                disabled={done || completing}
                onClick={() => onComplete(lesson.id)}
                style={{ marginTop: 10, ...(done ? {} : { background: 'var(--primary-600)' }) }}
              >
                {done ? vi.academy.alreadyDone : vi.academy.markDone}
              </Button>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
