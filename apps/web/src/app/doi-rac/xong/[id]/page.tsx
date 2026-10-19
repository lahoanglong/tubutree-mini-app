import { RecycleDone } from '@/components/recycle/recycle-done';

export default function RecycleDonePage({ params }: { params: { id: string } }) {
  return <RecycleDone id={params.id} />;
}
