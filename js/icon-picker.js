import { el, icon } from "./dom.js";

export function createIconPicker({ choices, initial, markFor }) {
  let selected = initial;
  const grid = el("div", { class: "icon-picker" });

  function redraw() {
    grid.replaceChildren(
      ...choices.map((entry) => {
        const btn = el(
          "button",
          {
            class: `icon-pick${selected === entry.id ? " active" : ""}`,
            type: "button",
            title: entry.label,
          },
          markFor(entry)
        );
        btn.addEventListener("click", () => {
          selected = entry.id;
          redraw();
        });
        return btn;
      })
    );
  }

  redraw();
  return {
    node: grid,
    value: () => selected,
    redraw,
  };
}
