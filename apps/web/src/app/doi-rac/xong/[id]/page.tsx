import { RecycleDone } from '@/components/recycle/recycle-done';

export default async function RecycleDonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecycleDone id={id} />;
}
