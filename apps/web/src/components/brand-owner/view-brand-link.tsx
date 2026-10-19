'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';

/** Sửa logo/ảnh bìa/câu chuyện mà không xem được kết quả thì chỉ đoán: nhãn đã đăng có lối sang trang công khai, nhãn nháp chỉ báo. */
export function ViewBrandLink({ slug, published }: { slug: string; published: boolean }) {
  const [draftNotice, setDraftNotice] = useState(false);
  if (published) {
    return (
      <Link href={`/brand/${slug}`} className={`${skin.btnSecondary} self-start`}>
        Xem trang nhãn
      </Link>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setDraftNotice(true)} className={`${skin.btnSecondary} self-start`}>
        Xem trang nhãn
      </button>
      {draftNotice && (
        <p role="status" className="rounded-control bg-warning-bg p-3 text-sm font-medium text-warning-fg">
          Nhãn đang là nháp — Tubu duyệt xong khách mới xem được.
        </p>
      )}
    </>
  );
}
