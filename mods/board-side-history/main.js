// Board's History: search past Claude Code and OpenCode sessions on every machine and
// reopen one where it ran. sessions.py (embedded below as SCRIPT) lists each machine's.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, spaces, machines, agents, exec, run, closeOverlay, props, shared, setShared } from "herdr";

const SCRIPT = "# Lists past Claude Code and OpenCode sessions on this machine as JSON, newest first.\n# The History popup runs it (with python3 -c) on each machine through Herdr.\nimport glob, json, os, re, sqlite3\nhome = os.path.expanduser(\"~\")\nout = []\nfiles = sorted(glob.glob(os.path.join(home, \".claude/projects/*/*.jsonl\")), key=os.path.getmtime, reverse=True)[:400]\npat = re.compile(rb'\"(customTitle|aiTitle|lastPrompt)\":\"((?:[^\"\\\\]|\\\\.)*)\"')\ncwd_pat = re.compile(rb'\"cwd\":\"((?:[^\"\\\\]|\\\\.)*)\"')\ndec = lambda b: json.loads(b'\"' + b + b'\"')\nfor f in files:\n    try:\n        data = open(f, \"rb\").read()\n    except OSError:\n        continue\n    found = {}\n    for m in pat.finditer(data):\n        found[m.group(1)] = m.group(2)\n    title = found.get(b\"customTitle\") or found.get(b\"aiTitle\") or found.get(b\"lastPrompt\")\n    if not title:\n        continue\n    cwd = cwd_pat.search(data)\n    try:\n        out.append({\"agent\": \"claude\", \"id\": os.path.basename(f)[:-6], \"title\": dec(title)[:160],\n                    \"dir\": dec(cwd.group(1)) if cwd else \"\", \"time\": int(os.path.getmtime(f) * 1000)})\n    except ValueError:\n        pass\ndb = os.path.join(home, \".local/share/opencode/opencode.db\")\nif os.path.exists(db):\n    try:\n        con = sqlite3.connect(\"file:\" + db + \"?mode=ro\", uri=True, timeout=2)\n        tables = {r[0] for r in con.execute(\"select name from sqlite_master where type='table'\")}\n        seen = set()\n        for table in (\"session_v2\", \"session\"):\n            if table not in tables:\n                continue\n            for sid, d, title, t in con.execute(f\"select id, directory, title, time_updated from {table} \"\n                                                 \"where parent_id is null and time_archived is null \"\n                                                 \"order by time_updated desc limit 400\"):\n                if sid in seen or not title:\n                    continue\n                seen.add(sid)\n                out.append({\"agent\": \"opencode\", \"id\": sid, \"title\": title[:160], \"dir\": d or \"\", \"time\": t})\n    except sqlite3.Error:\n        pass\nout.sort(key=lambda s: -s[\"time\"])\nprint(json.dumps(out[:600]))\n";
const CACHE = "board.history";
const label = (m) => m ?? "This computer";
const key = (m) => m ?? "";
const ready = (m) => m === null || machines().find(x => x.name === m)?.layout === "ready";
const machineList = () => [...new Set([null, ...machines().map(m => m.name ?? null)])];
const AGENTS = {
  claude: { name: "Claude Code", argv: (id) => ["claude", "--resume", id] },
  opencode: { name: "OpenCode", argv: (id) => ["opencode", "--session", id] },
};
function targetSpace(m) {
  const there = spaces().filter(s => (s.machine ?? null) === m);
  const last = (shared("board.lastSpace") ?? {})[key(m)];
  return there.find(s => s.active) ?? there.find(s => s.id === last) ?? there[0] ?? null;
}
function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString();
}
const shortDir = (d) => d.replace(/^\/(home|Users)\/[^/]+/, "~") || "~";

export default class BoardHistory extends View {
  init(_p, cx) {
    this.query = "";
    this.machine = "all";
    this.closedOnly = false;
    this.selected = 0;
    this.loading = {};
    this.failed = {};
    this.input = InputState.new({ placeholder: "Search sessions by title or folder" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.selected = 0; cx.notify(); });
    this.input.on("submit", () => { const s = this.rows()[this.selected]; if (s) this.open(s); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    for (const m of machineList()) this.load(m, cx);
  }
  load(m, cx) {
    if (!ready(m)) return;
    this.loading[key(m)] = true;
    cx.spawn(async cx => {
      try {
        const r = await exec("python3", ["-c", SCRIPT], { on: m, timeout: 30000 });
        if (r.code !== 0) throw new Error(r.stderr);
        setShared(CACHE, { ...(shared(CACHE) ?? {}), [key(m)]: JSON.parse(r.stdout) });
        this.failed[key(m)] = false;
      } catch { this.failed[key(m)] = true; }
      this.loading[key(m)] = false;
      cx.notify();
    });
  }
  // Every session, newest first, with the machine it's on, a note if the board closed it
  // with one, and the live card when it is open right now.
  all() {
    const cache = shared(CACHE) ?? {};
    const closed = shared("board.closed") ?? [];
    const live = agents();
    const stamp = JSON.stringify([Object.values(cache).map(l => l.length + ":" + (l[0]?.time ?? 0)), closed.length, closed[0]?.at, live.map(a => a.address + a.title)]);
    if (this.memo?.stamp === stamp) return this.memo.list;
    const machineOfSpace = new Map(spaces().map(x => [x.id, x.machine ?? null]));
    const closedBy = new Map(closed.map(c => [`${c.machine ?? ""}\u0000${c.title}`, c]));
    const list = [];
    for (const m of machineList()) for (const s of cache[key(m)] ?? []) {
      const gone = closedBy.get(`${key(m)}\u0000${s.title}`);
      const open = live.find(a => machineOfSpace.get(a.space) === m && (a.title ?? "").includes(s.title));
      list.push({ ...s, machine: m, note: gone?.note ?? null, closedAt: gone?.at ?? null, open,
        hay: `${s.title} ${s.dir} ${label(m)} ${gone?.note ?? ""} ${AGENTS[s.agent].name}`.toLowerCase() });
    }
    list.sort((a, b) => b.time - a.time);
    this.memo = { stamp, list };
    return list;
  }
  rows() {
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.all().filter(s =>
      (this.machine === "all" || key(s.machine) === this.machine)
      && (!this.closedOnly || s.closedAt)
      && words.every(w => s.hay.includes(w)))
      .slice(0, 100);
  }
  open(s) {
    closeOverlay(props()?.overlay);
    if (s.open) return run("agent.focus", { terminal: s.open.address });
    const argv = AGENTS[s.agent].argv(s.id);
    const name = s.title.length > 40 ? s.title.slice(0, 39) + "…" : s.title;
    const space = targetSpace(s.machine);
    if (!space) return run("space.new", { machine: key(s.machine), folder: s.dir || undefined, argv, tab: name });
    run("space.select", { id: space.id });
    run("tab.new", { space: space.id, folder: s.dir || undefined, name, argv });
  }
  render(cx) {
    const t = theme();
    const rows = this.rows();
    const sel = Math.min(this.selected, Math.max(0, rows.length - 1));
    const known = shared("new-menu.agents")?.[""] ?? [];
    const agentIcon = (agent) => {
      const k = known.find(x => x.key === agent);
      const file = k?.icon ?? `icons/${agent}.svg`;
      return k?.tint === false ? image(file).size(15) : svg(file).size(15).text_color(t.foreground);
    };
    const chip = (id, text, on, action) => h_flex().id(id).h(24).px(9).gap(6).items_center().rounded(6).cursor_pointer()
      .text_size(11.5).border_1().border_color(on ? t.accent : t.border).bg(on ? `${t.accent}22` : "#00000000")
      .text_color(on ? t.foreground : t.muted).hover(s => s.text_color(t.foreground)).on_click(action).child(text);
    const busy = machineList().filter(m => this.loading[key(m)]).map(label);
    const failed = machineList().filter(m => this.failed[key(m)] || !ready(m)).map(label);
    const status = busy.length ? `Checking ${busy.join(", ")}…` : failed.length ? `Could not read ${failed.join(", ")}` : `${rows.length}${rows.length === 100 ? "+" : ""} sessions`;
    return v_flex().id("board-side-history").track_focus(this.handle).size_full().p(16).gap(10).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(props()?.overlay); cx.stop_propagation(); }
        else if (e.key === "down") { this.selected = Math.min(sel + 1, rows.length - 1); cx.notify(); }
        else if (e.key === "up") { this.selected = Math.max(sel - 1, 0); cx.notify(); }
      })
      .child(h_flex().items_center().gap(8)
        .child(svg("mods/board-side/history.svg").size(15).text_color(t.accent))
        .child(div().flex_1().text_size(15).font_semibold().child("Session history"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(Input.new(this.input).h(34).px(10).rounded(8).border_1().border_color(t.accent)
        .bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(h_flex().gap(6).items_center().flex_wrap()
        .child(chip("m-all", "All machines", this.machine === "all", () => { this.machine = "all"; this.selected = 0; cx.notify(); }))
        .children(machineList().map(m => chip(`m-${key(m) || "local"}`, label(m), this.machine === key(m),
          () => { this.machine = key(m); this.selected = 0; cx.notify(); })))
        .child(div().w(6))
        .child(chip("closed", "Closed from board", this.closedOnly, () => { this.closedOnly = !this.closedOnly; this.selected = 0; cx.notify(); }))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(status)))
      .child(v_flex().id("history-list").flex_1().min_h(0).overflow_y_scrollbar().gap(2)
        .when(rows.length === 0, el => el.child(div().p(12).text_size(12).text_color(t.dim)
          .child(busy.length ? "Loading…" : "No sessions match.")))
        .children(rows.map((s, i) => h_flex().id(`h-${s.agent}-${s.id}`).flex_none().h(46).px(10).gap(10).items_center()
          .rounded(7).cursor_pointer().when(i === sel, el => el.bg(t.selected)).hover(st => st.bg(t.hover))
          .on_click(() => this.open(s))
          .child(div().flex_none().tooltip(AGENTS[s.agent].name).child(agentIcon(s.agent)))
          .child(v_flex().flex_1().min_w(0).gap(3)
            .child(h_flex().gap(7).items_center().min_w(0)
              .child(div().min_w(0).truncate().text_size(12.8).font_semibold().child(s.title))
              .when(Boolean(s.open), el => el.child(div().flex_none().px(5).rounded(4).bg(`${t.working}22`).text_size(10).text_color(t.working).child("open"))))
            .child(h_flex().gap(6).items_center().min_w(0).text_size(10.5).text_color(t.muted)
              .child(div().flex_none().child(label(s.machine)))
              .child(div().flex_none().child("·"))
              .child(div().min_w(0).truncate().child(shortDir(s.dir)))
              .when(Boolean(s.note), el => el.child(div().flex_none().child("·"))
                .child(div().min_w(0).truncate().text_color(t.accent).child(s.note)))))
          .child(div().flex_none().text_size(10.5).text_color(t.dim).child(ago(s.time))))))
      .child(div().text_size(10.5).text_color(t.dim).child("↑/↓ select · Enter reopens where it ran (or jumps to it if open)"));
  }
}
