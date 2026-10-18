'use client';

export function WasteTab({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="space-y-4" data-waste-tab={isAdmin ? 'admin' : 'staff'}>
      <h2 className="font-display text-lg font-semibold text-stone-900">Đổi rác lấy quà</h2>
    </div>
  );
}
