import { RecycleEdit } from '@/components/recycle/recycle-edit';

export default async function RecycleEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecycleEdit id={id} />;
}
