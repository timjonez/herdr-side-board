const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const source = readFileSync(join(__dirname, "../mods/board-side/main.js"), "utf8")
  .replace(/^import .*;\n/gm, "").replace("export default class Board", "class Board");
const key = "board.laneWeights";
const laneIds = ["blocked", "working", "done", "idle"];

// Run the real render and mouse handlers with a minimal stand-in for the Herdr host.
function harness(initial, zoom = 1) {
  const state = new Map([[key, initial]]);
  const nodes = new Map();
  function element() {
    const calls = {};
    const el = new Proxy({}, {
      get: (_, name) => (...args) => {
        calls[name] = args;
        if (name === "id") nodes.set(args[0], calls);
        if (name === "when" && args[0]) args[1](el);
        return el;
      },
    });
    return el;
  }
  const noop = () => {};
  const empty = () => [];
  const Board = runInNewContext(`${source}\nBoard`, {
    View: class {}, v_flex: element, h_flex: element, div: element,
    agents: empty, spaces: empty, machines: empty, props: () => ({}),
    theme: () => ({}), setAgentOrder: noop, settings: () => ({ zoom }),
    shared: k => state.get(k), setShared: (k, value) => state.set(k, value),
  });
  const board = new Board();
  const cx = { spawn: noop, timer: { every: noop }, notify: noop, stop_propagation: noop };
  const render = () => board.render();
  const rail = () => nodes.get("board-lanes");
  render();
  rail().on_size_change[0]({ height: 454 * zoom }, cx);
  return {
    heights: () => {
      render();
      return laneIds.map(id => nodes.get(`lane-${id}`).flex_grow[0]);
    },
    press: (i, y, click_count = 1) =>
      nodes.get(`lane-handle-${i}`).on_mouse_down[1]({ position: { y }, click_count }, cx),
    move: y => rail().on_window_mouse_move[0]({ position: { y }, pressed_button: "left" }, cx),
    release: () => rail().on_window_mouse_up[1]({}, cx),
    saved: () => state.get(key) && Array.from(state.get(key)),
  };
}

test("drag transfers height only between neighbors and saves on release", () => {
  const board = harness([1, 1, 1, 1], 2);
  board.press(1, 400);
  board.move(450);
  assert.deepEqual(board.heights(), [1, 1.25, 0.75, 1]);
  assert.deepEqual(board.saved(), [1, 1, 1, 1]);
  board.release();
  assert.deepEqual(board.saved(), [1, 1.25, 0.75, 1]);
});

test("a large drag stops before shrinking a lane past its header", () => {
  const board = harness();
  assert.deepEqual(board.heights(), [1, 1, 1, 1]);
  board.press(0, 100);
  board.move(1000);
  board.release();
  assert.ok(Math.abs(board.saved()[1] - 0.4) < 1e-9);
  assert.deepEqual(board.saved().slice(2), [1, 1]);
});

test("double-click clears saved heights and restores equal shares", () => {
  const board = harness([0.5, 1, 2, 0.5]);
  assert.deepEqual(board.heights(), [0.5, 1, 2, 0.5]);
  board.press(2, 350, 2);
  board.release();
  assert.equal(board.saved(), null);
  assert.deepEqual(board.heights(), [1, 1, 1, 1]);
});
