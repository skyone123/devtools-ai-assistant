import { loadConfig } from '../shared/config.js';
import { PORT_NAME, MAX_ERROR_DETAIL_ENTRIES } from '../shared/constants.js';
import type { CollectedContext, ConversationMessage, BgToPanelMessage } from '../shared/types.js';

const DEFAULT_SYSTEM_PROMPT =
  'You are a DevTools AI assistant. Analyze the provided debugging context ' +
  'and answer the user\'s question concisely with code examples where relevant.';

function buildContextPrompt(context: CollectedContext): string {
  const parts: string[] = [];

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

  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
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
  if (port.name !== PORT_NAME) return;

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
});
