import { RecycleEdit } from '@/components/recycle/recycle-edit';

export default function RecycleEditPage({ params }: { params: { id: string } }) {
  return <RecycleEdit id={params.id} />;
}
