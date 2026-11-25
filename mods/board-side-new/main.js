// Board's New menu: pick a machine, then a terminal or agent to start there.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, machines, knownAgents, run, closeOverlay, props, shared, setShared } from "herdr";

// The same cache the shipped + menu keeps, so agents show at once.
const KNOWN = "new-menu.agents";
const label = (m) => m ?? "This computer";
const ready = (m) => m === null || machines().find(x => x.name === m)?.layout === "ready";
function machineList() {
  const names = [null, ...machines().map(m => m.name), ...spaces().map(s => s.machine)];
  return [...new Set(names)].sort((a, b) => a === null ? -1 : b === null ? 1 : a.localeCompare(b));
}
// Where a new tab goes on a machine: the space last shown there (Board records it), else its first.
function targetSpace(m) {
  const there = spaces().filter(s => (s.machine ?? null) === m);
  const last = (shared("board.lastSpace") ?? {})[m ?? ""];
  return there.find(s => s.active) ?? there.find(s => s.id === last) ?? there[0] ?? null;
}

export default class BoardNew extends View {
  init(_p, cx) {
    this.machine = spaces().find(s => s.active)?.machine ?? null;
    this.agents = {};
    this.failed = {};
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.load(this.machine, cx);
  }
  load(m, cx) {
    const where = m ?? "";
    this.agents[where] ??= shared(KNOWN)?.[where] ?? null;
    cx.spawn(async cx => {
      try {
        this.agents[where] = await knownAgents({ on: m });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents[where] });
        this.failed[where] = false;
      } catch { this.failed[where] = true; }
      cx.notify();
    });
  }
  pick(m, cx) {
    this.machine = m;
    this.load(m, cx);
    cx.notify();
  }
  start(agent) {
    const m = this.machine;
    closeOverlay(props().overlay);
    const space = targetSpace(m);
    if (!space) return run("space.new", { machine: m ?? "", ...(agent ? { argv: agent.run, tab: agent.name } : {}) });
    run("space.select", { id: space.id });
    run("tab.new", { space: space.id, ...(agent ? { name: agent.name, argv: agent.run } : {}) });
  }
  row(t, id, icon, name, action, hint = "", enabled = true) {
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.hover(s => s.bg(t.selected)).cursor_pointer())
      .on_click(() => { if (enabled) action(); })
      .child(icon).child(div().flex_1().truncate().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }
  render(cx) {
    const t = theme();
    const all = machineList();
    const m = this.machine;
    const where = m ?? "";
    const list = this.agents[where] ?? [];
    const installed = list.filter(a => a.installed);
    const space = targetSpace(m);
    const machineTab = (x) => {
      const on = x === m;
      return h_flex().id(`m-${x ?? "local"}`).flex_1().min_w(0).h(30).px(8).gap(6).items_center().justify_center()
        .rounded(6).cursor_pointer().text_size(12)
        .bg(on ? t.background : "#00000000").text_color(on ? t.foreground : t.muted)
        .when(on, el => el.border(1).border_color(t.border))
        .hover(s => s.text_color(t.foreground))
        .on_click((_e, cx) => this.pick(x, cx))
        .child(svg(`mods/board-side/${x ? "server" : "monitor"}.svg`).size(13).flex_none())
        .child(div().truncate().child(label(x)))
        .child(div().size(5).rounded(5).flex_none().bg(ready(x) ? t.ansi2 ?? t.done : t.blocked));
    };
    const status = !ready(m) ? `${label(m)} is not connected`
      : this.failed[where] ? "Could not check installed agents"
      : this.agents[where] === null ? "Checking installed agents…"
      : installed.length === 0 ? "No agents installed there" : null;
    return v_flex().w_full().bg(t.popover).p(6).gap(2).text_size(12.8)
      .id("board-side-new").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const i = all.indexOf(m);
        if (e.key === "left" || e.key === "right") {
          const next = all[(i + (e.key === "left" ? all.length - 1 : 1)) % all.length];
          return this.pick(next, cx);
        }
        if (e.key === "t") return this.start(null);
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (agent) this.start(agent);
      })
      .child(div().px(4).pb(4).text_size(11).text_color(t.dim).child("START ON"))
      .child(h_flex().p(2).gap(2).rounded(8).bg(t.canvas).border(1).border_color(t.border).children(all.map(machineTab)))
      .child(div().px(4).pt(6).pb(4).text_size(11).text_color(t.dim).truncate()
        .child(space ? `Opens in space “${space.name}”` : "Opens in a new space"))
      .child(this.row(t, "terminal", svg("icons/shell.svg").size(14), "Terminal", () => this.start(null), "T", ready(m)))
      .child(v_flex().id("agents").flex_none().max_h(300).overflow_y_scrollbar()
        .children(installed.map((a, i) => this.row(t, `a-${a.key}`,
          a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14),
          a.name, () => this.start(a), i < 9 ? String(i + 1) : "", ready(m))))
        .when(status, el => el.child(div().px(9).py(6).text_size(11.5).text_color(t.dim).child(status))))
      .child(div().h(1).mx(4).my(4).bg(t.border))
      .child(this.row(t, "space-new", svg("mods/board-side/plus.svg").size(13), `New space on ${label(m)}`, () => {
        closeOverlay(props().overlay);
        run("space.new", { machine: m ?? "" });
      }, "", ready(m)))
      .child(div().px(9).pt(2).text_size(10.5).text_color(t.dim).child("←/→ machine · 1–9 agent · T terminal"));
  }
}
