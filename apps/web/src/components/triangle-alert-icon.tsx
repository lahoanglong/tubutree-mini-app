/**
 * `<AlertTriangle className="h-8 w-8" aria-hidden="true" />` của lucide-react 1.18 viết thẳng: cùng thuộc tính, cùng thứ tự, cùng đường vẽ
 * (triangle-alert-icon.spec.tsx so markup với bản lucide). Dùng ở các khung lỗi (gốc, global-error, nhóm trang): mỗi khung là một chunk riêng
 * trong JS tải lần đầu, và bộ khung `Icon` của lucide (~0,8 KB gzip) bị chép vào từng chunk đó.
 */
export function TriangleAlertIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="lucide lucide-triangle-alert h-8 w-8"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
