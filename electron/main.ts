import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, shell, screen, systemPreferences, session, desktopCapturer } from "electron";
import { promises as fs, existsSync, createWriteStream, mkdirSync, WriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { CopilotService } from "./service";

// ---------------------------------------------------------------------------
// File logger — every meaningful event goes here so we can `tail -f` and so a
// future Claude session can read the log without screenshots.
// ---------------------------------------------------------------------------

let logStream: WriteStream | null = null;
let logPath = "";

function initLogger(projectRoot: string): void {
  const dir = join(projectRoot, ".data");
  try { mkdirSync(dir, { recursive: true }); } catch {}
  logPath = join(dir, "sherpa-dev.log");
  logStream = createWriteStream(logPath, { flags: "a" });
  const banner = `\n=== sherpa dev session started ${new Date().toISOString()} (pid ${process.pid}) ===\n`;
  logStream.write(banner);
  // eslint-disable-next-line no-console
  console.log("[sherpa] log file:", logPath);

  // Capture main-process console as well.
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const wrap = (level: "log" | "warn" | "error") => (...args: unknown[]) => {
    orig[level](...args);
    log(level === "log" ? "info" : level, "main", args.map(fmtArg).join(" "));
  };
  console.log = wrap("log");
  console.warn = wrap("warn");
  console.error = wrap("error");

  process.on("uncaughtException", (err) => log("error", "main", "uncaughtException " + (err.stack ?? err.message)));
  process.on("unhandledRejection", (reason) => log("error", "main", "unhandledRejection " + String(reason)));
}

function fmtArg(a: unknown): string {
  if (typeof a === "string") return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

function log(level: "info" | "warn" | "error", src: string, msg: string): void {
  if (!logStream) return;
  const line = `${new Date().toISOString()} [${src}] [${level}] ${msg}\n`;
  logStream.write(line);
}

// Per-call transcript log. One JSONL file per app session, lazily created on
// first transcript chunk. Lives alongside sherpa-dev.log so it's easy to find.
let callLogStream: WriteStream | null = null;
let callLogPath = "";

function appendCallLog(entry: { source: "me" | "them"; text: string; ts: number }): void {
  if (!callLogStream) {
    const dir = join(PROJECT_ROOT, ".data", "calls");
    try { mkdirSync(dir, { recursive: true }); } catch {}
    callLogPath = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
    callLogStream = createWriteStream(callLogPath, { flags: "a" });
    console.log("[sherpa] call log:", callLogPath);
  }
  callLogStream.write(JSON.stringify(entry) + "\n");
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const isDev = process.env.NODE_ENV === "development";
// At build time main.js lives at dist-electron/electron/main.js → project root is two levels up.
const PROJECT_ROOT = resolve(__dirname, "..", "..");
const INDEX_PATH = process.env.SHERPA_INDEX ?? join(PROJECT_ROOT, ".data", "index.json");

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
    case "thinking": return " Sherpa…";
    case "ready":    return " Sherpa ✓";
    default:         return " Sherpa";
  }
}

// ---------------------------------------------------------------------------
// Panel window
// ---------------------------------------------------------------------------

// Side-dock geometry: thin column on the right edge, half the work-area
// height, top-aligned. Resizable so the user can widen or lengthen it.
const PANEL_WIDTH = 380;
const PANEL_HEIGHT_RATIO = 0.5;

function createPanel(): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const { x: waX, y: waY, width: waW, height: waH } = display.workArea;
  const panelH = Math.round(waH * PANEL_HEIGHT_RATIO);
  const x = waX + waW - PANEL_WIDTH;
  const y = waY;

  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: panelH,
    x,
    y,
    minWidth: 280,
    minHeight: 240,
    show: false,
    frame: false,
    resizable: true,
    transparent: true,
    hasShadow: false,
    // No vibrancy — it draws an opaque-ish NSVisualEffectView behind the
    // webview that defeats CSS transparency. Backdrop-filter on .glass
    // blurs the actual desktop pixels for legibility.
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    roundedCorners: true,
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
    // Detached so DevTools doesn't squeeze the panel.
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(join(PROJECT_ROOT, "dist", "index.html"));
  }

  // No blur-hide: the side dock is meant to stay visible while the user works
  // in other apps. Cmd+Shift+Space or the tray icon toggles show/hide.

  return win;
}

function togglePanel(): void {
  if (!panel) panel = createPanel();
  if (panel.isVisible()) {
    panel.hide();
  } else {
    dockPanelRight();
    panel.show();
    panel.focus();
    panel.webContents.send("sherpa:focus");
  }
}

function dockPanelRight(): void {
  if (!panel) return;
  const pt = tray ? tray.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
  const display = tray
    ? screen.getDisplayNearestPoint({ x: pt.x, y: pt.y })
    : screen.getPrimaryDisplay();
  const { x: waX, y: waY, width: waW, height: waH } = display.workArea;
  const bounds = panel.getBounds();
  const currentWidth = bounds.width || PANEL_WIDTH;
  // Preserve the user's chosen height if they've resized; otherwise default
  // to half the work-area height, top-aligned.
  const currentHeight = bounds.height && bounds.height !== waH
    ? bounds.height
    : Math.round(waH * PANEL_HEIGHT_RATIO);
  panel.setBounds({
    x: waX + waW - currentWidth,
    y: waY,
    width: currentWidth,
    height: currentHeight,
  });
}

// ---------------------------------------------------------------------------
// Tray menu
// ---------------------------------------------------------------------------

function buildTrayMenu(): Menu {
  const indexInfo = copilot?.indexInfo();
  return Menu.buildFromTemplate([
    { label: "Sherpa — Sales Copilot", enabled: false },
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
    { label: "Quit Sherpa", click: () => app.quit() },
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
    panel?.webContents.send("sherpa:index-loaded", copilot.indexInfo());
  } catch (err) {
    panel?.webContents.send("sherpa:error", { message: (err as Error).message });
  }
}

// Active streaming requests, keyed by client-supplied id so the renderer can cancel.
const activeStreams = new Map<string, AbortController>();

function registerIpc(): void {
  ipcMain.handle("sherpa:run", async (_e, payload: { mode: string; context: string; history?: import("../server/copilot/orchestrator").Turn[]; preferred?: "anthropic" | "openai" }) => {
    if (!copilot) throw new Error("Copilot not initialized");
    appStatus = "thinking";
    refreshTray();
    panel?.webContents.send("sherpa:status", appStatus);
    try {
      const result = await copilot.run(payload);
      appStatus = "ready";
      refreshTray();
      panel?.webContents.send("sherpa:status", appStatus);
      return result;
    } catch (err) {
      appStatus = "idle";
      refreshTray();
      panel?.webContents.send("sherpa:status", appStatus);
      throw err;
    }
  });

  ipcMain.handle("sherpa:run-stream", async (e, payload: { id: string; mode: string; context: string; history?: import("../server/copilot/orchestrator").Turn[]; preferred?: "anthropic" | "openai" }) => {
    if (!copilot) throw new Error("Copilot not initialized");
    const { id } = payload;
    // Cancel any prior stream with the same id.
    activeStreams.get(id)?.abort();
    const ac = new AbortController();
    activeStreams.set(id, ac);
    appStatus = "thinking";
    refreshTray();
    e.sender.send("sherpa:status", appStatus);
    (async () => {
      try {
        const stream = copilot!.runStream(payload, ac.signal);
        for await (const frame of stream) {
          if (ac.signal.aborted) break;
          e.sender.send("sherpa:stream", { id, ...frame });
        }
        if (!ac.signal.aborted) {
          appStatus = "ready";
          refreshTray();
          e.sender.send("sherpa:status", appStatus);
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          e.sender.send("sherpa:stream", { id, kind: "error", message: (err as Error).message });
          appStatus = "idle";
          refreshTray();
          e.sender.send("sherpa:status", appStatus);
        }
      } finally {
        if (activeStreams.get(id) === ac) activeStreams.delete(id);
      }
    })();
    return { id };
  });

  ipcMain.handle("sherpa:cancel-stream", async (_e, id: string) => {
    activeStreams.get(id)?.abort();
    activeStreams.delete(id);
    return true;
  });

  ipcMain.on("sherpa:transcript", (_e, payload: { source: "me" | "them"; text: string; ts: number }) => {
    appendCallLog(payload);
  });

  ipcMain.handle("sherpa:meta", async () => {
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

  ipcMain.handle("sherpa:open-perms", async (_e, which: "microphone" | "screen" | "accessibility") => {
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

  ipcMain.handle("sherpa:hide", () => {
    panel?.hide();
  });

  ipcMain.on("sherpa:log", (_e, payload: { level?: "info" | "warn" | "error"; src?: string; msg?: string } | string) => {
    if (typeof payload === "string") {
      log("info", "renderer", payload);
      return;
    }
    log(payload?.level ?? "info", payload?.src ?? "renderer", payload?.msg ?? "");
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function registerMediaPermissions(): void {
  const s = session.defaultSession;

  // Grant mic/camera/display permission requests from the renderer.
  s.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === "media" || permission === "display-capture") {
      callback(true);
      return;
    }
    callback(false);
  });

  // Required for getDisplayMedia: tell Electron which source to share.
  // We hand back the primary display's audio loopback (entire screen) so the
  // renderer can capture system audio. The video track is required by the API
  // but the renderer discards it immediately.
  s.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      const primary = sources[0];
      if (!primary) {
        callback({});
        return;
      }
      // `enableLocalAudio: true` enables loopback audio capture on macOS 13+.
      callback({ video: primary, audio: "loopback" });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("setDisplayMediaRequestHandler failed:", err);
      callback({});
    }
  }, { useSystemPicker: false });
}

app.whenReady().then(async () => {
  initLogger(PROJECT_ROOT);
  // Load .env if present (very small, no need for a dep)
  await loadDotEnv(join(PROJECT_ROOT, ".env"));
  registerMediaPermissions();

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
  tray.setToolTip("Sherpa · Sales Copilot");
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
