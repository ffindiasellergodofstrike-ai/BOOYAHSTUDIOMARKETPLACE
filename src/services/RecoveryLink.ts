import { authReturnSearch } from './AuthNavigation';

export type RecoveryCredentials = { tokenHash: string } | { accessToken: string };
export interface RecoveryLink {
  credentials: RecoveryCredentials | null;
  message: string;
  cleanUrl: string;
}

const invalidMessage = 'This recovery link is invalid, expired or incomplete. Request a new email below.';
const bounded = (value: string | null, min: number, max: number): value is string => Boolean(value && value.length >= min && value.length <= max && !/\s/.test(value));

/** Parse only supported recovery links. The server verifies ownership and validity on submit. */
export function readRecoveryLink(search = '', fragment = ''): RecoveryLink {
  const query = new URLSearchParams(search);
  const hash = new URLSearchParams(fragment.replace(/^#/, ''));
  // Keep only the supported internal return hint; never retain authentication material in history.
  const returnQuery = new URLSearchParams(authReturnSearch(query.get('redirect') || undefined)).toString();
  const cleanUrl = `/forgot-password${returnQuery ? '?' + returnQuery : ''}`;
  const result = (credentials: RecoveryCredentials | null, message = ''): RecoveryLink => ({ credentials, message, cleanUrl });
  const hasError = (params: URLSearchParams) => ['error', 'error_code', 'error_description'].some(key => params.has(key));
  if (hasError(query) || hasError(hash)) return result(null, invalidMessage);

  if (query.has('token_hash')) {
    const tokenHash = query.get('token_hash');
    if (query.getAll('token_hash').length !== 1 || !bounded(tokenHash, 10, 256) || (query.has('type') && query.get('type') !== 'recovery')) return result(null, invalidMessage);
    return result({ tokenHash });
  }

  const hasSession = ['access_token', 'refresh_token'].some(key => hash.has(key) || query.has(key));
  if (hasSession || hash.get('type') === 'recovery') {
    const accessToken = hash.get('access_token');
    if (query.has('access_token') || query.has('refresh_token') || hash.get('type') !== 'recovery' ||
        hash.getAll('type').length !== 1 || hash.getAll('access_token').length !== 1 ||
        !bounded(accessToken, 10, 8192) || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)) return result(null, invalidMessage);
    // The original bearer is sufficient; never retain or send a refresh token.
    return result({ accessToken });
  }

  if (query.has('code') || hash.has('code')) return result(null, 'This recovery link uses an unsupported format. Request a new recovery email below.');
  return result(null);
}
