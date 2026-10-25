import crypto from 'node:crypto';
import { supabaseAuth, supabaseFetch, supabaseCredentials } from './supabase';
import { Store } from './store';

export class RecoveryError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const invalid = () => new RecoveryError(400, 'RECOVERY_INVALID', 'Recovery link is invalid, expired or already used. Request a new email.');
const unavailable = () => new RecoveryError(503, 'RECOVERY_UNAVAILABLE', 'Recovery is temporarily unavailable. Please retry.');
function providerError(error: any): RecoveryError {
  return error?.name === 'AuthRetryableFetchError' || error?.name === 'TimeoutError' || Number(error?.status) >= 500 ? unavailable() : invalid();
}

/** Verify the original email-authenticated bearer; never refresh an expired recovery link. */
export async function verifyRecoveryBearer(accessToken: string) {
  const client = supabaseAuth();
  let verified;
  try { verified = await client.auth.getClaims(accessToken); }
  catch (error) { throw providerError(error); }
  if (verified.error || !verified.data?.claims) throw providerError(verified.error);
  const claims = verified.data.claims;
  const now = Date.now() / 1000;
  const expectedIssuer = `${supabaseCredentials().url.replace(/\/+$/, '')}/auth/v1`;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  // GoTrue's default implicit recovery verification uses OTP AMR. Both represent
  // verified email possession; the URL's type=recovery is never authorization.
  const emailProof = Array.isArray(claims.amr) && claims.amr.some((entry: any) =>
    ['otp', 'recovery'].includes(entry?.method) && Number.isFinite(Number(entry.timestamp)) &&
    Number(entry.timestamp) <= now + 60 && now - Number(entry.timestamp) <= 3600);
  if (claims.iss !== expectedIssuer || claims.role !== 'authenticated' || !audience.includes('authenticated') ||
      claims.is_anonymous === true || !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now + 60 || !emailProof ||
      typeof claims.session_id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(claims.session_id)) throw invalid();
  const result = await client.auth.getUser(accessToken);
  if (result.error) throw providerError(result.error);
  const user = result.data.user;
  if (!user || user.id !== claims.sub || user.is_anonymous || !user.email || !user.email_confirmed_at) throw invalid();
  return { user, sessionId: claims.session_id, client };
}

export async function claimRecoverySession(sessionId: string): Promise<void> {
  // Atomic and available in the existing baseline schema; store no raw credential.
  // Recent-AMR and JWT expiry checks prevent rotating a bearer reviving this claim.
  const fingerprint = crypto.createHash('sha256').update(sessionId).digest('hex');
  const allowed = await Store.rpc('rate', `passwordRecoverySessions/${fingerprint}`, { now: Date.now(), windowMs: 86400000, maxAttempts: 1 });
  if (!allowed) throw invalid();
}

/** Use exactly the verified bearer, not a service key or a client-supplied refresh token. */
export async function updatePasswordWithBearer(accessToken: string, password: string): Promise<void> {
  try {
    const config = supabaseCredentials();
    if (!config.url || !config.publishableKey) throw unavailable();
    const response = await supabaseFetch(`${config.url.replace(/\/+$/, '')}/auth/v1/user`, {
      method: 'PUT', redirect: 'error', headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) throw new RecoveryError(400, 'RECOVERY_RESTART', 'Password could not be updated. Request a new recovery email and try again.');
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError(503, 'RECOVERY_RESTART', 'The password update could not be confirmed. Try signing in with your new password, or request a new recovery email.');
  }
}
