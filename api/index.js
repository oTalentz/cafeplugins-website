import { createApp, bootstrap } from './server.js';
import { createLogger } from './lib/logger.js';

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
      log.error('servindo erro de bootstrap anterior', { error: lastError });
      return res.status(503).json({
        error: 'Serviço temporariamente indisponível. Tente novamente em instantes.'
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
      log.info('primeira request — iniciando bootstrap');
      bootPromise = bootstrap().catch(err => {
        log.error('bootstrap falhou', { error: err.message });
        lastError = String(err.message || err);
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
        log.error('falha ao criar app', { error: e.message });
        return res.status(503).json({
          error: 'Serviço temporariamente indisponível',
          ...(isProd ? {} : { detail: String(e.message || e) })
        });
      }
    }
    return appInstance(req, res);
  } catch (e) {
    log.error('erro inesperado no handler', { error: e.message });
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Erro interno',
        ...(isProd ? {} : { detail: String(e.message || e) })
      });
    }
  } finally {
    const ms = Date.now() - t0;
    if (ms > 1500) log.warn('request lenta', { url: req.url, ms });
  }
}
