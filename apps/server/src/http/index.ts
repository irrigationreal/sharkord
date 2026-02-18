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
import { discordCallbackRouteHandler } from './auth/discord-callback';
import { discordStartRouteHandler } from './auth/discord-start';
import { authLogoutRouteHandler } from './auth/logout';
import { healthRouteHandler } from './healthz';
import {
  getRequestPathname,
  hasPrefixPathSegment,
  type HttpRouteHandler
} from './helpers';
import { infoRouteHandler } from './info';
import { interfaceRouteHandler } from './interface';
import { loginRouteHandler } from './login';
import { pluginBundleRouteHandler } from './plugin-bundle';
import { pluginsComponentsRouteHandler } from './plugins-components';
import { publicRouteHandler } from './public';
import { sessionRefreshRouteHandler } from './session-refresh';
import { uploadFileRouteHandler } from './upload';
import { HttpValidationError } from './utils';

type RouteContext = {
  info: ReturnType<typeof getWsInfo>;
};

type SupportedMethod = 'GET' | 'POST';

const loginRateLimiter = createRateLimiter({
  maxRequests: config.rateLimiters.joinServer.maxRequests,
  windowMs: config.rateLimiters.joinServer.windowMs
});

const handleLoginRequest = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  info: ReturnType<typeof getWsInfo>
) => {
  if (info?.ip) {
    const key = getClientRateLimitKey(info.ip);
    const rateLimit = loginRateLimiter.consume(key);

    if (!rateLimit.allowed) {
      logger.debug(
        `${chalk.dim('[Rate Limiter HTTP]')} /login rate limited for key "${key}"`
      );

      res.setHeader('Retry-After', getRateLimitRetrySeconds(rateLimit.retryAfterMs));
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

const routeHandlers: Partial<
  Record<
    SupportedMethod,
    {
      exact: Record<string, HttpRouteHandler<RouteContext>>;
      prefix: Record<string, HttpRouteHandler<RouteContext>>;
    }
  >
> = {
  GET: {
    exact: {
      '/healthz': (req, res) => healthRouteHandler(req, res),
      '/info': (req, res) => infoRouteHandler(req, res)
    },
    prefix: {
      '/public': (req, res) => publicRouteHandler(req, res),
      '/plugin-components': (req, res) => pluginsComponentsRouteHandler(req, res),
      '/plugin-bundle': (req, res) => pluginBundleRouteHandler(req, res),
      '/auth/discord/start': (req, res) => discordStartRouteHandler(req, res),
      '/auth/discord/callback': (req, res) => discordCallbackRouteHandler(req, res)
    }
  },
  POST: {
    exact: {
      '/upload': (req, res) => uploadFileRouteHandler(req, res),
      '/login': (req, res, ctx) => handleLoginRequest(req, res, ctx.info),
      '/auth/session/refresh': (req, res) => sessionRefreshRouteHandler(req, res),
      '/auth/logout': (req, res) => authLogoutRouteHandler(req, res)
    },
    prefix: {}
  }
};

const parseAllowedOrigins = (rawValue: string): string[] => {
  const normalized = rawValue.trim();

  if (!normalized) return [];

  try {
    const parsed = JSON.parse(normalized);

    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item).trim())
        .filter(Boolean)
        .map((item) => item.toLowerCase().replace(/\/+$/, ''));
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
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
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

        logger.debug(`${chalk.dim('[HTTP]')} ${req.method} ${req.url} - ${info?.ip}`);

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const pathname = getRequestPathname(req);

        if (!pathname) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bad request' }));
          return;
        }

        try {
          const method = req.method as SupportedMethod | undefined;

          if (method) {
            const methodHandlers = routeHandlers[method];

            if (methodHandlers) {
              const exactHandler = methodHandlers.exact[pathname];

              if (exactHandler) {
                return await exactHandler(req, res, { info });
              }

              for (const [prefix, prefixHandler] of Object.entries(
                methodHandlers.prefix
              )) {
                if (hasPrefixPathSegment(pathname, prefix)) {
                  return await prefixHandler(req, res, { info });
                }
              }
            }
          }

          if (method === 'GET') {
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
          }

          if (error instanceof HttpValidationError) {
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
