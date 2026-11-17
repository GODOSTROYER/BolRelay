import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { handleApi } from './http.ts';

// Explicit local configuration; process-injected values take precedence.
for (const path of ['.env.local', '.env']) if (existsSync(path)) process.loadEnvFile(path);

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  void handleApi(req, res)
    .then((handled) => {
      if (!handled) next();
    })
    .catch(() => {
      res.status(500).json({ error: 'The request could not be completed.' });
    });
});
const dist = resolve('dist');
if (!existsSync(resolve(dist, 'index.html')))
  throw new Error('Run npm run build before npm start.');
app.use(express.static(dist, { index: 'index.html', dotfiles: 'deny' }));
app.use((req, res) => {
  if (req.method === 'GET' && req.accepts('html')) res.sendFile(resolve(dist, 'index.html'));
  else res.status(404).end();
});
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be a valid port number.');
app.listen(port, host, () => console.log(`BolRelay is listening on http://${host}:${port}`));
