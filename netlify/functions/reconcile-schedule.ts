import { appOrigin } from '../../server/config';

process.env.NODE_ENV = 'production';
/** The scheduled invocation only queues a background job; its own limit is 30 seconds. */
export const handler = async () => {
  if (!process.env.CRON_SECRET) throw new Error('Configure CRON_SECRET before enabling reconciliation.');
  const response = await fetch(`${appOrigin()}/.netlify/functions/reconcile-background`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (response.status !== 202) throw new Error('The background reconciliation request was not accepted.');
  return { statusCode: 202 };
};
