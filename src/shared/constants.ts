export const PORT_NAME = 'ai-assistant';

export const MAX_RESPONSE_BODY_LENGTH = 2000;
export const MAX_CONSOLE_MESSAGE_LENGTH = 500;
export const MAX_CONSOLE_ENTRIES = 20;
export const MAX_DOM_HTML_LENGTH = 5000;
export const MAX_CSS_LENGTH = 2000;

export const CONSOLE_INJECT_SCRIPT = `
(function() {
  if (window.__aiConsoleCaptured) return;
  window.__aiConsoleCaptured = true;
  window.__aiConsoleLog = [];
  var levels = ['log', 'error', 'warn', 'info', 'debug'];
  levels.forEach(function(level) {
    var original = console[level];
    console[level] = function() {
      var args = Array.from(arguments).map(function(a) {
        try {
          return typeof a === 'object' ? JSON.stringify(a, null, 0) : String(a);
        } catch(e) {
          return String(a);
        }
      });
      var msg = args.join(' ');
      if (msg.length > 500) msg = msg.substring(0, 500) + '...[truncated]';
      window.__aiConsoleLog.push({
        level: level,
        message: msg,
        timestamp: new Date().toISOString()
      });
      if (window.__aiConsoleLog.length > 50) {
        window.__aiConsoleLog.shift();
      }
      original.apply(console, arguments);
    };
  });
})();
`;

export const CONSOLE_READER_SCRIPT = `(window.__aiConsoleLog || []).slice(-20)`;

export const DOM_READ_SCRIPT = `
(function() {
  var el = $0;
  if (!el) return null;
  var html = el.outerHTML || '';
  if (html.length > 5000) html = html.substring(0, 5000) + '...[truncated]';
  var styles = '';
  try {
    var cs = window.getComputedStyle(el);
    var props = [];
    for (var i = 0; i < cs.length; i++) {
      var prop = cs[i];
      var val = cs.getPropertyValue(prop);
      if (val) props.push(prop + ': ' + val);
    }
    styles = props.join('; ');
    if (styles.length > 2000) styles = styles.substring(0, 2000) + '...[truncated]';
  } catch(e) {
    styles = '(unable to read computed styles)';
  }
  return { html: html, computedStyles: styles };
})()
`;

export const PAGE_INFO_SCRIPT = `
(function() {
  return {
    url: location.href,
    title: document.title
  };
})()
`;
