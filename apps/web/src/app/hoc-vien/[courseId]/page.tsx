import { AcademyShell } from '../academy-shell';
import { CourseDetailView } from './course-detail';

export const revalidate = 300;

// Không dựng sẵn trang nào lúc build; trang đầu tiên của mỗi đường dẫn dựng khi có người vào rồi giữ theo revalidate (ISR thay vì dựng mỗi lượt).
export function generateStaticParams() {
  return [];
}

export default async function AcademyCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return (
    <AcademyShell withSubtitle={false}>
      <CourseDetailView courseId={courseId} />
    </AcademyShell>
  );
}
