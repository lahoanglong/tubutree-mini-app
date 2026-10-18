import { Suspense } from 'react';
import { RecycleNew } from '@/components/recycle/recycle-new';

export default function RecycleNewPage() {
  return (
    <Suspense>
      <RecycleNew />
    </Suspense>
  );
}
