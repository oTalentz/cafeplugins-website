import { createApp, bootstrap } from './server.js';
import { createLogger } from 'api-core/lib/logger.js';

const log = createLogger('handler');

let bootPromise = null;
let appInstance = null;
let lastError = null;
let lastErrorAt = 0;
const RETRY_AFTER_MS = 60_000; // 1 min — se a última falha foi há mais que isso, tenta de novo

const isProd = !!process.env.VERCEL || process.env.NODE_ENV === 'production';

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    if (lastError && (Date.now() - lastErrorAt) < RETRY_AFTER_MS) {
      log.error('servindo erro de bootstrap anterior', { error: lastError, code: lastError?.code });
      return res.status(503).json({
        error: 'Serviço temporariamente indisponível. Tente novamente em instantes.',
        ...(isProd ? {} : { detail: lastError })
      });
    }
    if (lastError) {
      // Já passou tempo suficiente — reseta e tenta de novo
      log.info('resetando bootstrap após erro antigo', { oldError: lastError });
      lastError = null;
      bootPromise = null;
      appInstance = null;
    }
    if (!bootPromise) {
      log.info('primeira request — iniciando bootstrap', {
        hasTursoUrl: !!process.env.TURSO_URL,
        hasTursoToken: !!process.env.TURSO_TOKEN,
        hasJwtSecret: !!process.env.JWT_SECRET
      });
      bootPromise = bootstrap().catch(err => {
        log.error('bootstrap falhou', {
          error: err.message,
          code: err.code,
          stack: isProd ? undefined : err.stack
        });
        lastError = {
          message: String(err.message || err),
          code: err.code
        };
        lastErrorAt = Date.now();
        throw err;
      });
    }
    if (!appInstance) {
      try {
        await bootPromise;
        appInstance = await createApp();
        log.info('app pronto');
      } catch (e) {
        log.error('falha ao criar app', {
          error: e.message,
          code: e.code,
          stack: isProd ? undefined : e.stack
        });
        return res.status(503).json({
          error: 'Serviço temporariamente indisponível',
          ...(isProd ? {} : { detail: String(e.message || e), code: e.code })
        });
      }
    }
    return appInstance(req, res);
  } catch (e) {
    log.error('erro inesperado no handler', {
      error: e.message,
      code: e.code,
      stack: isProd ? undefined : e.stack
    });
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Erro interno',
        ...(isProd ? {} : { detail: String(e.message || e), code: e.code })
      });
    }
  } finally {
    const ms = Date.now() - t0;
    if (ms > 1500) log.warn('request lenta', { url: req.url, ms });
  }
}
