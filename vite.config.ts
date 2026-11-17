import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { handleApi } from './server/http.ts';

export default defineConfig(({ mode }) => {
  // Server-only values. Only VITE_* variables are exposed to browser bundles by Vite.
  const env = loadEnv(mode, process.cwd(), 'BOLRELAY_');
  for (const [key, value] of Object.entries(env)) if (!process.env[key]) process.env[key] = value;
  return {
    plugins: [
      react(),
      {
        name: 'bolrelay-api',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            void handleApi(req, res)
              .then((handled) => {
                if (!handled) next();
              })
              .catch(next);
          });
        },
      },
    ],
    server: { port: 5173, strictPort: true },
    build: { sourcemap: false },
  };
});
