# DevTools AI Assistant

A Chrome DevTools panel powered by **your own model endpoint**. Analyze network requests, console errors and DOM with an AI assistant — no Google account, no Gemini subscription, works with any OpenAI-compatible API (local Ollama included).

## Features

- **Streaming chat panel** in a dedicated `AI Assistant` DevTools tab
- **Rich context injection**: network requests (deduped, static resources filtered), console errors (merged with on-page overlay captures), page/DOM info, `Inspect`-selected element
- **Double-click any Network row** to ask AI about that specific request — full headers, request body and response body are attached (`Focused Request` section in the prompt), even for 200s
- **Elements sidebar pane** with one-click prompts (failed requests / console errors / selected element)
- **On-page error overlay** (content script, Shadow DOM): captures runtime errors with real source location while DevTools is open; `Ask AI` and `Jump to Source` buttons
- **JWT token sentinel**: decodes `Authorization: Bearer` tokens, shows remaining lifetime, one-click copy
- **Analysis tool suite** (local pre-analysis + AI interpretation):
  | Tool | What it does |
  |------|--------------|
  | Response Diff | Field-level JSON diff between two calls of the same endpoint — catch silent backend schema changes |
  | Sensitive Scan | Regex sweep of URLs/headers/bodies for AWS keys, private keys, JWTs, internal IPs, phone/ID/email leaks |
  | Auth Audit | Lists endpoints that were called without an `Authorization` header |
  | Security Headers | CSP / HSTS / X-Frame-Options / X-Content-Type-Options gap check |
  | Attack Surface | Normalizes observed paths into patterns (`{id}`, `{uuid}`), enumerates methods and query params |
  | Perf Waterfall | HAR timings analysis: slow requests, high TTFB, serial request chains |
  | Mock Generator | Takes a real JSON response and asks the model for boundary-test variants |
- Copy buttons on every code block, Stop (abort) during streaming, IME-safe input

## Install

**From Releases (no tooling needed):** download `devtools-ai-assistant-vX.Y.Z.zip` from the [latest release](../../releases), unzip it, then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the unzipped `devtools-ai-assistant-X.Y.Z` folder.

**From source:**

```bash
pnpm install
pnpm build        # or: node build.mjs
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the **`dist/`** directory (not the repo root).

For live development: `pnpm dev` (esbuild watch).

## Configure

Open the extension's Options page (or the gear icon in the panel) and set:

- **API Endpoint** — any OpenAI-compatible `/chat/completions` URL. Default hint: `http://localhost:11434/v1/chat/completions` (Ollama)
- **API Key** — stored in `chrome.storage.local` (never synced, never committed)
- **Model Name**, optional **System Prompt** and **Temperature**

Use **Test Connection** to verify before chatting.

## Privacy

The extension runs entirely locally; nothing is sent anywhere except the inference request itself, which goes **only to the endpoint you configure**. The context payload includes URL, request/response headers and (for errors or focused requests) response bodies. Treat remote endpoints accordingly: they will see everything the AI can read, including the sensitive-scan samples. Point it at a local model for full privacy.

> **Authorized security testing only.** The Attack Surface / Auth Audit features are for systems you own or are explicitly permitted to test.

## Project structure

```
src/
  shared/      types, constants, config helpers
  devtools/    DevTools page: panel/sidebar registration, network watch,
               double-click interception (setOpenResourceHandler),
               DevTools-open probe for the overlay
  panel/       chat UI, context collectors, analysis tools
    collectors/network.ts   request store (live + HAR backfill, body cache)
    analysis/               diff / jwt / security / attack-surface / waterfall
  background/  MV3 service worker: port handling, prompt building,
               streaming to the OpenAI-compatible endpoint
  options/     settings page
  content/     on-page error overlay (MAIN world + bridge)
  sidebar/     Elements sidebar quick prompts
```

## Development

- `pnpm typecheck` / `pnpm build` / `pnpm dev`
- DevTools pages historically dislike `type="module"` scripts; the build bundles classic scripts, and top-level names must not shadow globals (e.g. `history`)
- The DevTools page (`devtools.html`) loads as soon as DevTools opens; the panel loads lazily — cross-page messages that must survive "panel not opened yet" are queued in the DevTools page

## License

MIT
