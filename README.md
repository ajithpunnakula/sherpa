# Sherpa · A guide for every sales call

A POC menu-bar Mac app that helps salespeople in real time — discovery
questions, objection handling, pricing framing, competitive positioning,
follow-up drafts, and next-step recommendations — all grounded in a curated
product wiki.

Sales suggestions are powered by Anthropic Claude or OpenAI. The knowledge
base is the [coffeeandai](https://github.com/ajithpunnakula/coffeeandai)
wiki, which lives in a sibling directory and is **read-only**. This app never
writes to the source repo.

> **Honesty by design.** Sherpa is *not* stealth software. The menu-bar icon
> is always visible, the status bar tells you when the app is thinking, and
> the mic/screen/accessibility permissions are off by default and clearly
> labeled. The MVP works with manual paste only.

---

## Quickstart

```bash
# 1. install deps
npm install

# 2. configure at least one LLM provider (or skip — the app still runs)
cp .env.example .env
$EDITOR .env       # add ANTHROPIC_API_KEY or OPENAI_API_KEY

# 3. build the knowledge index from the coffeeandai repo
#    (defaults to ~/code/coffeeandai; override with COFFEEANDAI_REPO)
npm run index

# 4. run the app in dev (Vite hot-reload + Electron)
npm run dev
```

The tray icon (a small dot) will appear in the macOS menu bar. Click it or
press **⌘⇧Space** to toggle the panel. Press **⌘↩** to submit, **Esc** to
hide.

---

## How it works

```
                                    ┌─────────────────────────────┐
                                    │  coffeeandai (read-only)    │
                                    │  wiki/ raw/ courses/ docs   │
                                    └──────────────┬──────────────┘
                                                   │  npm run index
                                                   ▼
┌────────────┐    Cmd+Shift+Space   ┌─────────────────────────────┐
│  menu-bar  │ ───────────────────► │  Electron main process      │
│   tray     │                       │  (IPC, hotkey, perms)       │
└────────────┘                       │                             │
                                     │   CopilotService            │
                                     │   ├─ retriever (BM25)       │
                                     │   ├─ providers (Anthropic   │
                                     │   │     / OpenAI / stub)    │
                                     │   └─ orchestrator (modes)   │
                                     └──────────────┬──────────────┘
                                                    │  IPC
                                                    ▼
                                     ┌─────────────────────────────┐
                                     │  React panel (renderer)     │
                                     │  mode switcher · composer · │
                                     │  suggestion card · sources  │
                                     └─────────────────────────────┘
```

A user paste (objection, transcript, CRM note) goes through:

1. **Retrieval** — BM25 over chunked markdown returns the top-k wiki snippets.
2. **Prompt build** — a mode-specific system prompt (objection vs pricing
   vs discovery vs …) plus the retrieved snippets become the LLM call.
3. **LLM call** — Anthropic Claude or OpenAI (auto-selected based on which
   API key is set; explicit override is supported per-call).
4. **Render** — the structured response is parsed into copyable blocks:
   *Recommended thing to say*, *Why this works*, *Follow-up question*,
   *Proof points*, *Risk / avoid saying*, and *Sources*.

If retrieval finds nothing relevant the UI flags the answer as `generic`
(amber badge) instead of `wiki-grounded` (green).

---

## Eight sales modes

| Mode | When to use |
|------|-------------|
| Discovery | New call. Help surface pain, current solution, decision criteria, timeline. |
| Demo | About to show something. Suggest the next beat and the one-line narration. |
| Objection | The prospect just pushed back. Acknowledge → Reframe → Evidence. |
| Competitive | A competitor name came up. Differentiate honestly without bashing. |
| Pricing | Money talk. Anchor on value, never invent numbers. |
| ROI | The buyer needs to justify it internally. Frame in their units. |
| Follow-up | Draft the post-call email — subject + 4-6 sentences. |
| Closing | Propose ONE specific, easy-to-say-yes next step. |

Click the **★** button in the title bar to load a built-in demo scenario for
each mode.

---

## Environment

| Var | Purpose |
|-----|---------|
| `ANTHROPIC_API_KEY` | Use Claude. Preferred when both are set. |
| `OPENAI_API_KEY` | Use OpenAI (e.g. gpt-4o-mini). |
| `ANTHROPIC_MODEL` | Override default Claude model (default: `claude-sonnet-4-6`). |
| `OPENAI_MODEL` | Override default OpenAI model (default: `gpt-4o-mini`). |
| `COFFEEANDAI_REPO` | Path to the source wiki repo (default: `~/code/coffeeandai`). |
| `SHERPA_INDEX` | Override path to the built index JSON. |

Without any LLM key, the app still runs and shows retrieved wiki snippets
with a clearly-labeled stub response — useful for previewing the UI.

---

## Permissions

| Permission | What we use it for | Default |
|------------|--------------------|---------|
| Microphone | Future: live call transcription. Not used in MVP. | Off |
| Screen Recording | Future: contextual suggestions from visible content / OCR. Not used in MVP. | Off |
| Accessibility | Future: capture active-window metadata. Not used in MVP. | Off |
| Notifications | Future: optional "suggestion ready" alerts. Not used in MVP. | Off |

The status bar at the bottom of the panel always shows the current state of
these permissions. Clicking any of them opens the appropriate macOS System
Settings pane. The app **never** bypasses macOS privacy indicators and works
fully on manual paste alone.

---

## Project layout

```
sherpa/
├── electron/                main process (TypeScript, CommonJS at build time)
│   ├── main.ts              tray, hotkey, IPC, window mgmt
│   ├── preload.ts           contextBridge bridge for the renderer
│   └── service.ts           CopilotService — loads index, picks provider
├── server/                  pure TS modules — fully unit-tested
│   ├── kb/
│   │   ├── chunker.ts       markdown → heading-aware chunks
│   │   ├── retriever.ts     BM25 build + retrieve, heading boost
│   │   └── types.ts
│   └── copilot/
│       ├── modes.ts         8 sales modes (system prompts + structured card format)
│       ├── providers.ts     Anthropic / OpenAI / stub
│       └── orchestrator.ts  retrieve → prompt → call → return
├── src/                     React renderer (Vite)
│   ├── App.tsx
│   ├── components/          ModeSwitcher, StatusBar, SuggestionCard, Sources, DemoMenu
│   ├── lib/sherpa.ts        Typed IPC client (graceful browser fallback)
│   └── lib/demos.ts         8 built-in demo scenarios
├── scripts/
│   └── build-index.ts       Walks coffeeandai/{wiki,raw,courses,...} and writes .data/index.json
├── .data/index.json         Built index (gitignored)
├── tsconfig.json            renderer + server (ESM-ish, bundler resolution)
├── electron/tsconfig.json   Electron main process (CommonJS, outputs to dist-electron/)
├── vite.config.ts
└── package.json
```

---

## Tests

```bash
npm test
```

27 tests cover the deterministic core:

- `chunker.test.ts` — heading boundaries, paragraph packing, code fences, ids.
- `retriever.test.ts` — tokenizer (stopwords), BM25 ranking, topK, heading boost.
- `providers.test.ts` — provider selection from env, stub fallback, override.
- `modes.test.ts` — all 8 modes defined, structured card flag, fallback.
- `orchestrator.test.ts` — retrieval-to-prompt wiring, grounded flag, topK.

UI components are intentionally not unit-tested — they read state from a
typed IPC client and render. The faster feedback loop for the UI is the live
Electron app.

---

## Demo flow

1. Launch the app: `npm run dev`.
2. Press **⌘⇧Space** to open the panel.
3. Click the **★** in the title bar to open the demo menu.
4. Pick *Objection · "Why not just use ChatGPT?"*.
5. Press **⌘↩** (or click *Suggest*).
6. The panel shows a structured answer with:
   - the exact line to say,
   - the reasoning,
   - a follow-up question,
   - proof points pulled from `wiki/Solutions.md`, `architecture.md`, etc.,
   - what to avoid saying,
   - the source file paths.
7. Click **copy** on the *Recommended thing to say* block.
8. Expand the **Sources** drawer to see the raw wiki snippets the LLM used.

Try cycling through *We already use internal docs*, *This seems expensive*,
*Discovery · platform sponsor*, and so on.

---

## Limitations (POC)

- BM25 only; no semantic embeddings yet. Good enough for the wiki size
  (~5k chunks) but sometimes mis-ranks queries with very common words.
- Microphone, Screen Recording, Accessibility, and Notifications hooks are
  surfaced in the UI but not wired to capture flows yet — manual paste only.
- No CRM integration. Roadmap below.
- macOS-first. Windows/Linux Electron will boot but tray/permissions
  behaviors won't be as polished.
- Index is rebuilt manually with `npm run index`; no live file watching yet.

---

## Future improvements

- Semantic embeddings (Anthropic / OpenAI / local SBERT) as a re-ranker on
  top of BM25.
- Live mic transcription via Whisper or Apple's `SFSpeechRecognizer` (with
  visible recording indicator).
- Active window / browser context bridge for one-keystroke "what should I
  say next".
- "Insert into Slack / Gmail / chat" via the macOS clipboard or
  Accessibility APIs.
- CRM autopopulate (Salesforce, HubSpot) for follow-up emails.
- Streaming LLM responses to render the suggestion as it composes.
- Per-deal context: load CRM notes + meeting recap + prospect domain as a
  persistent context layer.

---

## License

Apache-2.0 (matching the upstream coffeeandai repo).
