export {};
interface AiErrorEntry {
  level: 'error' | 'warn';
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  count: number;
  timestamp: number;
}

let queue: AiErrorEntry[] = [];
let devtoolsOpen = false;
let lastAskBtn: HTMLButtonElement | null = null;

function capture(level: AiErrorEntry['level'], args: unknown[], stack?: string, source?: string, line?: number) {
  if ((window as unknown as Record<string, unknown>).__aiOverlayDisabled) return;

  const parts = args.map((a) => {
    try {
      return typeof a === 'object' && a !== null ? safeStringify(a) : String(a);
    } catch {
      return String(a);
    }
  });
  const message = parts.join(' ').substring(0, 500);

  const existing = queue.find((e) => e.level === level && e.message === message && e.source === source);
  if (existing) {
    existing.count += 1;
    existing.timestamp = Date.now();
  } else {
    queue.push({ level, message, stack, source, line, count: 1, timestamp: Date.now() });
    if (queue.length > 30) queue.shift();
  }
  (window as unknown as Record<string, unknown>).__aiErrors = queue;
  if (devtoolsOpen) render();
}

function safeStringify(o: unknown): string {
  const seen = new Set<unknown>();
  return JSON.stringify(o, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    if (typeof value === 'function') return '[Function]';
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
    return value;
  });
}

function buildShadowHost(): ShadowRoot | null {
  if (window !== window.top) return null;
  const doc = document.documentElement || document.body;
  if (!doc) return null;

  const existing = document.getElementById('__ai_overlay_host');
  if (existing) return existing.shadowRoot;

  const host = document.createElement('div');
  host.id = '__ai_overlay_host';
  doc.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :host { all: initial; }
    .ai-overlay {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      width: 340px;
      max-height: 45vh;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.4;
    }
    .ai-item {
      background: rgba(30, 30, 30, 0.96);
      color: #e0e0e0;
      border: 1px solid #404040;
      border-radius: 6px;
      padding: 8px 10px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      animation: aiIn 0.18s ease;
    }
    @keyframes aiIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
    .ai-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .ai-level {
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
      padding: 1px 5px;
      border-radius: 3px;
      letter-spacing: 0.5px;
    }
    .ai-level.error { background: rgba(255, 82, 82, 0.2); color: #ff5252; }
    .ai-level.warn { background: rgba(255, 193, 7, 0.2); color: #ffc107; }
    .ai-count { font-size: 10px; color: #888; margin-left: auto; }
    .ai-msg {
      color: #c0c0c0;
      word-break: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .ai-actions { display: flex; gap: 6px; margin-top: 6px; }
    .ai-btn {
      border: 1px solid #4a9eff;
      background: transparent;
      color: #4a9eff;
      padding: 3px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      transition: all 0.15s;
    }
    .ai-btn:hover { background: rgba(74, 158, 255, 0.15); }
    .ai-close {
      border: 1px solid #404040;
      background: transparent;
      color: #888;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    }
    .ai-close:hover { background: #404040; color: #e0e0e0; }
    .ai-collapse {
      position: fixed;
      right: 16px;
      bottom: 4px;
      z-index: 2147483647;
      background: rgba(30, 30, 30, 0.9);
      color: #888;
      border: 1px solid #404040;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      cursor: pointer;
    }
    .ai-collapse:hover { color: #4a9eff; border-color: #4a9eff; }
  `;
  shadow.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'ai-overlay';
  shadow.appendChild(panel);

  const collapse = document.createElement('button');
  collapse.className = 'ai-collapse';
  collapse.textContent = 'AI Debug';
  collapse.addEventListener('click', () => {
    host.remove();
    (window as unknown as Record<string, unknown>).__aiOverlayDisabled = true;
  });
  shadow.appendChild(collapse);

  return shadow;
}

const MAX_VISIBLE_ITEMS = 5;

function itemKey(entry: AiErrorEntry): string {
  return entry.level + '|' + entry.message.substring(0, 120) + '|' + (entry.source || '');
}

function render() {
  if (!devtoolsOpen) {
    hideOverlay();
    return;
  }
  if (queue.length === 0) {
    hideOverlay();
    return;
  }

  const root = buildShadowHost();
  if (!root) return;

  const panel = root.querySelector<HTMLDivElement>('.ai-overlay');
  if (!panel) return;

  const visible = queue.slice(-MAX_VISIBLE_ITEMS);
  const present = new Set(visible.map(itemKey));

  for (const child of Array.from(panel.children)) {
    const key = (child as HTMLElement).dataset.key;
    if (key && !present.has(key)) {
      child.remove();
    }
  }

  for (const entry of visible) {
    const key = itemKey(entry);
    const existing = panel.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (existing) {
      const countEl = existing.querySelector<HTMLSpanElement>('.ai-count');
      if (countEl) countEl.textContent = entry.count > 1 ? 'x' + entry.count : '';
      const timeEl = existing.querySelector<HTMLSpanElement>('.ai-time');
      if (timeEl) timeEl.textContent = new Date(entry.timestamp).toLocaleTimeString();
      continue;
    }
    panel.appendChild(buildItem(entry, key));
  }
}

function buildItem(entry: AiErrorEntry, key: string): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'ai-item';
  item.dataset.key = key;

  const head = document.createElement('div');
  head.className = 'ai-head';

  const level = document.createElement('span');
  level.className = 'ai-level ' + entry.level;
  level.textContent = entry.level;

  const time = document.createElement('span');
  time.className = 'ai-time';
  time.style.color = '#666';
  time.style.fontSize = '10px';
  time.textContent = new Date(entry.timestamp).toLocaleTimeString();

  const count = document.createElement('span');
  count.className = 'ai-count';
  count.textContent = entry.count > 1 ? 'x' + entry.count : '';

  head.append(level, time, count);

  const msg = document.createElement('div');
  msg.className = 'ai-msg';
  msg.textContent = entry.message;

  item.append(head, msg);

  if (entry.source) {
    const src = document.createElement('div');
    src.style.cssText =
      'color:#666;font-size:10px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    src.textContent = entry.source + (entry.line ? ':' + entry.line : '');
    item.append(src);
  }

  const actions = document.createElement('div');
  actions.className = 'ai-actions';

  const ask = document.createElement('button');
  ask.className = 'ai-btn';
  ask.textContent = 'Ask AI';
  ask.addEventListener('click', () => {
    if (lastAskBtn) return;
    lastAskBtn = ask;
    ask.disabled = true;
    ask.textContent = 'Sending…';
    try {
      window.postMessage(
        {
          __aiOverlayAsk: true,
          error: {
            level: entry.level,
            message: entry.message,
            stack: entry.stack,
            source: entry.source,
            line: entry.line,
            count: entry.count,
            timestamp: entry.timestamp,
            url: location.href,
          },
        },
        '*'
      );
    } catch {
      ask.disabled = false;
      ask.textContent = 'Ask AI';
      lastAskBtn = null;
    }
  });

  const close = document.createElement('button');
  close.className = 'ai-close';
  close.textContent = '✕';
  close.addEventListener('click', () => {
    item.remove();
    queue = queue.filter((e) => e !== entry);
    (window as unknown as Record<string, unknown>).__aiErrors = queue;
  });

  actions.append(ask, close);

  if (entry.source) {
    const jump = document.createElement('button');
    jump.className = 'ai-btn';
    jump.textContent = 'Jump to Source';
    actions.insertBefore(jump, ask);
    jump.addEventListener('click', () => {
      try {
        window.postMessage(
          {
            __aiOverlayJump: true,
            source: entry.source,
            line: entry.line ?? 1,
          },
          '*'
        );
      } catch {
        /* noop */
      }
    });
  }

  item.append(actions);
  return item;
}

function hideOverlay() {
  const host = document.getElementById('__ai_overlay_host');
  if (host) host.remove();
}

function onOverlayAskStatus(status: 'ok' | 'no-devtools') {
  if (!lastAskBtn) return;
  lastAskBtn.disabled = false;
  lastAskBtn.textContent = status === 'ok' ? 'Sent ✓' : 'Open DevTools';
  setTimeout(() => {
    if (lastAskBtn) {
      lastAskBtn.disabled = false;
      lastAskBtn.textContent = 'Ask AI';
      lastAskBtn = null;
    }
  }, 2000);
}

function parseSourceFromStack(stack: string | undefined): { source?: string; line?: number } {
  if (!stack) return {};
  const frame = stack.split('\n').find((f) => f.includes('http'));
  if (!frame) return {};
  const m = frame.match(/(https?:\/\/[^()\s]+?):\d+:\d+/);
  if (!m) return {};
  const loc = frame.match(/:(\d+):\d+/);
  return { source: m[1], line: loc ? parseInt(loc[1], 10) : undefined };
}

window.addEventListener('error', (e) => {
  capture('error', [e.message || 'Script error.'], e.error?.stack, e.filename, e.lineno);
});

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as { message?: string; stack?: string } | undefined;
  const parsed = parseSourceFromStack(reason?.stack);
  capture(
    'error',
    ['Unhandled Promise rejection: ' + (reason?.message !== undefined ? reason?.message : String(e.reason))],
    reason?.stack,
    parsed.source,
    parsed.line
  );
});

const origConsoleError = console.error;
const origConsoleWarn = console.warn;
console.error = function (...args: unknown[]) {
  origConsoleError.apply(console, args as Parameters<typeof console.error>);
  const err = args.find((a) => a instanceof Error) as Error | undefined;
  let stack = err?.stack;
  if (!stack) {
    const hookStack = new Error().stack || '';
    stack = hookStack.split('\n').slice(2).join('\n') || undefined;
  }
  const parsed = parseSourceFromStack(stack);
  capture('error', args, stack, parsed.source, parsed.line);
};
console.warn = function (...args: unknown[]) {
  origConsoleWarn.apply(console, args as Parameters<typeof console.warn>);
  const err = args.find((a) => a instanceof Error) as Error | undefined;
  let stack = err?.stack;
  if (!stack) {
    const hookStack = new Error().stack || '';
    stack = hookStack.split('\n').slice(2).join('\n') || undefined;
  }
  const parsed = parseSourceFromStack(stack);
  capture('warn', args, stack, parsed.source, parsed.line);
};

if (window === window.top) {
  const ensuredQueue = (window as unknown as Record<string, unknown>).__aiErrors;
  if (Array.isArray(ensuredQueue)) {
    queue = ensuredQueue as AiErrorEntry[];
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const data = e.data as { __aiOverlayDevtools?: boolean; __aiOverlayAskStatus?: 'ok' | 'no-devtools' } | null;
  if (!data || typeof data !== 'object') return;
  if (typeof data.__aiOverlayDevtools === 'boolean') {
    devtoolsOpen = data.__aiOverlayDevtools;
    if (devtoolsOpen) render();
    else hideOverlay();
    return;
  }
  if (data.__aiOverlayAskStatus) {
    onOverlayAskStatus(data.__aiOverlayAskStatus);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  render();
});
if (document.readyState !== 'loading') {
  render();
}