// Load the Node-compatible bundle produced from server/app.ts by pnpm build.
// Local TypeScript imports and JSON are resolved by esbuild before deployment.
// @ts-ignore -- Generated build artifact is absent before the first build.
export { default } from '../build/api-app.mjs';
