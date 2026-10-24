import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      fs: {
        strict: true,
        deny: [
          '.data/**',
          'demofiles/**',
          'templates/**',
          'owner-files/**',
          'supabase/**',
          'docs/**',
          'server/**',
          'scripts/**',
          '.env*',
          '**/*.zip',
          'build/**',
          'package.json',
          'tsconfig.json',
          'components.json',
          'metadata.json',
          'database.rules.json',
          'vercel.json',
          'server.ts',
        ],
      },
    },
    build: {
      sourcemap: false,
    },
  };
});
