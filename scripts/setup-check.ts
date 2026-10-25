import 'dotenv/config';
import { offlineSetupChecks, onlineSetupChecks, setupChecksPass } from '../server/setupChecks';

async function main() {
  const online = process.argv.includes('--online');
  const checks = [...offlineSetupChecks(), ...(online ? await onlineSetupChecks() : [])];
  const ready = setupChecksPass(checks);
  console.log(JSON.stringify({ ready, mode: online ? 'read_only_online' : 'offline_presence', checks,
    notes: ['No secret values are printed.', 'This command does not apply SQL, upload files, create accounts, send emails or contact payment gateways.', 'Provider approval, verified SMTP, scheduled execution and a sandbox purchase remain manual activation checks.'] }, null, 2));
  process.exitCode = ready ? 0 : 1;
}
void main().catch(() => {
  console.error(JSON.stringify({ ready: false, message: 'Setup checks could not finish. Confirm the configured environment and retry; private errors are not printed.' }));
  process.exitCode = 1;
});
