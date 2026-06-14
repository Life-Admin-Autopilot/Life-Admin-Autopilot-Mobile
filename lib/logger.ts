// Single logger entrypoint — never use console.* directly in committed code
// (AGENTS.md → Commits). In dev: routes to console with a severity prefix. In
// production: drops debug/info, keeps warn/error (route to a remote sink later).

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const isDev = process.env.NODE_ENV !== 'production'

function emit(level: LogLevel, message: string, context?: unknown): void {
  if (!isDev && (level === 'debug' || level === 'info')) return
  const prefix = `[${level.toUpperCase()}]`
  if (level === 'error') {
    console.error(prefix, message, context ?? '')
  } else if (level === 'warn') {
    console.warn(prefix, message, context ?? '')
  } else {
    console.log(prefix, message, context ?? '')
  }
}

export const logger = {
  debug: (message: string, context?: unknown) => emit('debug', message, context),
  info: (message: string, context?: unknown) => emit('info', message, context),
  warn: (message: string, context?: unknown) => emit('warn', message, context),
  error: (message: string, context?: unknown) => emit('error', message, context),
}
