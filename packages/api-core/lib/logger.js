const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

const COLORS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
  reset: '\x1b[0m'
};

const inVercel = !!process.env.VERCEL;

function fmt(level, scope, msg, meta) {
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  const color = COLORS[level] || '';
  const reset = COLORS.reset;
  return inVercel
    ? `[${ts}] ${level.toUpperCase()} [${scope}] ${msg}${metaStr}`
    : `${color}[${ts}] ${level.toUpperCase()} [${scope}] ${msg}${metaStr}${reset}`;
}

function log(level, scope, msg, meta) {
  if (LEVELS[level] > currentLevel) return;
  const line = fmt(level, scope, msg, meta);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function createLogger(scope) {
  return {
    error: (msg, meta) => log('error', scope, msg, meta),
    warn: (msg, meta) => log('warn', scope, msg, meta),
    info: (msg, meta) => log('info', scope, msg, meta),
    debug: (msg, meta) => log('debug', scope, msg, meta),
    child: (sub) => createLogger(`${scope}:${sub}`)
  };
}

export const rootLogger = createLogger('app');

export function checkEnv(required) {
  const missing = required.filter(k => !process.env[k] || process.env[k].trim() === '');
  if (missing.length) {
    rootLogger.error('ENV vars faltando', { missing });
  } else {
    rootLogger.info('ENV OK', { checked: required.length });
  }
  return { ok: missing.length === 0, missing };
}
