/**
 * Start a local QQ Music API HTTP service.
 *
 * The published `qq-music-api` package does not include its original server entry
 * (`bin/www` / `app.js`), so we bootstrap a compatible Express wrapper here.
 */

const fs = require('fs');
const path = require('path');

const qqApiRoot = path.resolve(__dirname, '../node_modules/qq-music-api');
const routesPath = path.join(qqApiRoot, 'node/routes.js');

if (!fs.existsSync(routesPath)) {
  console.error('qq-music-api route definitions not found. Please run: npm install');
  process.exit(1);
}

const resolveModule = (moduleName) => {
  try {
    return require(path.join(qqApiRoot, 'node_modules', moduleName));
  } catch {
    return require(moduleName);
  }
};

const express = resolveModule('express');
const cookieParser = resolveModule('cookie-parser');
const createRequest = require(path.join(qqApiRoot, 'util/request'));
const Cache = require(path.join(qqApiRoot, 'util/cache'));
const routeGroups = require(routesPath);

const app = express();
const cache = new Cache();
const PORT = Number(process.env.QQ_API_PORT || 3001);
const HOST = process.env.QQ_API_HOST || 'localhost';

const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const globalCookieStore = (() => {
  let allCookies = {};
  let userCookie = {};
  return {
    allCookies: () => allCookies,
    userCookie: () => userCookie,
    updateAllCookies: (next) => {
      allCookies = next || {};
    },
    updateUserCookie: (next) => {
      userCookie = next || {};
    },
  };
})();

app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'qq-music-api-wrapper' });
});

const unsupportedQrMessage =
  '\u5f53\u524d qq-music-api \u4e0d\u652f\u6301\u626b\u7801\u767b\u5f55\u7aef\u70b9\uff0c\u8bf7\u4f7f\u7528 Cookie \u767b\u5f55\u6216\u63a5\u5165\u652f\u6301\u626b\u7801\u7684 QQ API \u670d\u52a1\u3002';

[
  '/login/qr/key',
  '/qr/key',
  '/user/login/qr/key',
  '/login/qr/create',
  '/qr/create',
  '/login/qr/check',
  '/qr/check',
].forEach((endpoint) => {
  app.all(endpoint, (_req, res) => {
    res.status(501).json({
      code: 501,
      message: unsupportedQrMessage,
    });
  });
});

Object.entries(routeGroups).forEach(([groupName, handlers]) => {
  Object.entries(handlers).forEach(([routePath, handler]) => {
    const fullPath = `/${groupName}${routePath === '/' ? '' : routePath}`;

    app.all(fullPath, async (req, res) => {
      try {
        const request = createRequest(req, res, { globalCookie: globalCookieStore });
        const maybeResult = await handler({
          req,
          res,
          request,
          cache,
          globalCookie: globalCookieStore,
        });

        if (!res.headersSent && typeof maybeResult !== 'undefined') {
          res.send(maybeResult);
        }
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({
            result: 500,
            errMsg: error instanceof Error ? error.message : 'Unknown server error',
          });
        }
      }
    });
  });
});

app.use((_req, res) => {
  res.status(404).json({
    code: 404,
    message: 'QQ API route not found',
  });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`QQ API started at http://${HOST}:${PORT}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
