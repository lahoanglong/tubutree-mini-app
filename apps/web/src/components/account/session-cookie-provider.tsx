'use client';

import type { ReactNode } from 'react';
import { SessionCookieContext } from '@/lib/home-restore-context';

export function SessionCookieProvider({ hasSession, children }: { hasSession: boolean; children: ReactNode }) {
  return <SessionCookieContext.Provider value={hasSession}>{children}</SessionCookieContext.Provider>;
}
