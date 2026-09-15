export const PORT_NAME = 'ai-assistant';

export const MAX_RESPONSE_BODY_LENGTH = 2000;
export const MAX_CONSOLE_MESSAGE_LENGTH = 500;
export const MAX_CONSOLE_ENTRIES = 20;
export const MAX_NETWORK_ENTRIES = 60;
export const MAX_ERROR_DETAIL_ENTRIES = 5;
export const MAX_FOCUS_BODY_LENGTH = 4000;
export const MAX_DOM_HTML_LENGTH = 5000;
export const MAX_CSS_LENGTH = 2000;

export const CONSOLE_INJECT_SCRIPT = `
(function() {
  if (window.__aiConsoleCaptured) return;
  window.__aiConsoleCaptured = true;
  window.__aiConsoleLog = [];
  function pushEntry(level, msg) {
    if (msg.length > 500) msg = msg.substring(0, 500) + '...[truncated]';
    window.__aiConsoleLog.push({ level: level, message: msg, timestamp: new Date().toISOString() });
    if (window.__aiConsoleLog.length > 50) window.__aiConsoleLog.shift();
  }
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
      pushEntry(level, args.join(' '));
      original.apply(console, arguments);
    };
  });
  window.addEventListener('error', function(e) {
    var msg = e.message || 'Script error.';
    if (e.filename) msg += ' [' + e.filename + ':' + e.lineno + ']';
    pushEntry('error', msg);
  });
  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason;
    var msg = 'Unhandled Promise rejection: ';
    try { msg += (reason && reason.message) ? reason.message : String(reason); } catch(ex) { msg += '?'; }
    pushEntry('error', msg);
  });
})();
`;

export const CONSOLE_READER_SCRIPT = `
(function() {
  var logs = (window.__aiConsoleLog || []).slice(-20);
  var overlay = (window.__aiErrors || []).map(function(e) {
    var msg = e.message;
    if (e.source) msg += ' [' + e.source + ':' + (e.line || '?') + ']';
    if (e.count > 1) msg += ' (x' + e.count + ')';
    var entry = { level: e.level, message: msg, timestamp: new Date(e.timestamp).toISOString() };
    if (e.stack) entry.stack = String(e.stack).substring(0, 1200);
    return entry;
  });
  var seen = {};
  var merged = [];
  logs.concat(overlay).forEach(function(m) {
    var key = m.level + '|' + m.message.replace(/ \\[[^\\]]*\\]( \\(x\\d+\\))?\\s*$/, '');
    if (!seen[key]) { seen[key] = true; merged.push(m); }
  });
  return merged.slice(-20);
})()
`;

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

export const MAX_DIFF_VALUE_LENGTH = 120;
export const MAX_DIFF_ENTRIES = 40;
export const MAX_SENSITIVE_SAMPLE_LENGTH = 60;
export const MAX_AUTH_AUDIT_ENTRIES = 120;
export const MAX_ATTACK_SURFACE_ENTRIES = 80;
export const MAX_WATERFALL_ENTRIES = 80;

export const JWT_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
];

export const SENSITIVE_PATTERNS: Record<
  SensitiveTypeLink,
  { regex: RegExp; label: string }
> = {
  aws_key: { regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, label: 'AWS 密钥' },
  private_key: {
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    label: '私钥',
  },
  generic_secret: {
    regex: /(?:"|['"\w_-]*)(?:password|passwd|pwd|secret|token|api_key|apikey|access_token|auth_token|client_secret)"?\s*[:=]\s*"([^"]{6,})"/gi,
    label: '凭据字段',
  },
  jwt: {
    regex: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
    label: 'JWT',
  },
  internal_ip: {
    regex: /\b(?:10\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}|192\.168\.(?:[0-9]{1,3}\.)[0-9]{1,3}|172\.(?:1[6-9]|2[0-9]|3[01])\.(?:[0-9]{1,3}\.)[0-9]{1,3})\b/g,
    label: '内网 IP',
  },
  phone: { regex: /(?<!\d)1[3-9]\d{9}(?!\d)/g, label: '手机号' },
  idcard: { regex: /(?<!\d)\d{17}[\dXx](?!\d)/g, label: '身份证' },
  email: { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: '邮箱' },
};

type SensitiveTypeLink = import('./types.js').SensitiveType;
