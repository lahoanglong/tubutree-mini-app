'use client';

import { RewardsView } from '@/components/rewards/rewards-view';
import { LedgerShell } from '../tai-khoan/ledger-shell';

const TITLE = 'Kho quà';

export default function RewardsPage() {
  return (
    <LedgerShell title={TITLE} wide>
      <RewardsView />
    </LedgerShell>
  );
}
