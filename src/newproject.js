// File | New Project…: PyCharm's "Pure Python" project dialog (name, location, git, welcome script, interpreter).
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, dirname, join } from "./api.js";
import { keymap, label, doubleShiftLabel, tildify, normalizePath } from "./platform.js";
import { icons } from "./icons.js";
import { overlay, closeOverlay } from "./popups.js";

/** PyCharm's main.py welcome script, with Pyrite's shortcuts for this OS. */
export function welcomeScript() {
  return `# This is a sample Python script.

# Press ${label(keymap.runFile)} to execute it or replace it with your code.
# Press ${doubleShiftLabel} to search for files in the project.


def print_hi(name):
    # Use a breakpoint in the code line below to debug your script.
    print(f'Hi, {name}')  # Press ${label(keymap.toggleBreakpoint)} to toggle the breakpoint.


# Press the green run button in the toolbar to run the script.
if __name__ == '__main__':
    print_hi('Pyrite')
`;
}

const field = (labelText, control) => {
  const row = document.createElement("div");
  row.className = "form-row";
  const l = document.createElement("label");
  l.textContent = labelText;
  row.append(l, control);
  return row;
};

/** Resolves with `{ root, interpreter, welcome }` once the project exists on disk, or null when cancelled. */
export function newProjectDialog() {
  return new Promise(async (resolve) => {
    closeOverlay();
    const home = await api.projectsHome().catch(() => "");
    const userHome = dirname(home);
    const existing = new Set((await api.listDir(home).catch(() => [])).map((e) => e.name));
    let name = "pythonProject";
    for (let i = 1; existing.has(name); i++) name = `pythonProject${i}`;

    const box = document.createElement("div");
    box.className = "modal dialog new-project";
    box.innerHTML = `
      <div class="dialog-title">New Project</div>
      <div class="dialog-body">
        <nav class="dialog-side"><div class="side-item selected"><span class="icon"></span>Pure Python</div></nav>
        <div class="dialog-content"></div>
      </div>
      <div class="dialog-footer"><span class="dialog-error"></span><button class="secondary" data-act="cancel">Cancel</button><button class="primary" data-act="create">Create</button></div>`;
    box.querySelector(".side-item .icon").innerHTML = icons.python;
    const content = box.querySelector(".dialog-content");
    const error = box.querySelector(".dialog-error");

    const nameInput = Object.assign(document.createElement("input"), { value: name, spellcheck: false });
    const locInput = Object.assign(document.createElement("input"), { value: home, spellcheck: false });
    const browse = Object.assign(document.createElement("button"), { className: "icon-btn", title: "Browse…" });
    browse.innerHTML = icons.folder;
    const locWrap = document.createElement("div");
    locWrap.className = "input-with-button";
    locWrap.append(locInput, browse);
    const where = document.createElement("div");
    where.className = "form-hint";

    const check = (text, checked) => {
      const l = document.createElement("label");
      l.className = "checkbox";
      const c = Object.assign(document.createElement("input"), { type: "checkbox", checked });
      l.append(c, document.createTextNode(text));
      return [l, c];
    };
    const [gitRow, gitBox] = check("Create Git repository", false);
    const [welcomeRow, welcomeBox] = check("Create a main.py welcome script", true);

    const envTypes = document.createElement("div");
    envTypes.className = "segmented";
    const envs = [["venv", "Project venv"], ["uv", "uv"], ["base", "Base Python"]];
    let envType = "venv";
    for (const [id, text] of envs) {
      const b = Object.assign(document.createElement("button"), { textContent: text });
      b.dataset.env = id;
      b.addEventListener("click", () => {
        envType = id;
        update();
      });
      envTypes.append(b);
    }
    const pySelect = document.createElement("select");
    pySelect.append(new Option("Detecting…", ""));
    const pyBrowse = Object.assign(document.createElement("button"), { className: "link", textContent: "Select path…" });
    const pyWrap = document.createElement("div");
    pyWrap.className = "input-with-button";
    pyWrap.append(pySelect, pyBrowse);
    const envHint = document.createElement("div");
    envHint.className = "form-hint";

    content.append(
      field("Name:", nameInput),
      field("Location:", locWrap),
      where,
      Object.assign(document.createElement("div"), { className: "form-checks" }),
      Object.assign(document.createElement("div"), { className: "form-section", textContent: "Interpreter type" }),
      envTypes,
      field("Python version:", pyWrap),
      envHint
    );
    content.querySelector(".form-checks").append(gitRow, welcomeRow);

    const expand = (p) => normalizePath(p.trim().replace(/^~(?=\/|$)/, userHome));
    const target = () => join(expand(locInput.value), nameInput.value.trim());
    function update() {
      where.textContent = `Project will be created in: ${tildify(target())}`;
      for (const b of envTypes.children) b.classList.toggle("active", b.dataset.env === envType);
      envHint.textContent =
        envType === "venv"
          ? `Python virtual environment will be created in the project root: ${tildify(join(target(), ".venv"))}`
          : envType === "uv"
            ? `uv environment will be created in the project root: ${tildify(join(target(), ".venv"))}`
            : "The project will use this interpreter directly, without a virtual environment.";
      error.textContent = "";
    }
    nameInput.addEventListener("input", update);
    locInput.addEventListener("input", update);
    browse.addEventListener("click", async () => {
      const dir = await openDialog({ directory: true, defaultPath: expand(locInput.value), title: "Select Base Directory for the Project" });
      if (dir) (locInput.value = normalizePath(dir)), update();
    });
    pyBrowse.addEventListener("click", async () => {
      const file = await openDialog({ directory: false, title: "Select Python Interpreter" });
      if (!file) return;
      try {
        const info = await api.interpreterInfo(normalizePath(file));
        pySelect.prepend(new Option(`Python ${info.version}  ${tildify(info.path)}`, info.path));
        pySelect.value = info.path;
      } catch (err) {
        error.textContent = String(err);
      }
    });

    api.findPythons().then((list) => {
      pySelect.replaceChildren(...list.map((i) => new Option(`Python ${i.version}  ${tildify(i.path)}`, i.path)));
      if (!list.length) pySelect.append(new Option("No interpreters found: use Select path…", ""));
    });
    api.hasUv().then((uv) => {
      if (!uv) envTypes.querySelector('[data-env="uv"]').remove();
    });

    let busy = false;
    const finish = (v) => {
      document.removeEventListener("keydown", onKey, true);
      closeOverlay();
      resolve(v);
    };
    async function create() {
      if (busy) return;
      const root = target();
      if (!nameInput.value.trim()) return (error.textContent = "Enter a project name");
      if (/[\\/:*?"<>|]/.test(nameInput.value.trim())) return (error.textContent = "The name contains characters that aren't allowed in folder names");
      if (!pySelect.value) return (error.textContent = "Select a Python interpreter");
      busy = true;
      box.classList.add("busy");
      const createBtn = box.querySelector('[data-act="create"]');
      createBtn.textContent = envType === "base" ? "Creating…" : "Creating environment…";
      try {
        const interpreter = await api.createProject({ path: root, env: envType, python: pySelect.value, git: gitBox.checked });
        let welcome = null;
        if (welcomeBox.checked) {
          welcome = join(root, "main.py");
          // Never overwrite a main.py that is already there.
          await api.createFile(welcome).then(() => api.writeFile(welcome, welcomeScript()), () => {});
        }
        finish({ root, interpreter, welcome });
      } catch (err) {
        busy = false;
        box.classList.remove("busy");
        createBtn.textContent = "Create";
        error.textContent = String(err);
      }
    }
    function onKey(e) {
      if (e.key === "Escape" && !busy) finish(null), e.stopPropagation();
      if (e.key === "Enter" && e.target.tagName !== "BUTTON") create(), e.preventDefault();
    }
    document.addEventListener("keydown", onKey, true);
    box.querySelector('[data-act="cancel"]').addEventListener("click", () => !busy && finish(null));
    box.querySelector('[data-act="create"]').addEventListener("click", create);

    overlay.append(box);
    overlay.classList.add("open", "dim", "locked");
    update();
    nameInput.focus();
    nameInput.select();
  });
}
