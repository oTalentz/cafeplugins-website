// =====================================================
//  Cafe Plugins - Monitoramento e Logging
//  Coleta métricas de performance, erros e eventos críticos
// =====================================================

import { nowISO } from './util.js';
import { createLogger } from './logger.js';

const log = createLogger('monitoring');

// Armazena métricas em memória (em produção, enviar para serviço externo)
const metrics = {
  requests: [],
  errors: [],
  performance: [],
  startTime: Date.now()
};

// Limita armazenamento para evitar vazamento de memória
const MAX_ENTRIES = 1000;

/**
 * Registra uma requisição com métricas de performance
 */
export function logRequest(req, res, duration) {
  const entry = {
    timestamp: nowISO(),
    method: req.method,
    path: req.path || req.url,
    status: res.statusCode,
    durationMs: Math.round(duration),
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 200)
  };
  
  metrics.requests.push(entry);
  if (metrics.requests.length > MAX_ENTRIES) {
    metrics.requests.shift();
  }
  
  // Loga apenas erros e requisições lentas (>1s)
  if (res.statusCode >= 400 || duration > 1000) {
    log.warn(`HTTP ${req.method} ${req.path} ${res.statusCode} ${Math.round(duration)}ms`);
  }
}

/**
 * Registra um erro com stack trace e contexto
 */
export function logError(error, context = {}) {
  const entry = {
    timestamp: nowISO(),
    name: error.name || 'Error',
    message: error.message,
    stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    context
  };
  
  metrics.errors.push(entry);
  if (metrics.errors.length > MAX_ENTRIES) {
    metrics.errors.shift();
  }
  
  // Sempre loga erros no console
  log.error(`${error.name}: ${error.message}`, context);
}

/**
 * Registra métrica de performance customizada
 */
export function logPerformance(label, duration, meta = {}) {
  const entry = {
    timestamp: nowISO(),
    label,
    durationMs: Math.round(duration),
    meta
  };
  
  metrics.performance.push(entry);
  if (metrics.performance.length > MAX_ENTRIES) {
    metrics.performance.shift();
  }
  
  // Loga operações lentas
  if (duration > 500) {
    log.warn(`${label}: ${Math.round(duration)}ms`, meta);
  }
}

/**
 * Middleware para medir tempo de resposta das rotas
 */
export function performanceMiddleware(req, res, next) {
  const start = Date.now();
  
  // Adiciona ID único para tracing
  req.requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('X-Request-ID', req.requestId);
  
  // Captura o evento de fim da resposta
  res.on('finish', () => {
    const duration = Date.now() - start;
    logRequest(req, res, duration);
  });
  
  next();
}

/**
 * Retorna métricas agregadas para dashboard/admin
 */
export function getMetrics() {
  const uptime = Date.now() - metrics.startTime;
  const now = Date.now();
  
  // Métricas dos últimos 5 minutos
  const recentRequests = metrics.requests.filter(r => now - new Date(r.timestamp).getTime() < 300000);
  const recentErrors = metrics.errors.filter(e => now - new Date(e.timestamp).getTime() < 300000);
  
  const avgResponseTime = recentRequests.length > 0
    ? Math.round(recentRequests.reduce((sum, r) => sum + r.durationMs, 0) / recentRequests.length)
    : 0;
  
  const errorRate = recentRequests.length > 0
    ? ((recentErrors.length / recentRequests.length) * 100).toFixed(2)
    : '0.00';
  
  return {
    uptime,
    totalRequests: metrics.requests.length,
    recentRequests: recentRequests.length,
    totalErrors: metrics.errors.length,
    recentErrors: recentErrors.length,
    avgResponseTimeMs: avgResponseTime,
    errorRatePercent: parseFloat(errorRate),
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version,
    platform: process.platform
  };
}

/**
 * Retorna últimos erros para debug
 */
export function getRecentErrors(limit = 20) {
  return metrics.errors.slice(-limit);
}

/**
 * Health check básico
 */
export function healthCheck() {
  return {
    status: 'healthy',
    timestamp: nowISO(),
    uptime: Date.now() - metrics.startTime,
    memory: process.memoryUsage().heapUsed / 1024 / 1024
  };
}

// Limpeza periódica de métricas antigas (a cada 10 minutos)
setInterval(() => {
  const now = Date.now();
  const fiveMinutesAgo = now - 300000;
  
  metrics.requests = metrics.requests.filter(r => new Date(r.timestamp).getTime() > fiveMinutesAgo);
  metrics.errors = metrics.errors.filter(e => new Date(e.timestamp).getTime() > fiveMinutesAgo);
  metrics.performance = metrics.performance.filter(p => new Date(p.timestamp).getTime() > fiveMinutesAgo);
}, 600000);
