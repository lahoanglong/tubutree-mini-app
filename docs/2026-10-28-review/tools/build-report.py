# Dựng trang báo cáo cho chủ (report/index.html) từ các file markdown của đợt review.
# Dùng: python3 -I tools/build-report.py   (chạy trong docs/2026-10-25-ux-review)
import html, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'report', 'index.html')


def read(name):
    return open(os.path.join(ROOT, name), encoding='utf-8').read()


def section(text, start, stop=None):
    """Lấy đoạn từ dòng tiêu đề `start` (không gồm) tới tiêu đề `stop` hoặc tiêu đề cùng cấp kế tiếp."""
    i = text.index(start)
    body = text[i + len(start):]
    level = len(start) - len(start.lstrip('#'))
    if stop:
        j = body.find(stop)
        return body[:j] if j >= 0 else body
    m = re.search(r'^#{1,%d} ' % level, body, re.M)
    return body[:m.start()] if m else body


# ---------- markdown tối giản ----------
def inline(s):
    out, i = [], 0
    for m in re.finditer(r'`([^`]+)`', s):
        out.append(inline_text(s[i:m.start()]))
        out.append('<code>%s</code>' % html.escape(m.group(1)))
        i = m.end()
    out.append(inline_text(s[i:]))
    return ''.join(out)


def inline_text(s):
    s = html.escape(s, quote=False)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)', r'<a href="\2" rel="noopener">\1</a>', s)
    return s


def split_row(line):
    cells, cur, tick = [], '', False
    body = line.strip()
    if body.startswith('|'):
        body = body[1:]
    if body.endswith('|'):
        body = body[:-1]
    for ch in body:
        if ch == '`':
            tick = not tick
        if ch == '|' and not tick:
            cells.append(cur.strip())
            cur = ''
        else:
            cur += ch
    cells.append(cur.strip())
    return cells


LIST_RE = re.compile(r'^(\s*)([-*]|\d+\.)\s+(.*)$')


def md(text, shift=1, table_class=''):
    lines = text.strip('\n').split('\n')
    out, para, i = [], [], 0
    stack = []  # (indent, tag)

    def flush_para():
        if para:
            out.append('<p>%s</p>' % inline(' '.join(para)))
            para.clear()

    def close_lists(to_indent=-1):
        while stack and stack[-1][0] > to_indent:
            out.append('</li></%s>' % stack.pop()[1])

    while i < len(lines):
        line = lines[i]
        if line.strip().startswith('```'):
            flush_para(); close_lists()
            buf = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                buf.append(lines[i]); i += 1
            out.append('<div class="scroll"><pre>%s</pre></div>' % html.escape('\n'.join(buf)))
            i += 1
            continue
        if line.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|?\s*$', lines[i + 1]):
            flush_para(); close_lists()
            head = split_row(line)
            i += 2
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append(split_row(lines[i])); i += 1
            t = ['<div class="scroll"><table class="%s"><thead><tr>' % table_class]
            t += ['<th>%s</th>' % inline(h) for h in head]
            t.append('</tr></thead><tbody>')
            for r in rows:
                t.append('<tr>' + ''.join('<td>%s</td>' % inline(c) for c in r) + '</tr>')
            t.append('</tbody></table></div>')
            out.append(''.join(t))
            continue
        h = re.match(r'^(#{1,6})\s+(.*)$', line)
        if h:
            flush_para(); close_lists()
            lvl = min(6, len(h.group(1)) + shift)
            out.append('<h%d>%s</h%d>' % (lvl, inline(h.group(2)), lvl))
            i += 1
            continue
        if line.startswith('>'):
            flush_para(); close_lists()
            buf = []
            while i < len(lines) and lines[i].startswith('>'):
                buf.append(lines[i].lstrip('> ').rstrip()); i += 1
            out.append('<blockquote>%s</blockquote>' % inline(' '.join(buf)))
            continue
        m = LIST_RE.match(line)
        if m:
            flush_para()
            indent = len(m.group(1))
            tag = 'ol' if m.group(2)[0].isdigit() else 'ul'
            if not stack or indent > stack[-1][0]:
                out.append('<%s><li>' % tag)
                stack.append((indent, tag))
            else:
                close_lists(indent)
                if stack and stack[-1][0] == indent and stack[-1][1] == tag:
                    out.append('</li><li>')
                else:
                    if stack and stack[-1][0] == indent:
                        out.append('</li></%s>' % stack.pop()[1])
                    out.append('<%s><li>' % tag)
                    stack.append((indent, tag))
            out.append(inline(m.group(3)))
            i += 1
            continue
        if not line.strip():
            flush_para()
            i += 1
            continue
        if stack and line.startswith(' '):
            out.append(' ' + inline(line.strip()))
            i += 1
            continue
        close_lists()
        para.append(line.strip())
        i += 1
    flush_para(); close_lists()
    return '\n'.join(out)


# ---------- nội dung ----------
backlog = read('20-backlog.md')
kp = read('10-review-KP.md')
qt = read('10-review-QT.md')
game = read('03-game-nguoi-moi.md')
qr = read('04-phieu-qr.md')
rel = read('05-phat-hanh-mini-app.md')
pay = read('06-checkout-sdk.md')


def img_name(path):
    return 'img/' + path.replace('/', '--')[:-4] + '.jpg'


# Ảnh hiện trạng
gallery = []
sec = section(backlog, '## Ảnh cho báo cáo', '## Lộ trình')
for m in re.finditer(r'^\| `([^`]+)` \| (.+?) \| ([^|]+) \|$', sec, re.M):
    src = img_name(m.group(1))
    assert os.path.exists(os.path.join(ROOT, 'report', src)), src
    wide = m.group(1).startswith(('pairs/', 'web1280/', 'admin1280/'))
    gallery.append('<figure class="shot%s"><button class="zoom" data-src="%s" aria-label="Phóng to ảnh"><img src="%s" alt="" loading="lazy"></button><figcaption>%s <span class="ids">%s</span></figcaption></figure>' % (
        ' wide' if wide else '', src, src, inline(m.group(2)), html.escape(m.group(3).strip())))

# Backlog: bảng có lọc
rows = []
sec = section(backlog, '## Backlog', '## Ảnh cho báo cáo')
for line in sec.split('\n'):
    if not line.startswith('| B-'):
        continue
    c = split_row(line)
    bid, lvl, title, desc, orig, pkg, status = c[:7]
    rows.append('<tr data-lvl="%s" data-status="%s"><td class="mono">%s</td><td><span class="sev %s">%s</span></td><td><strong>%s</strong><div class="desc">%s</div><div class="orig">%s</div></td><td class="mono">%s</td><td>%s</td></tr>' % (
        lvl, 'done' if 'đã sửa' in status else ('work' if 'đang làm' in status else ('owner' if 'chủ' in status else 'plan')),
        bid, lvl.lower(), lvl, inline(title), inline(desc), html.escape(orig), html.escape(pkg), inline(status)))
counts = {p: sum(1 for r in rows if 'data-lvl="%s"' % p in r) for p in ('P0', 'P1', 'P2', 'P3')}

home_md = section(kp, '### 1. Trang chủ mới (375 px)', '### 2.')
pa_md = section(kp, '### 2. Thanh điều hướng đáy: hai phương án cho chủ', 'Phương án B, ít đổi')
profile_md = section(kp, '### 3. Trang Cá nhân mới', '### 4.')

before_after = [
    ('Vườn Xanh với khách mới', 'img/mini375--game__new__mini375__s1.jpg', 'Trước: 0 giọt nước, nút Tưới sáng mà bấm không được.', 'img/after-game-mini-new.jpg', 'Sau: thẻ 3 bước, nút chính "Điểm danh nhận 65💧", cây đầu chỉ cần 60💧.'),
    ('Thu hoạch cây đầu', None, None, 'img/after-g2-mini-harvest.jpg', 'Sau: +2.000 Điểm Xanh cho cây mầm. Không còn tự đăng bài; khách tự bấm "Chia sẻ với bạn bè".'),
    ('Vòng quay', 'img/mini375--game__new__mini375__s3.jpg', 'Trước: kim dừng ngẫu nhiên, có thể chỉ 💧 mà hộp báo "Tiếc quá".', 'img/after-g2-mini-wheel.jpg', 'Sau: kim dừng đúng ô của giải máy chủ trả về.'),
    ('Cộng đồng trong Mini App', 'img/pairs--feed.jpg', 'Trước: Đăng bài, Xếp hạng, thích, chip Facebook/TikTok.', 'img/after-z-feed.jpg', 'Sau: chỉ đọc. Không đăng bài, không thích, không link ra ngoài.'),
    ('Chính sách trong Mini App', 'img/mini375--checkout__returning__mini375__s2.jpg', 'Trước: bấm chính sách là mở trang web.', 'img/after-z-policy-sheet.jpg', 'Sau: hiện hộp nổi ngay trong app, đúng luật Zalo.'),
    ('Quản trị: Đổi rác', 'img/admin1280--tab-waste__admin__admin1280__s1.jpg', 'Trước: mở là sập, mất cả menu.', 'img/after-a1-doi-rac-1280.jpg', 'Sau: chạy bình thường, có băng báo chương trình đang tắt.'),
    ('Quản trị: bật/tắt tính năng', 'img/admin1280--tab-config__admin__admin1280__s3.jpg', 'Trước: phải gõ chữ true/false trong ô dữ liệu dạng mã.', 'img/after-a1-bat-tat-1280.jpg', 'Sau: công tắc có tên tiếng Việt, câu giải thích và hộp hỏi lại.'),
]
ba_html = []
for title, b, bc, a, ac in before_after:
    for p in (b, a):
        if p:
            assert os.path.exists(os.path.join(ROOT, 'report', p)), p
    cells = []
    if b:
        cells.append('<figure><span class="tag before">Trước</span><button class="zoom" data-src="%s" aria-label="Phóng to ảnh"><img src="%s" alt="" loading="lazy"></button><figcaption>%s</figcaption></figure>' % (b, b, inline(bc)))
    cells.append('<figure><span class="tag after">Sau</span><button class="zoom" data-src="%s" aria-label="Phóng to ảnh"><img src="%s" alt="" loading="lazy"></button><figcaption>%s</figcaption></figure>' % (a, a, inline(ac)))
    ba_html.append('<div class="ba"><h4>%s</h4><div class="ba-row">%s</div></div>' % (html.escape(title), ''.join(cells)))

STATUS = open(os.path.join(ROOT, 'report', 'status.md'), encoding='utf-8').read()

sections = [
    ('tom-tat', 'Tóm tắt', md(STATUS, shift=1)),
    ('te-nhat', 'Điều tệ nhất trước', md(section(backlog, '## Điều tệ nhất trước'), shift=1)),
    ('truoc-sau', 'Trước và sau khi sửa', '<p class="lead">Ảnh chụp trên máy thử, khổ điện thoại. Các bản sửa này chưa lên máy chủ thật.</p>' + ''.join(ba_html)),
    ('prod', 'Vì sao chức năng chưa dùng được trên PROD', md(section(backlog, '## Vì sao chức năng chưa dùng được trên PROD'), shift=1)),
    ('anh', 'Ảnh hiện trạng', '<p class="lead">Ảnh ghép: Mini App bên trái, web điện thoại bên phải. Bấm ảnh để phóng to.</p><div class="gallery">%s</div>' % ''.join(gallery)),
    ('bo-cuc', 'Trang chủ, thanh đáy và trang Cá nhân mới', '<p class="lead">Anh đã chọn phương án A. Gói H đang làm cho cả Mini App và web.</p>' + md('#### Trang chủ\n' + home_md + '\n#### Thanh đáy (phương án A)\n' + pa_md + '\n#### Trang Cá nhân\n' + profile_md, shift=0)),
    ('game', 'Game Vườn Xanh: nhịp cho người mới', md(section(game, '## Phần cho chủ (đọc 1 phút)'), shift=1)),
    ('qr', 'Tích điểm đơn sàn bằng QR', md(section(qr, '## Phần 1. Cho chủ (đọc 2 phút)'), shift=1)),
    ('thanh-toan', 'Thanh toán qua cổng Zalo', md(section(pay, '## 1. Cho chủ'), shift=1)),
    ('phat-hanh', 'Phát hành Mini App chính thức', md('### Tóm tắt\n' + section(rel, '## 1. Tóm tắt 10 dòng') + '\n### Từng bước bấm trong trang quản lý Zalo\n' + section(rel, '## 3. Từng bước bấm trong trang quản lý Zalo') + '\n### Việc anh tự làm\n' + section(rel, '## 6. Danh sách việc chủ phải tự làm (gom từ các mục trên)'), shift=0)),
    ('quan-tri', 'Hướng dẫn quản trị', '<p class="note">Hướng dẫn dưới đây đúng với bản đang chạy trên PROD. Khi gói A1 lên máy chủ: công tắc nằm ở thẻ <strong>Bật/tắt tính năng</strong>, thông tin công ty và chính sách nằm ở thẻ <strong>Thông tin cửa hàng &amp; chính sách</strong> (đầu tab Cấu hình), tab Đổi rác hết sập. Gõ <code>true</code> hay dấu ngoặc kép sẽ không cần nữa.</p>' + md(section(qt, '## Hướng dẫn vào từng tính năng'), shift=1, table_class='guide')),
    ('backlog', 'Backlog đầy đủ', None),
    ('lo-trinh', 'Lộ trình', md(section(backlog, '## Lộ trình'), shift=1)),
    ('viec-cua-anh', 'Việc của anh', md(section(backlog, '## Việc của chủ'), shift=1)),
    ('chua-kiem', 'Chưa kiểm', md(section(backlog, '## Chưa kiểm'), shift=1)),
]

backlog_html = '''<p class="lead">186 phát hiện của 8 nhóm review, gộp trùng còn %d mục. Lọc theo mức hoặc trạng thái.</p>
<div class="filters" role="group" aria-label="Lọc backlog">
<button class="chip on" data-f="all">Tất cả <b>%d</b></button>
<button class="chip" data-f="P0">P0 <b>%d</b></button>
<button class="chip" data-f="P1">P1 <b>%d</b></button>
<button class="chip" data-f="P2">P2 <b>%d</b></button>
<button class="chip" data-f="P3">P3 <b>%d</b></button>
<button class="chip" data-f="done">Đã sửa</button>
<button class="chip" data-f="work">Đang làm</button>
<button class="chip" data-f="owner">Việc của anh</button>
</div>
<div class="scroll"><table class="backlog"><thead><tr><th>ID</th><th>Mức</th><th>Việc</th><th>Gói</th><th>Trạng thái</th></tr></thead><tbody>%s</tbody></table></div>
<p class="legend"><span class="sev p0">P0</span> chặn ra mắt · <span class="sev p1">P1</span> sửa trước khi mở khách đông · <span class="sev p2">P2</span> trong tháng đầu · <span class="sev p3">P3</span> đánh bóng</p>''' % (
    len(rows), len(rows), counts['P0'], counts['P1'], counts['P2'], counts['P3'], ''.join(rows))

toc = ''.join('<li><a href="#%s">%s</a></li>' % (sid, html.escape(t)) for sid, t, _ in sections)
body = ''.join('<section id="%s"><h2>%s</h2>%s</section>' % (sid, html.escape(t), backlog_html if sid == 'backlog' else content) for sid, t, content in sections)

tpl = open(os.path.join(ROOT, 'tools', 'report-template.html'), encoding='utf-8').read()
page = tpl.replace('{{TOC}}', toc).replace('{{BODY}}', body).replace('{{P0}}', str(counts['P0'])).replace('{{TOTAL}}', str(len(rows)))
open(OUT, 'w', encoding='utf-8').write(page)
print(OUT, len(page) // 1024, 'KB;', len(rows), 'mục;', len(gallery), 'ảnh;', counts)
