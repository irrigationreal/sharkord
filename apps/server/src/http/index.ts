import chalk from 'chalk';
import http from 'http';
import z from 'zod';
import { config } from '../config';
import { getWsInfo } from '../helpers/get-ws-info';
import { logger } from '../logger';
import {
  createRateLimiter,
  getClientRateLimitKey,
  getRateLimitRetrySeconds
} from '../utils/rate-limiters/rate-limiter';
import { healthRouteHandler } from './healthz';
import { infoRouteHandler } from './info';
import { interfaceRouteHandler } from './interface';
import { loginRouteHandler } from './login';
import { sessionRefreshRouteHandler } from './session-refresh';
import { publicRouteHandler } from './public';
import { uploadFileRouteHandler } from './upload';
import { authLogoutRouteHandler } from './auth/logout';
import { discordCallbackRouteHandler } from './auth/discord-callback';
import { discordStartRouteHandler } from './auth/discord-start';
import { HttpValidationError } from './utils';

// 5 attempts per minute per IP for login route
const loginRateLimiter = createRateLimiter({
  maxRequests: config.rateLimiters.joinServer.maxRequests,
  windowMs: config.rateLimiters.joinServer.windowMs
});

const parseAllowedOrigins = (rawValue: string): string[] => {
  const normalized = rawValue.trim();

  if (!normalized) return [];

  try {
    const parsed = JSON.parse(normalized);

    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item).trim())
        .filter(Boolean)
        .map((item) =>
          item.toLowerCase().replace(/\/+$/, '')
        );
    }
  } catch {
    // fall through to csv parsing
  }

  return normalized
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase().replace(/\/+$/, ''));
};

const parseOrigin = (
  rawOrigin: string
): { origin: string; host: string } | undefined => {
  try {
    const parsed = new URL(rawOrigin);

    return {
      origin: parsed.origin.toLowerCase(),
      host: parsed.host.toLowerCase()
    };
  } catch {
    return undefined;
  }
};

const getAllowedOrigin = (
  origin: string | string[] | undefined,
  requestHost: string | undefined
): string => {
  if (typeof origin !== 'string') return '';
  if (!origin) return '';

  if (config.server.debug) {
    return origin;
  }

  const originInfo = parseOrigin(origin);

  if (!originInfo) {
    return '';
  }

  const normalizedAllowedOrigins = parseAllowedOrigins(config.server.allowedOrigins);
  const isAllowedOrigin = normalizedAllowedOrigins.includes(originInfo.origin);
  const isSameHost = requestHost
    ? originInfo.host === requestHost.toLowerCase()
    : false;

  return isAllowedOrigin || isSameHost ? origin : '';
};

const sendSecurityHeaders = (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  const origin = req.headers.origin;
  const allowedOrigin = getAllowedOrigin(origin, req.headers.host);
  const hasOrigin = typeof origin === 'string' && origin.length > 0;

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'null');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, origin, sec-fetch-mode, x-file-name, x-file-type, content-length, x-token'
  );
  res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return hasOrigin ? Boolean(allowedOrigin) : true;
};

// this http server implementation is temporary and will be moved to bun server later when things are more stable
const createHttpServer = async (port: number = config.server.port) => {
  return new Promise<http.Server>((resolve) => {
    const server = http.createServer(
      async (req: http.IncomingMessage, res: http.ServerResponse) => {
        const isOriginAllowed = sendSecurityHeaders(req, res);

        if (!isOriginAllowed) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Origin not allowed' }));
          return;
        }

        const info = getWsInfo(undefined, req);

        logger.debug(
          `${chalk.dim('[HTTP]')} ${req.method} ${req.url} - ${info?.ip}`
        );

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        try {
          if (req.method === 'GET' && req.url === '/healthz') {
            return await healthRouteHandler(req, res);
          }

          if (
            req.method === 'GET' &&
            req.url?.startsWith('/auth/discord/start')
          ) {
            return await discordStartRouteHandler(req, res);
          }

          if (
            req.method === 'GET' &&
            req.url?.startsWith('/auth/discord/callback')
          ) {
            return await discordCallbackRouteHandler(req, res);
          }

          if (req.method === 'GET' && req.url === '/info') {
            return await infoRouteHandler(req, res);
          }

          if (req.method === 'POST' && req.url === '/upload') {
            return await uploadFileRouteHandler(req, res);
          }

          const handleLoginRequest = async () => {
            if (info?.ip) {
              const key = getClientRateLimitKey(info.ip);
              const rateLimit = loginRateLimiter.consume(key);

              if (!rateLimit.allowed) {
                logger.debug(
                  `${chalk.dim('[Rate Limiter HTTP]')} /login rate limited for key "${key}"`
                );

                res.setHeader(
                  'Retry-After',
                  getRateLimitRetrySeconds(rateLimit.retryAfterMs)
                );

                res.writeHead(429, { 'Content-Type': 'application/json' });

                res.end(
                  JSON.stringify({
                    error: 'Too many login attempts. Please try again shortly.'
                  })
                );

                return;
              }
            } else {
              logger.warn(
                `${chalk.dim('[Rate Limiter HTTP]')} Missing IP address in request info, skipping rate limiting for login route.`
              );
            }

            await loginRouteHandler(req, res);
          };

          if (req.method === 'POST' && req.url === '/login') {
            await handleLoginRequest();
            return;
          }

          if (req.method === 'POST' && req.url === '/auth/session/refresh') {
            return await sessionRefreshRouteHandler(req, res);
          }

          if (req.method === 'POST' && req.url === '/auth/logout') {
            return await authLogoutRouteHandler(req, res);
          }

          if (req.method === 'GET' && req.url?.startsWith('/public')) {
            return await publicRouteHandler(req, res);
          }

          if (req.method === 'GET' && req.url?.startsWith('/')) {
            return await interfaceRouteHandler(req, res);
          }
        } catch (error) {
          const errorsMap: Record<string, string> = {};

          if (error instanceof z.ZodError) {
            for (const issue of error.issues) {
              const field = issue.path[0];

              if (typeof field === 'string') {
                errorsMap[field] = issue.message;
              }
            }

            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ errors: errorsMap }));
            return;
          } else if (error instanceof HttpValidationError) {
            errorsMap[error.field] = error.message;

            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ errors: errorsMap }));
            return;
          }

          logger.error('HTTP route error:', error);

          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    );

    server.on('listening', () => {
      logger.debug('HTTP server is listening on port %d', port);
      resolve(server);
    });

    server.on('close', () => {
      logger.debug('HTTP server closed');
      process.exit(0);
    });

    server.listen(port);
  });
};

export { createHttpServer };
