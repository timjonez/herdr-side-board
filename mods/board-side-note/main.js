// Board's note editor: a sticky note on one session, saying why it sits there.
// Enter saves, an empty note clears, a lone 1-4 picks that preset, Esc cancels.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared } from "herdr";

const NOTES = "board.notes";
const DEFAULT_PRESETS = ["waiting on stakeholder", "waiting on PR approval", "blocked on review", "parked"];
const presets = () => shared("board.notePresets") ?? DEFAULT_PRESETS;

export default class BoardNote extends View {
  init(_p, cx) {
    const value = (shared(NOTES) ?? {})[props()?.address] ?? "";
    this.input = InputState.new({ value, placeholder: "Why is it sitting here?" });
    if (value) this.input.set_selected_range({ start: 0, end: value.length });
    this.input.on("change", (_e, cx) => cx.notify());
    this.input.on("submit", () => this.save(this.input.value()));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }
  save(text) {
    text = text.trim();
    const list = presets();
    if (/^[1-9]$/.test(text) && list[Number(text) - 1]) text = list[Number(text) - 1];
    const notes = { ...(shared(NOTES) ?? {}) };
    if (text) notes[props()?.address] = text.slice(0, 120); else delete notes[props()?.address];
    setShared(NOTES, notes);
    closeOverlay(props()?.overlay);
  }
  render() {
    const t = theme();
    const p = props() ?? {};
    const had = Boolean((shared(NOTES) ?? {})[p.address]);
    const button = (id, text, primary, action) => h_flex().id(id).h(30).px(13).items_center().rounded(7)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12).font_medium().cursor_pointer()
      .hover(s => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("board-side-note").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().p(16).gap(10).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().gap(8)
        .child(svg("mods/board-side/note.svg").size(14).text_color(t.accent))
        .child(div().flex_1().min_w(0).truncate().text_size(14).font_semibold().child(`Note on “${p.name ?? "session"}”`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(Input.new(this.input).h(34).px(10).rounded(8).border_1().border_color(t.accent)
        .bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(v_flex().gap(2).children(presets().map((text, i) =>
        h_flex().id(`preset-${i}`).h(26).px(8).gap(9).items_center().rounded(6).cursor_pointer()
          .text_size(12).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.save(text))
          .child(div().w(10).text_size(11).text_color(t.dim).child(String(i + 1)))
          .child(div().truncate().child(text)))))
      .child(h_flex().pt(4).gap(8).items_center()
        .child(div().flex_1().text_size(10.5).text_color(t.dim).child("Enter saves · empty clears · 1–4 preset"))
        .when(had, el => el.child(button("note-clear", "Clear", false, () => this.save(""))))
        .child(button("note-save", "Save", true, () => this.save(this.input.value()))));
  }
}
