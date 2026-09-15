interface OverlayError {
  level: 'error' | 'warn';
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  count: number;
  timestamp: number;
  url: string;
}

function buildQuestion(err: OverlayError): string {
  const lines: string[] = [];
  lines.push('解释这个浏览器运行时错误');
  lines.push('');
  lines.push(`- 级别: ${err.level}`);
  lines.push(`- 页面: ${err.url}`);
  if (err.source) lines.push(`- 来源: ${err.source}${err.line ? ':' + err.line : ''}`);
  lines.push(`- 消息: ${err.message}`);
  lines.push(`- 次数: ${err.count}`);
  if (err.stack) {
    lines.push('');
    lines.push('堆栈:');
    lines.push('```');
    lines.push(err.stack.substring(0, 1500));
    lines.push('```');
  }
  lines.push('');
  lines.push('请定位根因并给出具体修复建议。');
  return lines.join('\n');
}

window.addEventListener('message', (e) => {
  const data = e.data as { __aiOverlayAsk?: boolean; error?: OverlayError } | null;
  if (!data || data.__aiOverlayAsk !== true || !data.error) return;
  if (e.source !== window) return;

  const question = buildQuestion(data.error);
  try {
    chrome.runtime.sendMessage({ type: 'quickAsk', question });
  } catch {
    /* background may be unavailable */
  }
});