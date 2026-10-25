// @ts-ignore Generated production bundle; no public database credentials are embedded here.
import app from '../../build/api-app.mjs';
import { createNetlifyHandler, runNetlifyReconciliation, type NetlifyEvent } from '../../server/netlifyAdapter';

process.env.NODE_ENV = 'production';
const application = createNetlifyHandler(app);
export const handler = async (event: NetlifyEvent, context: Record<string, any>) => {
  // Netlify acknowledges a background invocation with 202. That is not evidence of a completed payout/job.
  // Invalid authorization stops here before any database or provider request.
  await runNetlifyReconciliation(application, event, context);
};
