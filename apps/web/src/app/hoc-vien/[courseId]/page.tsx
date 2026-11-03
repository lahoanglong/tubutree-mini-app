import { AcademyShell } from '../academy-shell';
import { CourseDetailView } from './course-detail';

export const revalidate = 300;

export default async function AcademyCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return (
    <AcademyShell withSubtitle={false}>
      <CourseDetailView courseId={courseId} />
    </AcademyShell>
  );
}
