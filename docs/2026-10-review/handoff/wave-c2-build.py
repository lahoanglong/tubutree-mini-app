wf = r'C:\Users\longlh\.claude\projects\d--tubutree-mini-app\ff921a37-7c2b-4839-a135-26246b524db4\workflows\scripts'
sp = r'C:\Users\longlh\AppData\Local\Temp\claude\d--tubutree-mini-app\ff921a37-7c2b-4839-a135-26246b524db4\scratchpad'
b = open(wf + r'\tubutree-2026-10-wave-c1.js', encoding='utf-8').read().replace('\r\n', '\n').split('\n')
i_pk = next(i for i, l in enumerate(b) if l.startswith('const COMMON'))
i_wt = next(i for i, l in enumerate(b) if l.startswith('const WT'))
head = '\n'.join(b[:i_pk])
tail = '\n'.join(b[i_wt:])
head = (head.replace('tubutree-2026-10-wave-c1', 'tubutree-2026-10-wave-c2')
        .replace('Đợt C vòng C1: PC-1 nền DS v2/a11y, PC-3 giỏ/checkout, PC-4 hồ sơ/xoá tài khoản, PC-5 CTV/đại lý/nhãn, PC-8 admin+seed',
                 'Đợt C vòng C2: PC-2 hoàn tất 4b, PC-6 giao định kỳ + đơn thứ 2, PC-7 web khách DS v2, PC-9 nhân sự + câu chữ')
        .replace('hz5-PC-N', 'hz6-PC-N'))
tail = (tail.replace('hz5-', 'hz6-').replace("'hz5/'", "'hz6/'")
        .replace('115 migration', '119 migration')
        .replace('5 gói trong worktree cố định hz6-*', '4 gói trong worktree cố định hz6-*'))
body = open(sp + r'\c2-body.js', encoding='utf-8').read()
out = (head + '\n' + body + '\n' + tail).replace('\r\n', '\n')
open(wf + r'\tubutree-2026-10-wave-c2.js', 'w', encoding='utf-8', newline='\n').write(out)
print(len(out), out.count('hz5'), out.count('PC-1'), out.count('wave-c1'))
