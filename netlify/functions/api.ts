// Built first by pnpm build, then traced into the Netlify function bundle.
// @ts-ignore Generated production bundle.
import app from '../../build/api-app.mjs';
import { createNetlifyHandler } from '../../server/netlifyAdapter';

process.env.NODE_ENV = 'production';
export const handler = createNetlifyHandler(app);
