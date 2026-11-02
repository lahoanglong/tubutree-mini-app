'use client';

import { useState } from 'react';
import { BRAND_OWNER_DRAFT, BRAND_OWNER_VIEW_PAGE } from '@tubutree/app-core/client-copy';
import Link from 'next/link';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';

/** Sửa logo/ảnh bìa/câu chuyện mà không xem được kết quả thì chỉ đoán: nhãn đã đăng có lối sang trang công khai, nhãn nháp chỉ báo. */
export function ViewBrandLink({ slug, published }: { slug: string; published: boolean }) {
  const [draftNotice, setDraftNotice] = useState(false);
  if (published) {
    return (
      <Link href={`/brand/${slug}`} className={`${skin.btnSecondary} self-start`}>
        {BRAND_OWNER_VIEW_PAGE}
      </Link>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setDraftNotice(true)} className={`${skin.btnSecondary} self-start`}>
        {BRAND_OWNER_VIEW_PAGE}
      </button>
      {draftNotice && (
        <p role="status" className="rounded-control bg-warning-bg p-3 text-sm font-medium text-warning-fg">
          {BRAND_OWNER_DRAFT}
        </p>
      )}
    </>
  );
}
