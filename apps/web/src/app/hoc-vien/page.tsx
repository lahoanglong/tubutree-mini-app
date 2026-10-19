import { AcademyShell } from './academy-shell';
import { CourseList } from './course-list';

export const revalidate = 300;

export default async function AcademyPage() {
  return (
    <AcademyShell withSubtitle>
      <CourseList />
    </AcademyShell>
  );
}
