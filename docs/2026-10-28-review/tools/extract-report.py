# Tách báo cáo cuối của một subagent từ bản ghi JSONL rồi ghi ra file, không in nội dung.
# Dùng: python3 -I extract-report.py <transcript.output> <file đích>
import json, sys
src, dst = sys.argv[1], sys.argv[2]
last = None
for line in open(src, encoding='utf-8'):
    try:
        o = json.loads(line)
    except Exception:
        continue
    msg = o.get('message') if isinstance(o, dict) else None
    if not isinstance(msg, dict) or msg.get('role') != 'assistant':
        continue
    content = msg.get('content')
    texts = []
    if isinstance(content, list):
        for c in content:
            if not isinstance(c, dict):
                continue
            if c.get('type') == 'text':
                texts.append(c.get('text', ''))
            # Báo cáo nộp qua công cụ hand-back nằm trong input.message.
            elif c.get('type') == 'tool_use' and isinstance(c.get('input'), dict) and isinstance(c['input'].get('message'), str):
                texts.append(c['input']['message'])
    elif isinstance(content, str):
        texts = [content]
    t = '\n'.join(x for x in texts if x)
    if t.strip():
        last = t
if not last:
    sys.exit('không thấy tin nhắn assistant')
# Báo cáo bọc giữa hai dòng "=====" thì lấy phần giữa.
parts = (last.rstrip() + '\n').split('\n=====\n')
if len(parts) >= 3:
    last = '\n' + parts[1]
i = last.find('\n# ')
body = last[i + 1:] if i >= 0 else last
open(dst, 'w', encoding='utf-8').write(body.rstrip() + '\n')
print(dst, len(body.splitlines()), 'dòng; dòng đầu:', body.splitlines()[0][:80])
