# home r4 (nhánh gl/1103-home, commit da41bd844, chưa push)

Bước 0: git merge origin/main (fcd4ac0a1) xong, không xung đột; tsc Mini sạch.

1. P2 spec home-back-scroll: SỬA (da41bd844, chỉ đổi apps/e2e/tests/home-back-scroll.miniapp.spec.ts).
   - Ca 1: cuộn sâu rồi đặt scrollTop = scrollHeight - clientHeight - 800 (giữa trang, không phải đáy); trước goBack() chờ `.zaui-page` toHaveCount(1, 5s) để trang '/' đang trượt ra đã gỡ khỏi DOM.
   - Ca 2: chờ Danh mục là trang duy nhất trước khi bấm tab 'Trang chủ'. Ca 2 vẫn khẳng định "mở bằng thanh đáy -> về đầu trang" (hành vi hiện có, không phải đổi hành vi).
2. P3 mục 4 của home-r3-3.md: đã sửa câu sai, bỏ ghi chú "thay đổi hành vi cần chủ biết".

Chứng minh (Playwright Mini, --workers=1, E2E_MINIAPP_PORT=3983, spec mock toàn bộ API nên không cần lane):
- HEAD: 2/2 xanh, 3 lần liên tiếp. Ca 1: before 4145, after 4145 (lệch 0).
- Đột biến (home.tsx:170 `<HomeScrollRestoration .../>` -> `{null}`): ca 1 ĐỎ (before 4145, after 0, lệch 4145 > 2; đỏ cả lần retry), ca 2 xanh. Đã khôi phục home.tsx (git status sạch).
- Gốc 52fd5cd65 (worktree tạm, mã trước KHAMPHA-01 + spec mới): ca 1 ĐỎ (before 4145, after 0), ca 2 xanh.
- tsc apps/e2e sạch.

Tài nguyên: không bật lane; cổng 3261-3263, 3981-3984 trống (lsof). 
Còn lại: worktree tạm .claude/worktrees/gl-1103-base (detach 52fd5cd65, có symlink node_modules) chưa gỡ được do hook chặn lệnh xoá; gỡ bằng `git worktree remove --force` sau khi `unlink` các symlink node_modules trong đó.
