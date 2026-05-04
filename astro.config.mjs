// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://decoshop-inventaire.local',
  output: 'server',
  adapter: vercel({
    // Web analytics off by default ; turn on if you set up Vercel Analytics
    webAnalytics: { enabled: false },
    // Cap upload size for the photo data URL coming through /api/articles
    maxDuration: 60,
  }),
  vite: {
    plugins: [
      // @ts-ignore
      tailwindcss()
    ],
  },
});
