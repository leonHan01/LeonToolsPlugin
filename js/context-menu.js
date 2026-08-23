import { el, icon } from "./dom.js";

let menu = null;

export function menuPosition(x, y, width, height, viewportW, viewportH, pad = 8) {
  return {
    left: Math.min(Math.max(pad, x), Math.max(pad, viewportW - width - pad)),
    top: Math.min(Math.max(pad, y), Math.max(pad, viewportH - height - pad)),
  };
}

export function closeContextMenu() {
  if (!menu) return;
  menu.remove();
  menu = null;
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("scroll", closeContextMenu, true);
}

function onPointerDown(event) {
  if (menu && !menu.contains(event.target)) closeContextMenu();
}

function onKeyDown(event) {
  if (event.key === "Escape") closeContextMenu();
}

export function openContextMenu(event, actions) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  menu = el(
    "div",
    { class: "context-menu", role: "menu" },
    ...actions.map((action) =>
      el(
        "button",
        {
          class: `context-menu-item${action.danger ? " danger" : ""}`,
          type: "button",
          role: "menuitem",
          onClick: () => {
            closeContextMenu();
            action.onClick();
          },
        },
        action.icon ? icon(action.icon) : null,
        action.label
      )
    )
  );
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  const pos = menuPosition(event.clientX, event.clientY, rect.width, rect.height, window.innerWidth, window.innerHeight);
  menu.style.left = `${pos.left}px`;
  menu.style.top = `${pos.top}px`;
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("scroll", closeContextMenu, true);
}
