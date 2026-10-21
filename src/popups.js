// Popup menus, small prompts and toasts, shared by the main window, welcome screen and dialogs.
export const overlay = document.querySelector("#overlay");

export function closeOverlay() {
  overlay.replaceChildren();
  overlay.classList.remove("open", "dim", "locked");
}
// A "locked" overlay holds a dialog that only its own buttons and keys may close.
overlay.addEventListener("mousedown", (e) => {
  if (e.target === overlay && !overlay.classList.contains("locked")) closeOverlay();
});

/**
 * Items are "-" (separator), { header }, or { label, icon, hint, action, checked, disabled, children }.
 * Items with `children` open a submenu on hover, like PyCharm's main menu.
 */
function buildMenu(items, close) {
  const menu = document.createElement("div");
  menu.className = "menu";
  let openSub = null;
  const closeSub = () => {
    openSub?.remove();
    openSub = null;
    menu.querySelector(".menu-item.open")?.classList.remove("open");
  };
  for (const item of items) {
    if (item === "-") {
      menu.append(Object.assign(document.createElement("div"), { className: "menu-sep" }));
      continue;
    }
    const el = document.createElement("div");
    if (item.header) {
      el.className = "menu-header";
      el.textContent = item.header;
      menu.append(el);
      continue;
    }
    const enabled = !item.disabled && (item.action || item.children?.length);
    el.className = "menu-item" + (enabled ? "" : " disabled") + (item.checked ? " checked" : "") + (item.children ? " submenu" : "");
    el.innerHTML = `<span class="icon">${item.icon ?? ""}</span><span class="label"></span><span class="hint"></span>`;
    el.querySelector(".label").textContent = item.label;
    el.querySelector(".hint").textContent = item.hint ?? "";
    el.addEventListener("mouseenter", () => {
      if (el.classList.contains("open")) return;
      closeSub();
      if (!item.children?.length || !enabled) return;
      el.classList.add("open");
      openSub = buildMenu(item.children, close);
      overlay.append(openSub);
      const r = el.getBoundingClientRect();
      const s = openSub.getBoundingClientRect();
      const left = r.right + s.width + 4 > window.innerWidth ? r.left - s.width - 4 : r.right + 4;
      openSub.style.left = `${Math.max(8, left)}px`;
      openSub.style.top = `${Math.max(8, Math.min(r.top - 5, window.innerHeight - s.height - 8))}px`;
    });
    if (item.action && !item.disabled) {
      el.addEventListener("click", () => {
        close();
        item.action();
      });
    }
    menu.append(el);
  }
  return menu;
}

export function contextMenu(x, y, items, { anchorBottom = false } = {}) {
  closeOverlay();
  const menu = buildMenu(items, closeOverlay);
  overlay.append(menu);
  overlay.classList.add("open");
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = anchorBottom ? Math.max(8, y - rect.height) : Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function promptModal({ title, value = "", placeholder = "", selectStem = false }) {
  return new Promise((resolve) => {
    closeOverlay();
    const box = document.createElement("div");
    box.className = "modal";
    box.innerHTML = `<div class="modal-title"></div><input spellcheck="false" autocomplete="off" />`;
    box.querySelector(".modal-title").textContent = title;
    const input = box.querySelector("input");
    input.value = value;
    input.placeholder = placeholder;
    overlay.append(box);
    overlay.classList.add("open", "dim");
    input.focus();
    if (selectStem && value.includes(".")) input.setSelectionRange(0, value.lastIndexOf("."));
    else input.select();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      closeOverlay();
      resolve(v);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(input.value.trim() || null);
      if (e.key === "Escape") finish(null);
    });
    overlay.addEventListener("mousedown", (e) => e.target === overlay && finish(null), { once: true });
  });
}

let toastTimer;
export function toast(text, kind = "info") {
  let el = document.querySelector("#toast");
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "toast" });
    document.body.append(el);
  }
  el.className = kind;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
}
