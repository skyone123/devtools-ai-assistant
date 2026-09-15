import { loadConfig } from '../shared/config.js';
import { PORT_NAME, MAX_ERROR_DETAIL_ENTRIES } from '../shared/constants.js';
import type { CollectedContext, ConversationMessage, BgToPanelMessage } from '../shared/types.js';

const DEFAULT_SYSTEM_PROMPT =
  '你是 DevTools AI 调试助手。请基于提供的调试上下文分析并回答用户的问题，回答要简洁，必要时给出代码示例。';

const activeDevtoolsTabs = new Set<number>();

function buildContextPrompt(context: CollectedContext): string {
  const parts: string[] = [];

  if (context.focusEntry) {
    const req = context.focusEntry;
    parts.push('## Focused Request (user double-clicked this request in Network panel — full details)');
    parts.push(`- ${req.method} ${req.url}`);
    parts.push(`- Status: ${req.status} ${req.statusText}`);
    parts.push(`- Duration: ${req.duration.toFixed(0)}ms, MIME: ${req.mimeType}`);
    if (req.count > 1) parts.push(`- Occurrences: ${req.count} (showing latest)`);
    if (req.requestHeaders.length > 0) {
      parts.push('Request Headers:');
      for (const h of req.requestHeaders.slice(0, 15)) {
        parts.push(`  ${h.name}: ${h.value}`);
      }
    }
    if (req.requestBody) {
      parts.push('Request Body:');
      parts.push('```\n' + req.requestBody + '\n```');
    }
    if (req.responseHeaders.length > 0) {
      parts.push('Response Headers:');
      for (const h of req.responseHeaders.slice(0, 15)) {
        parts.push(`  ${h.name}: ${h.value}`);
      }
    }
    if (req.responseBody) {
      parts.push('Response Body:');
      parts.push('```\n' + req.responseBody + '\n```');
    } else {
      parts.push('- (response body unavailable — may have been evicted from memory, analyze from headers and list)');
    }
    parts.push('');
  }

  if (context.dom) {
    parts.push('## Page');
    parts.push(`- URL: ${context.dom.url}`);
    parts.push(`- Title: ${context.dom.title}`);
    if (context.dom.selectedHtml) {
      parts.push('### Selected Element HTML');
      parts.push('```html\n' + context.dom.selectedHtml + '\n```');
    }
    if (context.dom.computedStyles) {
      parts.push('### Computed Styles');
      parts.push('```css\n' + context.dom.computedStyles + '\n```');
    }
  }

  if (context.network && context.network.length > 0) {
    parts.push(`## Network Requests (${context.network.length} unique, static resources filtered)`);
    for (const req of context.network) {
      const isError = req.status >= 400 ? ' [ERROR]' : '';
      const countInfo = req.count > 1 ? ` x${req.count} times` : '';
      parts.push(`- ${req.method} ${req.url} -> ${req.status} ${req.statusText} (${req.duration.toFixed(0)}ms, ${req.mimeType})${countInfo}${isError}`);
    }

    const errorReqs = context.network.filter((r) => r.status >= 400);
    if (errorReqs.length > 0) {
      parts.push('### Error Request Details');
      for (const req of errorReqs.slice(-MAX_ERROR_DETAIL_ENTRIES)) {
        parts.push(`#### ${req.method} ${req.url} (${req.status} ${req.statusText})`);
        if (req.requestHeaders.length > 0) {
          parts.push('Request Headers:');
          for (const h of req.requestHeaders.slice(0, 10)) {
            parts.push(`  ${h.name}: ${h.value}`);
          }
        }
        if (req.requestBody) {
          parts.push('Request Body:');
          parts.push('```\n' + req.requestBody + '\n```');
        }
        if (req.responseHeaders.length > 0) {
          parts.push('Response Headers:');
          for (const h of req.responseHeaders.slice(0, 10)) {
            parts.push(`  ${h.name}: ${h.value}`);
          }
        }
        if (req.responseBody) {
          parts.push('Response Body:');
          parts.push('```\n' + req.responseBody + '\n```');
        }
      }
    }
  }

  if (context.console && context.console.length > 0) {
    parts.push('## Console Messages');
    for (const msg of context.console) {
      parts.push(`[${msg.level.toUpperCase()}] ${msg.message}`);
      if (msg.stack) {
        parts.push('Stack:');
        parts.push('```\n' + msg.stack + '\n```');
      }
    }
  }

  if (context.analysis) {
    const a = context.analysis;
    if (a.diff) {
      parts.push('## Request Response Diff');
      const d = a.diff;
      parts.push(`- Path: ${d.absolutePath || '(unknown)'}`);
      parts.push(`- Identical: ${d.same ? 'yes' : 'no'}`);
      parts.push(`- Added: ${d.addedValues} value(s), Removed: ${d.removedValues} value(s)`);
      for (const add of d.added.slice(0, 20)) parts.push(`  + ${add.path} = ${add.to}`);
      for (const rm of d.removed.slice(0, 20)) parts.push(`  - ${rm.path} (was ${rm.from})`);
      for (const chg of d.changed.slice(0, 20)) parts.push(`  ~ ${chg.path}: ${chg.from} → ${chg.to}`);
      if (d.truncated) parts.push('  (diff truncated)');
      parts.push('');
      parts.push('请分析后端在两次调用之间是否改变了响应 schema，重点关注可能导致前端出错的字段级变化。');
    }
    if (a.sensitive && a.sensitive.length > 0) {
      parts.push('## Sensitive Data Scan');
      for (const hit of a.sensitive.slice(0, 30)) {
        parts.push(`- [${hit.type}] ${hit.location} — ${hit.sample}`);
        if (hit.context) parts.push(`  context: ${hit.context}`);
      }
      parts.push('');
      parts.push('请评估每处泄露的严重程度并给出修复建议。');
    }
    if (a.authAudit && a.authAudit.length > 0) {
      parts.push('## Auth Coverage Audit');
      parts.push('Endpoints WITHOUT Authorization header:');
      let count = 0;
      for (const e of a.authAudit) {
        if (!e.hasAuth) {
          parts.push(`- ${e.method} ${e.url.split('?')[0]}${e.sensitive ? ' [sensitive]' : ''}${e.bodySent ? ' (sends body)' : ''}`);
          if (++count >= 25) {
            parts.push('  (more omitted)');
            break;
          }
        }
      }
      if (count === 0) parts.push('  (none detected)');
      parts.push('');
      parts.push('请识别哪些接口本应要求鉴权却未携带认证信息，并评估其风险。');
    }
    if (a.securityHeaders && a.securityHeaders.length > 0) {
      const counts = { csp: 0, hsts: 0, xfo: 0, xcto: 0 };
      for (const issue of a.securityHeaders) for (const m of issue.missing) counts[m]++;
      parts.push('## Security Headers Audit');
      parts.push(
        `Missing headers across ${a.securityHeaders.length} response(s): ` +
          `CSP=${counts.csp}, HSTS=${counts.hsts}, X-Frame-Options=${counts.xfo}, X-Content-Type-Options=${counts.xcto}`
      );
      for (const issue of a.securityHeaders.slice(0, 5)) {
        parts.push(`- ${issue.url.split('?')[0]}: missing ${issue.missing.join(', ')}`);
      }
      parts.push('');
      parts.push('请解释这些缺失的安全响应头带来的风险，并给出修复方案。');
    }
    if (a.attackSurface && a.attackSurface.length > 0) {
      parts.push('## API Attack Surface');
      for (const e of a.attackSurface.slice(0, 30)) {
        const params = Array.from(e.queryParams).slice(0, 8).join(', ') || '—';
        parts.push(`- ${e.methods.join(',')} ${e.pattern}${e.hasAuth ? '' : ' [no-auth]'} params: ${params}`);
      }
      parts.push('');
      parts.push('（仅限授权安全测试）针对这个 API 攻击面，建议值得深入的 IDOR / 批量赋值等测试点，并说明理由。');
    }
    if (a.waterfall && a.waterfall.length > 0) {
      parts.push('## Performance Waterfall');
      for (const w of a.waterfall.slice(0, 30)) {
        const t = w.timings;
        parts.push(
          `- ${w.method} ${w.url.split('?')[0]} ${Math.round(w.totalTime)}ms ` +
            `(wait ${Math.round(t.wait ?? 0)}ms, dns ${Math.round(t.dns ?? 0)}ms, connect ${Math.round(t.connect ?? 0)}ms, blocked ${Math.round(t.blocked ?? 0)}ms)`
        );
      }
      parts.push('');
      parts.push('请找出慢的串行请求、高 TTFB、以及可以并行化或合并的资源。');
    }
  }

  return parts.join('\n');
}

function buildMessages(
  context: CollectedContext,
  question: string,
  history: ConversationMessage[],
  customSystemPrompt: string
) {
  const systemContent = customSystemPrompt
    ? DEFAULT_SYSTEM_PROMPT + '\n\n' + customSystemPrompt
    : DEFAULT_SYSTEM_PROMPT;

  const contextStr = buildContextPrompt(context);
  const userContent = contextStr
    ? contextStr + '\n\n## Question\n' + question
    : question;

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: systemContent },
  ];

  let budget = 8000;
  const trimmed: ConversationMessage[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const content = typeof history[i].content === 'string' ? history[i].content : '';
    const cost = Math.ceil(content.length / 4);
    if (budget - cost < 0) break;
    budget -= cost;
    trimmed.unshift(history[i]);
  }

  let prevRole = '';
  for (const msg of trimmed) {
    if (msg.role === prevRole) {
      if (messages.length > 0 && messages[messages.length - 1].role === msg.role) {
        messages[messages.length - 1].content += '\n\n' + msg.content;
        continue;
      }
    }
    messages.push({ role: msg.role, content: msg.content });
    prevRole = msg.role;
  }

  messages.push({ role: 'user', content: userContent });

  return messages;
}

async function streamChatCompletion(
  port: chrome.runtime.Port,
  messages: { role: string; content: string }[],
  config: { apiEndpoint: string; apiKey: string; modelName: string; temperature: number },
  signal?: AbortSignal
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.modelName,
      messages,
      stream: true,
      temperature: config.temperature,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    port.postMessage({ type: 'error', message: `API ${response.status}: ${errorText}` } as BgToPanelMessage);
    return;
  }

  if (!response.body) {
    port.postMessage({ type: 'error', message: 'No response body' } as BgToPanelMessage);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        port.postMessage({ type: 'done' } as BgToPanelMessage);
        return;
      }

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          port.postMessage({ type: 'chunk', content: delta } as BgToPanelMessage);
        }
      } catch {
        // skip unparseable chunks
      }
    }
  }

  port.postMessage({ type: 'done' } as BgToPanelMessage);
}

chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  if (port.name === PORT_NAME) {
    handleAskPort(port);
    return;
  }

  if (port.name === 'ai-devtools') {
    let tabId: number | null = null;
    port.onMessage.addListener((message: { type?: string; tabId?: number }) => {
      if (typeof message?.tabId === 'number') {
        tabId = message.tabId;
      }
      if (message?.type === 'hello' && tabId != null) {
        activeDevtoolsTabs.add(tabId);
      }
      if (message?.type === 'ping' && tabId != null) {
        activeDevtoolsTabs.add(tabId);
      }
    });
    port.onDisconnect.addListener(() => {
      if (tabId != null) {
        activeDevtoolsTabs.delete(tabId);
      }
    });
    return;
  }

  if (port.name === 'ai-overlay') {
    const senderTabId = port.sender?.tab?.id;
    if (senderTabId == null) return;
    port.onMessage.addListener((message: { type?: string }) => {
      if (message?.type === 'probe') {
        port.postMessage({ type: 'ai-overlay-open', open: activeDevtoolsTabs.has(senderTabId) });
      }
    });
    port.onDisconnect.addListener(() => {
      /* background owns no state for overlay ports */
    });
  }
});

function handleAskPort(port: chrome.runtime.Port) {
  let abortController: AbortController | null = null;

  port.onMessage.addListener(async (message) => {
    if (message.type === 'abort') {
      abortController?.abort();
      return;
    }
    if (message.type !== 'ask') return;

    abortController = new AbortController();
    const current = abortController;

    try {
      const config = await loadConfig();
      const messages = buildMessages(
        message.context,
        message.question,
        message.history,
        config.systemPrompt
      );

      await streamChatCompletion(
        port,
        messages,
        {
          apiEndpoint: config.apiEndpoint,
          apiKey: config.apiKey,
          modelName: config.modelName,
          temperature: config.temperature,
        },
        current.signal
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        port.postMessage({ type: 'done' } as BgToPanelMessage);
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        port.postMessage({ type: 'error', message: errorMsg } as BgToPanelMessage);
      }
    } finally {
      if (abortController === current) {
        abortController = null;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    abortController?.abort();
    abortController = null;
  });
}
