import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const sharedAlias = {
    '@': path.resolve(__dirname, 'src'),
    '@shared': path.resolve(__dirname, 'src/shared'),
  } as const;

  return {
    plugins: [
      react(),
      electron({
        main: {
          entry: path.resolve(__dirname, 'electron/main.ts'),
          vite: {
            resolve: {
              alias: sharedAlias,
            },
            build: {
              outDir: 'dist-electron/main',
              rollupOptions: {
                output: {
                  entryFileNames: 'index.js',
                  format: 'cjs',
                },
              },
            },
          },
        },
        preload: {
          input: {
            preload: path.resolve(__dirname, 'electron/preload.ts'),
          },
          vite: {
            resolve: {
              alias: sharedAlias,
            },
            build: {
              outDir: 'dist-electron/preload',
              rollupOptions: {
                output: {
                  entryFileNames: 'index.js',
                  format: 'cjs',
                },
              },
            },
          },
        },
      }),
    ],
    define: {
      'import.meta.env.MODE': JSON.stringify(mode),
      'import.meta.env.PROD': mode === 'production',
      'import.meta.env.DEV': mode !== 'production',
    },
    resolve: {
      alias: sharedAlias,
    },
    build: {
      sourcemap: true,
    },
    server: {
      port: Number(env.VITE_DEV_SERVER_PORT ?? 5173),
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: path.resolve(__dirname, 'tests/vitest.setup.ts'),
    },
  };
});
