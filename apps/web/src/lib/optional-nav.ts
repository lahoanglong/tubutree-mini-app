'use client';

import { usePathname, useRouter } from 'next/navigation';
import { shellPath } from './shell-pathname';

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
    const pathname = usePathname();
    return shellPath(pathname);
  } catch {
    return null;
  }
}
