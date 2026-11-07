import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Serves the AcrobatDesk web app (for an office/intranet server).
 * The server only hands out the app's files: documents are opened, edited and saved entirely in
 * each user's browser and never sent here. No external services are contacted.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'offline-local-storage' });
  });

  const production = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
  if (production) {
    const dist = path.resolve(__dirname, 'dist');
    app.use(express.static(dist, { maxAge: '7d', index: false }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`AcrobatDesk server running at http://${HOST}:${PORT}`);
  });
}

startServer();
