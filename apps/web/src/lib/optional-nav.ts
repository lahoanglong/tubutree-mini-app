'use client';

import { usePathname, useRouter } from 'next/navigation';

// Ngoài App Router (spec render trần) hai hook ném: khi đó coi là trang con và lùi bằng History API.
// Ném luôn ở cùng một chỗ trong mọi lần render nên thứ tự hook không đổi.
export function useOptionalRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

export function useOptionalPathname() {
  try {
    return usePathname();
  } catch {
    return null;
  }
}
