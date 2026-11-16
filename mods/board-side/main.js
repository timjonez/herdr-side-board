import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, spaces, panes, props, run, setAgentOrder, theme, shared, setShared, layout, openOverlay, window, machines, nextCommand } from "herdr";

const STATES = [
  { key: "blocked", label: "Needs you" },
  { key: "working", label: "Working" },
  { key: "done", label: "Done" },
  { key: "idle", label: "Idle" },
];
// A translucent tint of a theme color, for count badges and selected chips.
const tint = (color, alpha) => /^#[0-9a-f]{6}$/i.test(color) ? color + alpha : color;
const dot = (color, size = 7) => div().size(size).rounded(size).bg(color).flex_none();
const icon = (t, program, size = 18) => program?.icon
  ? (program.tint ? svg(program.icon).text_color(t.foreground) : image(program.icon)).size(size).flex_none()
  : div().size(size).rounded(4).bg(t.accent);
// The header is a window-drag area: buttons stop the press so a click isn't a drag.
const stop = (_e, cx) => cx.stop_propagation();
const chip = (t, id, label, selected, action) => h_flex().id(id).h(27).px(11).gap(7).items_center().rounded(6)
  .bg(selected ? tint(t.accent, "1f") : t.background).border(1).border_color(selected ? tint(t.accent, "55") : t.border)
  .text_size(11).text_color(selected ? t.accent : t.muted).cursor_pointer()
  .hover(s => s.border_color(selected ? t.accent : t.input ?? t.muted).text_color(selected ? t.accent : t.foreground))
  .on_mouse_down("left", stop).on_click(action).child(label);
const button = (t, id, file, tip, action) => div().id(id).size(28).flex_none().flex().items_center().justify_center()
  .rounded(6).text_color(t.muted).cursor_pointer().tooltip(tip).hover(s => s.bg(t.hover).text_color(t.foreground))
  .on_mouse_down("left", stop).on_click(action).child(svg(`mods/board-side/${file}.svg`).size(15));

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Side layout: the terminal column is the entire left; the board is a right rail.
// Hiding terminals collapses that column and lets the lanes use the width.
// The rail's width is kept so showing them again puts the split back.
const CARDS_PX = 520;
const cardsPxKey = "boardSide.cardsPx";
const cardsHiddenKey = "boardSide.cardsWereHidden";
const terminalsMinimized = () => !!find(layout(), "workspace")?.hidden;
function toggleTerminals() {
  if (!terminalsMinimized()) {
    if (find(layout(), "board-header")?.hidden) run("layout.show", { id: "board-header" });
    if (find(layout(), "board-cards")?.hidden) run("layout.show", { id: "board-cards" });
    const px = find(layout(), "board-cards")?.size?.px;
    if (px) setShared(cardsPxKey, px);
    run("layout.hide", { id: "workspace" });
    run("layout.resize", { id: "board-cards", weight: 1 });
  } else {
    run("layout.show", { id: "workspace" });
    run("layout.resize", { id: "workspace", weight: 1 });
    run("layout.resize", { id: "board-cards", px: shared(cardsPxKey) ?? CARDS_PX });
  }
}

// Maximizing the terminals: hide the header and the board so the workspace fills the window.
// Restoring shows the header, and the board unless it was already hidden (the Board chip).
const terminalsMaximized = () => !!find(layout(), "board-header")?.hidden;
function toggleMaximized() {
  if (!terminalsMaximized()) {
    if (terminalsMinimized()) toggleTerminals();
    setShared(cardsHiddenKey, !!find(layout(), "board-cards")?.hidden);
    run("layout.hide", { id: "board-header" });
    run("layout.hide", { id: "board-cards" });
  } else {
    run("layout.show", { id: "board-header" });
    if (!shared(cardsHiddenKey)) run("layout.show", { id: "board-cards" });
  }
}

// Machines: null is this computer.
const machineLabel = (m) => m ?? "This computer";
const machineIcon = (m) => m ? "server" : "monitor";
const machineOf = (spaceId) => spaces().find(s => s.id === spaceId)?.machine ?? null;
function machineList() {
  const names = [null, ...machines().map(m => m.name), ...spaces().map(s => s.machine)];
  return [...new Set(names)].sort((a, b) => a === null ? -1 : b === null ? 1 : a.localeCompare(b));
}
const machineReady = (m) => m === null || machines().find(x => x.name === m)?.layout === "ready";
const connected = (t) => t.ansi2 ?? t.done;
// A machine's name as a small pill: plain for this computer, accent-tinted for remote ones.
const machinePill = (t, m) => h_flex().h(18).px(6).gap(4).items_center().rounded(4).flex_none()
  .bg(m ? tint(t.accent, "1f") : t.surface ?? t.canvas).text_size(10).text_color(m ? t.accent : t.muted)
  .child(svg(`mods/board-side/${machineIcon(m)}.svg`).size(11)).child(machineLabel(m));

// The program filter lives in shared state: the header sets it, the board applies it.
const program = () => shared("board.program") ?? null;
const visible = (list) => list.filter(a => !program() || a.program?.name === program());
function nextProgram(list) {
  const names = [...new Set(list.map(a => a.program?.name).filter(Boolean))].sort();
  const i = names.indexOf(program());
  setShared("board.program", i + 1 < names.length ? names[i + 1] : null);
}

// A session's name: what the agent put in its terminal title (Claude Code and OpenCode name
// their sessions there), minus spinners, status marks and program prefixes. If the title is
// empty or only the program/shell/prompt, a named tab's name, else "<Program> in <folder>".
function sessionName(a) {
  const prog = a.program?.name ?? "Agent";
  let title = (a.title ?? "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/^(oc|opencode|claude code|claude|codex)\s*[|:·—-]\s*/i, "")
    .replace(/\s+[|·—-]\s*(opencode|claude code|claude|codex)$/i, "")
    .trim();
  const lower = title.toLowerCase();
  const boring = !title || lower === prog.toLowerCase() || lower === (a.app ?? "").toLowerCase()
    || /^(bash|zsh|fish|sh|opencode|claude|codex)$/.test(lower) || /^[\w.-]+@[\w.-]+:/.test(title)
    || /^[~/]/.test(title);
  if (!boring) return title;
  if (a.tab_name && !/^\d+$/.test(a.tab_name) && a.tab_name.toLowerCase() !== prog.toLowerCase()) return a.tab_name;
  const cwd = panes().find(p => p.pane === a.pane)?.cwd ?? "";
  const folder = cwd.replace(/\/+$/, "").split("/").pop();
  return folder && !/^(home|root)$/.test(folder) && cwd !== "/home/" + folder ? `${prog} in ${folder}` : `${prog} in ~`;
}

// Closing a session ends its terminal. Its pane goes; if it was the tab's only pane, the tab goes
// (and Herdr itself asks first when that would close the space's last tab).
// A session still working or waiting on you asks first; an idle or finished one closes at once.
function closeSession(a) {
  // History shows sessions closed here with their note.
  const machine = machineOf(a.space);
  const title = sessionName(a);
  const note = (shared("board.notes") ?? {})[a.address] ?? null;
  const closed = (shared("board.closed") ?? []).filter(c => !(c.title === title && c.machine === machine));
  setShared("board.closed", [{ title, machine, note, at: Date.now() }, ...closed].slice(0, 100));
  const alone = panes().filter(p => p.tab === a.tab).length <= 1;
  const command = alone ? { name: "tab.close", args: { id: a.tab } } : { name: "pane.close", args: { pane: a.pane } };
  if (a.status !== "working" && a.status !== "blocked") return run(command.name, command.args);
  openOverlay({
    mod: "confirm", kind: "dialog", width: 400, height: 170,
    props: {
      title: `Close ${a.program?.name ?? "this session"}?`,
      detail: `“${sessionName(a)}” on ${machineLabel(machineOf(a.space))} is ${a.status === "working" ? "still working" : "waiting on you"}. Closing ends it.`,
      command,
    },
  });
}

// Sticky notes on sessions, keyed by terminal address (survives pane moves and restarts).
const notes = () => shared("board.notes") ?? {};
function editNote(a) {
  openOverlay({ mod: "board-note", kind: "dialog", width: 400, height: 250,
    props: { address: a.address, name: sessionName(a) } });
}
// A note goes when its session does. Only judge a machine whose sessions are listed,
// so a disconnected machine or a slow start never wipes its notes.
function pruneNotes(list) {
  const all = notes();
  const live = new Set(list.map(a => a.address));
  const listed = new Set(list.map(a => machineOf(a.space) ?? ""));
  const names = new Set(machines().map(m => m.name));
  const machineOfAddress = (addr) => { const pre = addr.split("/")[0]; return addr.includes("/") && names.has(pre) ? pre : ""; };
  const kept = Object.fromEntries(Object.entries(all).filter(([addr]) => live.has(addr) || !listed.has(machineOfAddress(addr))));
  if (Object.keys(kept).length !== Object.keys(all).length) setShared("board.notes", kept);
}
const noteLine = (t, a, text) => h_flex().id(`note-${a.address}`).gap(6).items_center().min_w(0)
  .px(6).h(20).rounded(4).bg(tint(t.accent, "1a")).text_size(11).text_color(t.accent)
  .tooltip("Edit note").hover(s => s.bg(tint(t.accent, "2e")))
  .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); editNote(a); })
  .child(svg("mods/board-side/note.svg").size(11).flex_none()).child(div().truncate().child(text));

// Closing a tab ends everything in it. Agents in it go to History's closed list; a working or
// waiting one asks first (Herdr itself asks when it's the space's last tab).
function closeTab(list, sp, tab) {
  const inTab = list.filter(a => a.tab === tab.id);
  const closed = shared("board.closed") ?? [];
  const notesNow = shared("board.notes") ?? {};
  const records = inTab.map(a => ({ title: sessionName(a), machine: sp.machine ?? null, note: notesNow[a.address] ?? null, at: Date.now() }));
  if (records.length) setShared("board.closed", [...records,
    ...closed.filter(c => !records.some(r => r.title === c.title && r.machine === c.machine))].slice(0, 100));
  const busy = inTab.find(a => a.status === "working" || a.status === "blocked");
  const command = { name: "tab.close", args: { id: tab.id } };
  if (!busy) return run(command.name, command.args);
  openOverlay({ mod: "confirm", kind: "dialog", width: 400, height: 170, props: {
    title: "Close this tab?",
    detail: `“${sessionName(busy)}” on ${machineLabel(sp.machine)} is ${busy.status === "working" ? "still working" : "waiting on you"}. Closing ends it.`,
    command,
  } });
}

// Tab strip order, set by dragging; tabs never placed keep Herdr's order, after placed ones.
function sortTabs(entries) {
  const rank = new Map((shared("board.tabOrder") ?? []).map((id, i) => [id, i]));
  return entries.map((e, i) => [e, rank.has(e.tab.id) ? rank.get(e.tab.id) : Infinity, i])
    .sort((x, y) => x[1] - y[1] || x[2] - y[2]).map(x => x[0]);
}
function moveTab(ids, from, to) {
  const next = ids.slice();
  const i = next.indexOf(from), j = next.indexOf(to);
  if (i < 0 || j < 0) return;
  next.splice(j, 0, ...next.splice(i, 1));
  setShared("board.tabOrder", next);
}

// The session in the terminal area: the focused agent, else the agent in the shown tab
// (its focused pane first).
function currentSession() {
  const list = agents();
  const sp = spaces().find(s => s.active);
  const tab = sp?.tabs.find(x => x.active);
  const inTab = list.filter(a => a.space === sp?.id && a.tab === tab?.id);
  const focusedPane = panes().find(p => p.tab === tab?.id && p.focused)?.pane;
  return list.find(a => a.focused) ?? inTab.find(a => a.pane === focusedPane) ?? inTab[0] ?? null;
}
// keys.json "board.note": every copy of this mod (header, board, bars) hears it; one acts.
let lastNoteKey = 0;
function noteShortcut() {
  if (Date.now() - lastNoteKey < 500) return;
  lastNoteKey = Date.now();
  const a = currentSession();
  if (a) editNote(a);
}

// Card order, set by dragging: one ranked list of addresses. A column sorts its cards by it;
// cards never placed keep Herdr's order, after the placed ones.
const savedOrder = () => shared("board.order") ?? [];
function sortCards(cards) {
  const rank = new Map(savedOrder().map((addr, i) => [addr, i]));
  return cards.map((a, i) => [a, rank.has(a.address) ? rank.get(a.address) : Infinity, i])
    .sort((x, y) => x[1] - y[1] || x[2] - y[2]).map(x => x[0]);
}
// Move `from` to where `to` sits in its column, then rank that column first; other
// columns keep their relative order.
function moveCard(column, from, to) {
  const ids = column.map(a => a.address);
  const i = ids.indexOf(from), j = ids.indexOf(to);
  if (i < 0 || j < 0 || i === j) return;
  ids.splice(j, 0, ...ids.splice(i, 1));
  const live = new Set(agents().map(a => a.address));
  setShared("board.order", [...ids, ...savedOrder().filter(addr => !ids.includes(addr) && live.has(addr))]);
}

export default class Board extends View {
  init(_p, cx) {
    this.observed = {};
    this.pressed = null; // the card being dragged
    this.tabPressed = null; // the strip tab being dragged
    cx.spawn(async () => { for (;;) { if (await nextCommand() === "note") noteShortcut(); } });
    this.tabOver = null;
    this.over = null;    // the card it would drop on
    cx.timer.every(30000, (cx) => cx.notify());
  }
  card(t, a, color, lane) {
    const old = this.observed[a.address];
    if (!old || old.status !== a.status) this.observed[a.address] = { status: a.status, at: Date.now() };
    const mins = Math.floor((Date.now() - this.observed[a.address].at) / 60000);
    const elapsed = mins ? `${mins}m` : "<1m";
    const note = notes()[a.address];
    const machine = machineOf(a.space);
    // The session in the terminal area: the focused one, else the one in the shown tab.
    const shownSpace = spaces().find(s => s.active);
    const shownTab = shownSpace?.tabs.find(x => x.active);
    const active = a.focused || (a.space === shownSpace?.id && a.tab === shownTab?.id);
    const where = `${a.space_name} · tab ${a.tab_name}`;
    const tip = [sessionName(a), machineLabel(machine), where, elapsed, note].filter(Boolean).join(" · ");
    const glyph = (id, file, size, tipText, fg, hoverBg, hoverFg, action) => div().id(id).size(16).flex_none().flex()
      .items_center().justify_center().rounded(4).text_color(fg).cursor_pointer().tooltip(tipText)
      .hover(s => s.bg(hoverBg).text_color(hoverFg))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); action(); })
      .child(svg(`mods/board-side/${file}.svg`).size(size));
    const from = this.pressed === null ? -1 : lane.findIndex(c => c.address === this.pressed);
    const here = lane.findIndex(c => c.address === a.address);
    const dragging = this.pressed !== null && this.over !== null && this.over !== this.pressed;
    // Label row. No flex_1: the badge hugs its text instead of growing to the lane.
    const label = h_flex().items_center().flex_none()
      .child(div().flex_none().ml(6).tooltip(a.program?.name ?? "Agent").child(icon(t, a.program, 12)))
      .when(Boolean(machine), el => el.child(div().flex_none().ml(4).tooltip(machineLabel(machine))
        .child(svg("mods/board-side/server.svg").size(10).text_color(t.accent))))
      .when(active, el => el.child(div().flex_none().ml(4).tooltip("Showing in the terminal area")
        .child(svg("mods/board-side/eye.svg").size(11).text_color(t.accent))))
      .child(div().max_w(148).min_w(0).ml(5).mr(2).text_size(11).truncate()
        .text_color(active ? t.accent : t.foreground)
        .when(active, d => d.font_semibold())
        .child(sessionName(a)))
      .when(mins >= 1, el => el.child(div().flex_none().text_size(10).text_color(t.dim).child(elapsed)))
      .when(!note, el => el.child(glyph(`notebtn-${a.address}`, "note", 11, "Add a note",
        t.dim, t.hover, t.foreground, () => editNote(a))))
      .child(glyph(`close-${a.address}`, "x", 10, "Close this session",
        t.dim, tint(t.blocked, "22"), t.blocked, () => closeSession(a)))
      .child(div().w(2).flex_none());
    // Note sits under the label and only as wide as its own text. Built only when there is one:
    // child() rejects an empty value, and that was taking the whole board down.
    const noteLine = note ? h_flex().id(`card-note-${a.address}`).ml(23).mr(8).mb(5).h(16).px(5).gap(3)
      .items_center().flex_none().self_start().max_w(160)
      .rounded(4).bg(tint(t.accent, "24")).text_size(10).text_color(t.accent)
      .tooltip(`${note} · Edit note`).hover(s => s.bg(tint(t.accent, "3a")))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); editNote(a); })
      .child(svg("mods/board-side/note.svg").size(10).flex_none())
      .child(div().max_w(132).min_w(0).truncate().child(note)) : null;
    return h_flex().id(`agent-${a.address}`).relative().max_w(220).flex_none().flex_shrink_0()
      .rounded(6).overflow_hidden()
      .when(!note, el => el.h(26).items_center())
      .when(dragging && this.pressed === a.address, el => el.opacity(0.45))
      .when(dragging && this.over === a.address, el => el.child(
        div().absolute().top(0).bottom(0).w(2).bg(t.accent)
          .when(from < here, line => line.right(0))
          .when(from > here, line => line.left(0))))
      .on_mouse_down("left", () => { this.pressed = a.address; this.over = a.address; })
      .on_mouse_move((_e, cx) => {
        if (this.pressed === null) return;
        const over = from >= 0 ? a.address : null; // only within the same lane
        if (this.over !== over) { this.over = over; cx.notify(); }
      })
      .on_mouse_up("left", (_e, cx) => {
        if (this.pressed !== null && this.over === a.address && this.pressed !== a.address) moveCard(lane, this.pressed, a.address);
        this.pressed = null; this.over = null;
        cx.notify();
      })
      .bg(active ? tint(t.accent, "26") : t.background).border(1).border_color(active ? t.accent : t.border)
      .cursor_pointer().when(!active, el => el.hover(s => s.border_color(color)))
      .tooltip(tip)
      .on_click(() => { run("agent.focus", { terminal: a.address }); if (terminalsMinimized()) toggleTerminals(); })
      .child(div().w(3).h_full().bg(color).flex_none())
      .child(noteLine ? v_flex().flex_none().min_w(0).child(label).child(noteLine) : label);
  }

  // One tab in the strip above the terminals: what runs there, its machine, status and a close.
  tabChip(t, list, sp, tab, ids) {
    const shown = sp.active && tab.active;
    const inTab = panes().filter(p => p.tab === tab.id);
    const agent = list.find(a => a.tab === tab.id);
    const first = inTab.find(p => p.focused) ?? inTab[0];
    const folder = (first?.cwd ?? "").replace(/\/+$/, "").split("/").pop() || "~";
    const prog = first?.program?.name;
    const name = agent ? sessionName(agent)
      : tab.named && !/^\d+$/.test(tab.name) ? tab.name
      : prog && !/^(bash|zsh|fish|sh|terminal|shell)$/i.test(prog) ? prog
      : folder;
    const tip = `${machineLabel(sp.machine)} · ${sp.name} · tab ${tab.name}${inTab.length > 1 ? ` · ${inTab.length} panes` : ""}`;
    const from = this.tabPressed ? ids.indexOf(this.tabPressed) : -1;
    const here = ids.indexOf(tab.id);
    const dragging = this.tabPressed && this.tabOver && this.tabOver !== this.tabPressed;
    return h_flex().id(`tab-${tab.id}`).relative().flex_none().max_w(230).h(26).pl(8).pr(3).gap(6).items_center().rounded(6)
      .text_size(11.5).cursor_pointer().tooltip(tip)
      .border(1).border_color(shown ? t.accent : "#00000000")
      .bg(shown ? tint(t.accent, "26") : "#00000000").text_color(shown ? t.foreground : t.muted)
      .when(!shown, el => el.hover(s => s.bg(t.hover).text_color(t.foreground)))
      // Drag a tab onto another to move it there; a line shows which side it lands on.
      .when(dragging && this.tabPressed === tab.id, el => el.opacity(0.45))
      .when(dragging && this.tabOver === tab.id, el => el.child(
        div().absolute().top(2).bottom(2).w(2).rounded(1).bg(t.accent)
          .when(from < here, line => line.right(-3))
          .when(from > here, line => line.left(-3))))
      .on_mouse_down("left", () => { this.tabPressed = tab.id; this.tabOver = tab.id; })
      .on_mouse_move((_e, cx) => {
        if (this.tabPressed && this.tabOver !== tab.id) { this.tabOver = tab.id; cx.notify(); }
      })
      .on_mouse_up("left", (_e, cx) => {
        if (this.tabPressed && this.tabPressed !== tab.id && this.tabOver === tab.id) moveTab(ids, this.tabPressed, tab.id);
        this.tabPressed = null; this.tabOver = null;
        cx.notify();
      })
      .on_click(() => {
        run("space.select", { id: sp.id });
        run("tab.select", { id: tab.id });
        if (terminalsMinimized()) toggleTerminals();
      })
      .child(div().flex_none().child(icon(t, first?.program, 13)))
      .when(Boolean(sp.machine), el => el.child(svg("mods/board-side/server.svg").size(11).flex_none().text_color(t.accent)))
      .child(div().min_w(0).truncate().when(shown, d => d.font_semibold()).child(name))
      .when(Boolean(tab.status), el => el.child(dot(t[tab.status] ?? t.unknown, 6)))
      .child(div().id(`tabx-${tab.id}`).size(18).flex_none().flex().items_center().justify_center().rounded(4)
        .text_color(t.dim).tooltip(agent ? "Put away: keeps running, stays on the board" : "Close this tab")
        .hover(s => s.bg(agent ? t.hover : tint(t.blocked, "22")).text_color(agent ? t.foreground : t.blocked))
        .on_mouse_down("left", stop)
        // A session's tab is only put away (settled); a plain terminal's tab closes.
        .on_click((_e, cx) => { cx.stop_propagation(); agent ? run("tab.settle", { id: tab.id }) : closeTab(list, sp, tab); })
        .child(svg("mods/board-side/x.svg").size(10)));
  }
  header(t, list) {
    const shown = visible(list);
    const boardOpen = !find(layout(), "board-cards")?.hidden;
    const w = window();
    const all = machineList();
    const count = shown.length === list.length
      ? `${list.length} agents on ${all.length} machines`
      : `${shown.length} of ${list.length} agents`;
    // Each machine: connection dot, name, how many agents run there.
    const machineStat = (m) => h_flex().gap(5).items_center().text_size(11).text_color(t.muted)
      .tooltip(m ? `${m} · ${machineReady(m) ? "connected" : "not connected"}` : "This computer")
      .child(dot(machineReady(m) ? connected(t) : t.blocked, 6))
      .child(svg(`mods/board-side/${machineIcon(m)}.svg`).size(12))
      .child(machineLabel(m))
      .child(div().text_color(t.dim).child(String(list.filter(a => machineOf(a.space) === m).length)));
    return v_flex().size_full().bg(t.chrome).pl(26).pr(16).justify_center().gap(12)
      .child(h_flex().items_center().gap(10)
        .child(h_flex().gap(3).items_center().children([17, 12, 20].map(h => div().w(5).h(h).rounded(2).bg(t.accent))))
        .child(div().text_size(20).font_semibold().text_color(t.foreground).child("Agent board"))
        .child(div().w(10))
        .child(h_flex().gap(16).items_center().children(all.map(machineStat)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.muted).mr(6).child(count))
        .child(h_flex().id("new").h(28).px(11).gap(6).items_center().rounded(6).cursor_pointer()
          .bg(t.accent).text_color(t.accent_foreground ?? t.background).text_size(12).font_semibold()
          .hover(s => s.opacity(0.9))
          .on_mouse_down("left", stop)
          .on_click(() => openOverlay({ mod: "board-new", kind: "popup", width: 320, height: 520 }))
          .child(svg("mods/board-side/plus.svg").size(13)).child("New"))
        .child(button(t, "history", "history", "Session history: find and reopen past sessions",
          () => openOverlay({ mod: "board-history", kind: "dialog", width: 680, height: 600 })))
        .child(button(t, "settings", "settings", "Settings", () => run("app.settings")))
        .when(w?.buttons, el => el
          .child(div().w(1).h(18).mx(4).bg(t.border))
          .child(button(t, "minimize", "win-min", "Minimize", () => run("window.minimize")))
          .child(button(t, "maximize", w.maximized ? "win-restore" : "win-max", w.maximized ? "Restore" : "Maximize", () => run("window.maximize")))
          .child(button(t, "close-window", "x", "Close", () => run("window.close")))))
      .child(h_flex().gap(7).items_center().pr(10)
        .child(chip(t, "chip-terminals", "Terminals", !terminalsMinimized(), toggleTerminals))
        .child(chip(t, "chip-board", "Board", boardOpen, () => run("layout.toggle", { id: "board-cards" })))
        .child(chip(t, "chip-program", program() ?? "All agents", !!program(), () => nextProgram(list)))
        .child(div().flex_1()).child(dot(t.done, 6))
        .child(div().text_size(10).text_color(t.muted).child("Live updates")));
  }
  render() {
    const t = theme();
    const role = props()?.role;
    const list = agents();
    const active = spaces().find(s => s.active);
    if (role === "header") return this.header(t, list);
    if (role === "terminals") {
      const iconBtn = (id, file, size, tip, action) => h_flex().id(id).size(24).flex_none().justify_center().items_center()
        .rounded(5).cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
        .tooltip(tip).on_click(() => action()).child(svg(`mods/board-side/${file}.svg`).size(size));
      // Every open tab, by machine and space, then in the order dragged into (board.tabOrder).
      // Settled tabs (sessions put away with the strip's ×) stay off it; their cards bring them back.
      const all = spaces().slice().sort((x, y) => (x.machine ?? "").localeCompare(y.machine ?? "") || x.index - y.index);
      const entries = sortTabs(all.flatMap(sp => sp.tabs.filter(tab => !tab.settled).map(tab => ({ sp, tab }))));
      const ids = entries.map(e => e.tab.id);
      const strip = entries.map(({ sp, tab }) => this.tabChip(t, list, sp, tab, ids));
      const endDrag = (_e, cx) => { if (this.tabPressed) { this.tabPressed = null; this.tabOver = null; cx.notify(); } };
      return h_flex().size_full().pl(6).pr(8).items_center().gap(6).bg(t.chrome)
        .child(h_flex().id("tab-strip").flex_shrink(1).min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar()
          .on_mouse_up("left", endDrag).on_hover((hovered, cx) => { if (!hovered) endDrag(null, cx); })
          .children(strip))
        // A new terminal in the shown space, on its machine.
        .child(iconBtn("tab-new", "plus", 13, `New terminal on ${machineLabel(active?.machine ?? null)}${active ? ` in ${active.name}` : ""}`,
          () => active ? run("tab.new", { space: active.id }) : run("space.new", {})))
        .child(div().flex_1())
        .child(iconBtn("terminals-toggle", "chevron-left", 14, "Hide the terminals", toggleTerminals))
        .child(iconBtn("terminals-max", terminalsMaximized() ? "restore" : "maximize", 13,
          terminalsMaximized() ? "Bring back the header and board" : "Terminals fill the window", toggleMaximized));
    }
    if (role === "pane") {
      const p = panes().find(p => p.pane === props().pane);
      const a = list.find(a => a.pane === props().pane);
      const note = a && notes()[a.address];
      return h_flex().size_full().px(13).items_center().gap(7).bg(t.chrome).border_b(1).border_color(t.border)
        .child(icon(t, p?.program, 14)).child(div().text_size(11).text_color(t.foreground).child(p?.program?.name ?? "Terminal"))
        .when(Boolean(note), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child("·")).child(noteLine(t, a, note)))
        .child(div().flex_1()).child(dot(t[p?.status] ?? t.unknown ?? t.muted, 6));
    }
    // Remember the space last shown on each machine: New starts there.
    const here = active?.machine ?? null;
    const last = shared("board.lastSpace") ?? {};
    if (active && last[here ?? ""] !== active.id) setShared("board.lastSpace", { ...last, [here ?? ""]: active.id });
    const shown = visible(list);
    pruneNotes(list);
    setAgentOrder(STATES.flatMap(s => sortCards(shown.filter(a => a.status === s.key)).map(a => a.address)));
    const endDrag = (_e, cx) => { if (this.pressed !== null) { this.pressed = null; this.over = null; cx.notify(); } };
    // Lanes stack top to bottom and share the full rail, even when a lane has no badges.
    return v_flex().id("board-lanes").size_full().min_h(0).overflow_hidden().px(14).py(12).gap(10).bg(t.canvas)
      .on_mouse_up("left", endDrag)
      .on_hover((hovered, cx) => { if (!hovered) endDrag(null, cx); })
      .children(STATES.map(state => {
      const color = t[state.key];
      const cards = sortCards(shown.filter(a => a.status === state.key));
      return v_flex().id(`lane-${state.key}`).w_full().flex_1().min_h(0).min_w(0).overflow_hidden()
        .rounded(8).bg(t.surface ?? t.background).px(10).py(8).gap(8)
        .child(h_flex().h(22).flex_none().items_center().gap(7)
          .child(dot(color, 7))
          .child(div().text_size(12).font_semibold().text_color(t.foreground).child(state.label))
          .child(div().h(16).px(6).flex().items_center().rounded(4).bg(tint(color, "22")).text_size(10).text_color(color).child(String(cards.length)))
          .when(cards.length === 0, el => el.child(div().text_size(11).text_color(t.dim).child("None"))))
        .child(h_flex().id(`lane-cards-${state.key}`).w_full().flex_1().min_h(0).content_start().items_start()
          .flex_wrap().gap(6).overflow_y_scrollbar()
          .children(cards.map(a => this.card(t, a, color, cards))));
    }));
  }
}
