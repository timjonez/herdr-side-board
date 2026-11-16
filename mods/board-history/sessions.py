# Lists past Claude Code and OpenCode sessions on this machine as JSON, newest first.
# The History popup runs it (with python3 -c) on each machine through Herdr.
import glob, json, os, re, sqlite3
home = os.path.expanduser("~")
out = []
files = sorted(glob.glob(os.path.join(home, ".claude/projects/*/*.jsonl")), key=os.path.getmtime, reverse=True)[:400]
pat = re.compile(rb'"(customTitle|aiTitle|lastPrompt)":"((?:[^"\\]|\\.)*)"')
cwd_pat = re.compile(rb'"cwd":"((?:[^"\\]|\\.)*)"')
dec = lambda b: json.loads(b'"' + b + b'"')
for f in files:
    try:
        data = open(f, "rb").read()
    except OSError:
        continue
    found = {}
    for m in pat.finditer(data):
        found[m.group(1)] = m.group(2)
    title = found.get(b"customTitle") or found.get(b"aiTitle") or found.get(b"lastPrompt")
    if not title:
        continue
    cwd = cwd_pat.search(data)
    try:
        out.append({"agent": "claude", "id": os.path.basename(f)[:-6], "title": dec(title)[:160],
                    "dir": dec(cwd.group(1)) if cwd else "", "time": int(os.path.getmtime(f) * 1000)})
    except ValueError:
        pass
db = os.path.join(home, ".local/share/opencode/opencode.db")
if os.path.exists(db):
    try:
        con = sqlite3.connect("file:" + db + "?mode=ro", uri=True, timeout=2)
        tables = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
        seen = set()
        for table in ("session_v2", "session"):
            if table not in tables:
                continue
            for sid, d, title, t in con.execute(f"select id, directory, title, time_updated from {table} "
                                                 "where parent_id is null and time_archived is null "
                                                 "order by time_updated desc limit 400"):
                if sid in seen or not title:
                    continue
                seen.add(sid)
                out.append({"agent": "opencode", "id": sid, "title": title[:160], "dir": d or "", "time": t})
    except sqlite3.Error:
        pass
out.sort(key=lambda s: -s["time"])
print(json.dumps(out[:600]))
