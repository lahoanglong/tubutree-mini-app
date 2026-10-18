import { RecycleRequestDetail } from '@/components/recycle/recycle-request';

export default function RecycleRequestPage({ params }: { params: { id: string } }) {
  return <RecycleRequestDetail id={params.id} />;
}
