import express from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import deviceRouter from './routes';
import { requestLogger } from './middleware';

export function createApiServer(): http.Server | https.Server {
  const app = express();

  // Parse JSON bodies up to 10 KB
  app.use(express.json({ limit: '10kb' }));

  // Request logging
  app.use(requestLogger);

  // Health check (unauthenticated)
  app.get('/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // Device API routes
  app.use('/api', deviceRouter);

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'not_found' });
  });

  const port = parseInt(process.env.PORT || process.env.API_PORT || '8443', 10);
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    const server = http.createServer(app);
    server.listen(port, () =>
      console.log(`[API] HTTP server listening on port ${port} (dev mode)`),
    );
    return server;
  }

  // Production: HTTPS
  const certPath = process.env.TLS_CERT_PATH;
  const keyPath = process.env.TLS_KEY_PATH;

  if (!certPath || !keyPath) {
    throw new Error(
      'TLS_CERT_PATH and TLS_KEY_PATH must be set in production mode',
    );
  }

  const options: https.ServerOptions = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };

  const server = https.createServer(options, app);
  server.listen(port, () =>
    console.log(`[API] HTTPS server listening on port ${port}`),
  );
  return server;
}
