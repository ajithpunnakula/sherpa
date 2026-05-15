import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, shell, screen, systemPreferences } from "electron";
import { promises as fs, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CopilotService } from "./service";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const isDev = process.env.NODE_ENV === "development";
// At build time main.js lives at dist-electron/electron/main.js → project root is two levels up.
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const INDEX_PATH = process.env.CLUELY_INDEX ?? join(PROJECT_ROOT, ".data", "index.json");

let panel: BrowserWindow | null = null;
let tray: Tray | null = null;
let copilot: CopilotService | null = null;
let appStatus: "idle" | "thinking" | "ready" = "idle";

// macOS: keep the app out of the Dock (menu-bar app behavior)
if (process.platform === "darwin" && app.dock) {
  app.dock.hide();
}

// We want a single instance.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ---------------------------------------------------------------------------
// Tray icon (text glyph — keeps things simple and demo-friendly)
// ---------------------------------------------------------------------------

function makeTrayImage(): Electron.NativeImage {
  // Tiny 16x16 PNG: a filled white circle on transparent — rendered as template image
  // so macOS automatically inverts for light/dark menu bars.
  const png = nativeImage.createFromBuffer(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARklEQVR4AWMYIYBxFHwUjwLGYRiYAYy" +
    "EgUQyhpFhBxxh4f8/UCpgZBwGRgZGGAEjY2QYBkbGYWBkHAZGxmFgZBwGAAAUtAR4N0aYjwAAAABJRU5ErkJggg==",
    "base64"
  ));
  png.setTemplateImage(true);
  return png;
}

function trayTitle(): string {
  switch (appStatus) {
    case "thinking": return " Cluely…";
    case "ready":    return " Cluely ✓";
    default:         return " Cluely";
  }
}

// ---------------------------------------------------------------------------
// Panel window
// ---------------------------------------------------------------------------

function createPanel(): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const width = 520;
  const height = 640;
  const x = display.workArea.x + display.workArea.width - width - 24;
  const y = display.workArea.y + 32;

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    resizable: true,
    transparent: true,
    vibrancy: "under-window",
    visualEffectState: "active",
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, "floating");

  if (isDev) {
    win.loadURL("http://localhost:5173/");
  } else {
    win.loadFile(join(PROJECT_ROOT, "dist", "index.html"));
  }

  win.on("blur", () => {
    if (!isDev) win.hide();
  });

  return win;
}

function togglePanel(): void {
  if (!panel) panel = createPanel();
  if (panel.isVisible()) {
    panel.hide();
  } else {
    positionPanelNearTray();
    panel.show();
    panel.focus();
    panel.webContents.send("cluely:focus");
  }
}

function positionPanelNearTray(): void {
  if (!panel || !tray) return;
  const trayBounds = tray.getBounds();
  const panelBounds = panel.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  // Anchor under the tray icon, clamp to display work area.
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - panelBounds.width / 2);
  let y = Math.round(trayBounds.y + trayBounds.height + 8);
  x = Math.max(display.workArea.x + 8, Math.min(x, display.workArea.x + display.workArea.width - panelBounds.width - 8));
  y = Math.max(display.workArea.y + 8, y);
  panel.setBounds({ x, y, width: panelBounds.width, height: panelBounds.height });
}

// ---------------------------------------------------------------------------
// Tray menu
// ---------------------------------------------------------------------------

function buildTrayMenu(): Menu {
  const indexInfo = copilot?.indexInfo();
  return Menu.buildFromTemplate([
    { label: "Cluely — Sales Copilot", enabled: false },
    { type: "separator" },
    { label: `Mode: ${appStatus}`, enabled: false },
    {
      label: indexInfo
        ? `Index: ${indexInfo.chunkCount} chunks · ${indexInfo.repo}`
        : "Index: not loaded (run `npm run index`)",
      enabled: false,
    },
    {
      label: `LLM: ${copilot?.providerSummary() ?? "stub (no API key)"}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Open panel  ⌘⇧Space",
      click: () => togglePanel(),
    },
    {
      label: "Rebuild index",
      click: async () => {
        await reloadIndex();
      },
    },
    { type: "separator" },
    {
      label: "Permissions…",
      submenu: [
        {
          label: `Microphone: ${micStatusLabel()}`,
          click: () => systemPreferences.askForMediaAccess("microphone"),
        },
        {
          label: "Screen Recording (System Settings)",
          click: () => shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"),
        },
        {
          label: "Accessibility (System Settings)",
          click: () => shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"),
        },
      ],
    },
    { type: "separator" },
    { label: "Quit Cluely", click: () => app.quit() },
  ]);
}

function micStatusLabel(): string {
  if (process.platform !== "darwin") return "n/a";
  return systemPreferences.getMediaAccessStatus("microphone");
}

function refreshTray(): void {
  if (!tray) return;
  tray.setTitle(trayTitle());
  tray.setContextMenu(buildTrayMenu());
}

// ---------------------------------------------------------------------------
// Copilot wiring
// ---------------------------------------------------------------------------

async function reloadIndex(): Promise<void> {
  if (!copilot) return;
  try {
    await copilot.load(INDEX_PATH);
    appStatus = "idle";
    refreshTray();
    panel?.webContents.send("cluely:index-loaded", copilot.indexInfo());
  } catch (err) {
    panel?.webContents.send("cluely:error", { message: (err as Error).message });
  }
}

function registerIpc(): void {
  ipcMain.handle("cluely:run", async (_e, payload: { mode: string; context: string; preferred?: "anthropic" | "openai" }) => {
    if (!copilot) throw new Error("Copilot not initialized");
    appStatus = "thinking";
    refreshTray();
    panel?.webContents.send("cluely:status", appStatus);
    try {
      const result = await copilot.run(payload);
      appStatus = "ready";
      refreshTray();
      panel?.webContents.send("cluely:status", appStatus);
      return result;
    } catch (err) {
      appStatus = "idle";
      refreshTray();
      panel?.webContents.send("cluely:status", appStatus);
      throw err;
    }
  });

  ipcMain.handle("cluely:meta", async () => {
    return {
      indexInfo: copilot?.indexInfo() ?? null,
      providerKind: copilot?.providerKind() ?? "stub",
      providerSummary: copilot?.providerSummary() ?? "stub",
      indexPath: INDEX_PATH,
      indexLoaded: copilot?.isLoaded() ?? false,
      micStatus: micStatusLabel(),
      hotkey: "Cmd+Shift+Space",
    };
  });

  ipcMain.handle("cluely:open-perms", async (_e, which: "microphone" | "screen" | "accessibility") => {
    if (process.platform !== "darwin") return false;
    if (which === "microphone") {
      return systemPreferences.askForMediaAccess("microphone");
    }
    const url = which === "screen"
      ? "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
      : "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("cluely:hide", () => {
    panel?.hide();
  });

  ipcMain.on("cluely:log", (_e, msg: unknown) => {
    // eslint-disable-next-line no-console
    console.log("[renderer]", msg);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  // Load .env if present (very small, no need for a dep)
  await loadDotEnv(join(PROJECT_ROOT, ".env"));

  copilot = new CopilotService({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  });

  if (existsSync(INDEX_PATH)) {
    try {
      await copilot.load(INDEX_PATH);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Failed to load index:", err);
    }
  }

  tray = new Tray(makeTrayImage());
  tray.setTitle(trayTitle());
  tray.setToolTip("Cluely · Sales Copilot");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => togglePanel());

  panel = createPanel();
  registerIpc();

  const registered = globalShortcut.register("CommandOrControl+Shift+Space", () => togglePanel());
  if (!registered) {
    // eslint-disable-next-line no-console
    console.warn("Failed to register global shortcut Cmd+Shift+Space");
  }

  refreshTray();
});

app.on("window-all-closed", () => {
  // Stay alive in the menu bar — do not call app.quit().
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

async function loadDotEnv(path: string): Promise<void> {
  try {
    const content = await fs.readFile(path, "utf8");
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    // .env is optional
  }
}
