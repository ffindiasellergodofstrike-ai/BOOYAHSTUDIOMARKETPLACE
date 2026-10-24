import { appOrigin } from './config';
import crypto from 'node:crypto';
import { z } from 'zod';
import { Store } from './store';
import { supabaseAuth } from './supabase';
import { RecoveryError, verifyRecoveryBearer, claimRecoverySession, updatePasswordWithBearer } from './supabaseRecovery';
import type { Express, RequestHandler } from 'express';
const hash = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const normalizedEmail = z.string().trim().email().max(254).transform(value => value.toLowerCase());
const emailFailure = (error: any) => error?.status === 429 ? 429 : 503;
const cookie = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
export class AuthServiceServer {
  static async createOpaqueSession(userId: string, email: string, username: string, ip?: string, userAgent?: string, authenticatedAt = Date.now()) {
    const token = crypto.randomBytes(32).toString('hex');
    await Store.set(`sessions/${hash(token)}`, { userId, email, username, createdAt: authenticatedAt, expiresAt: Date.now() + 7 * 86400000, ip, userAgent });
    return token;
  }
  static async verifyOpaqueSession(token: string) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await Store.get<any>(`sessions/${hash(token)}`);
    if (!session || Date.now() >= session.expiresAt) return null;
    const profile = await Store.getUserProfile(session.userId);
    if (!profile || (profile.status === 'suspended' || profile.blocked === true) || session.createdAt <= (profile.sessionValidAfter || 0)) return null;
    return session;
  }
  static async destroyOpaqueSession(token: string) { if (typeof token === 'string') await Store.delete(`sessions/${hash(token)}`); }
  static async hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derivedKey}`;
  }
  static async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, key] = storedHash.split(':');
    const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derivedKey, 'hex'));
  }
  static async resetPasswordWithEmailAndMobile(_params: { email?: string; mobile?: string; newPassword?: string; confirmNewPassword?: string }): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Password reset via email and mobile is not supported.' };
  }
}
export function registerAuthRoutes(app: Express, limiter: RequestHandler) {
  app.post('/api/auth/register', limiter, async (req, res) => {
    const parsed = z.object({ email: normalizedEmail, password: z.string().min(8).max(128), confirmPassword: z.string(), name: z.string().trim().min(2).max(100), mobile: z.string().regex(/^[6-9][0-9]{9}$/) }).safeParse(req.body);
    if (!parsed.success || parsed.data.password !== parsed.data.confirmPassword) return res.status(400).json({ success: false, message: 'Provide valid details and matching passwords of at least 8 characters.' });
    const { email, password, name, mobile } = parsed.data;
    const { error } = await supabaseAuth().auth.signUp({ email: email.toLowerCase(), password, options: { data: { name, mobile }, emailRedirectTo: `${appOrigin()}/login` } });
    if (error) { if (error.status === 429) res.set('Retry-After', '60'); return res.status(error.status === 429 ? 429 : 400).json({ success: false, message: error.status === 429 ? 'Please wait before requesting another email.' : 'Could not register. Check your details or try password recovery.' }); }
    res.status(201).json({ success: true, message: 'Check your email to confirm your account, then sign in.' });
  });
  app.post('/api/auth/resend-confirmation', limiter, async (req, res) => {
    const input = z.object({ email: normalizedEmail }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    const allowed = await Store.rpc('rate', `authEmailCooldowns/confirm_${hash(input.data.email)}`, { now: Date.now(), windowMs: 60000, maxAttempts: 1 });
    if (!allowed) return res.set('Retry-After', '60').status(429).json({ success: false, message: 'Please wait one minute before requesting another confirmation email.', retryAfter: 60 });
    const { error } = await supabaseAuth().auth.resend({ type: 'signup', email: input.data.email, options: { emailRedirectTo: `${appOrigin()}/login` } });
    // Never reveal whether an address is registered or already confirmed.
    if (error && !['user_not_found', 'email_already_confirmed'].includes(error.code || '')) {
      if (error.status === 429) res.set('Retry-After', '60');
      return res.status(emailFailure(error)).json({ success: false, message: 'Confirmation email could not be requested. Please retry later.', retryAfter: error.status === 429 ? 60 : undefined });
    }
    res.json({ success: true, message: 'If your account needs confirmation, check your email for a new link.', retryAfter: 60 });
  });
  app.post('/api/auth/login', limiter, async (req, res) => {
    const input = z.object({ identifier: normalizedEmail, password: z.string().min(1).max(128) }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ success: false, message: 'Enter your email and password.' });
    const authenticatedAt = Date.now();
    const { data, error } = await supabaseAuth().auth.signInWithPassword({ email: input.data.identifier, password: input.data.password });
    if (error || !data.user?.email_confirmed_at) return res.status(401).json({ success: false, message: 'Invalid credentials or email not confirmed.' });
    const user = data.user;
    let profile = await Store.getUserProfile(user.id);
    if (!profile?.id) {
      profile = { ...profile, id: user.id, email: user.email, name: user.user_metadata.name || 'Customer', mobile: user.user_metadata.mobile || '', username: user.email, role: 'customer', joinedDate: user.created_at, country: 'India' };
      await Store.setUserProfile(user.id, profile);
    }
    if ((profile.status === 'suspended' || profile.blocked === true)) return res.status(403).json({ success: false, message: 'Please contact support about account access.' });
    const token = await AuthServiceServer.createOpaqueSession(user.id, user.email!, profile.username, req.ip, req.get('user-agent'), authenticatedAt);
    res.cookie('sid', token, { ...cookie, maxAge: 7 * 86400000 });
    res.json({ success: true, user: profile });
  });
  app.post('/api/auth/forgot-password', limiter, async (req, res) => {
    const input = z.object({ email: normalizedEmail }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    const { error } = await supabaseAuth().auth.resetPasswordForEmail(input.data.email, { redirectTo: `${appOrigin()}/forgot-password` });
    if (error) { if (error.status === 429) res.set('Retry-After', '60'); return res.status(emailFailure(error)).json({ success: false, message: 'Recovery email could not be requested. Please retry later.', retryAfter: error.status === 429 ? 60 : undefined }); }
    res.json({ success: true, message: 'If the account exists, check its email for a recovery link.' });
  });
  // Support custom token-hash links and Supabase's default implicit recovery link.
  // Both are verified only when a password is explicitly submitted.
  app.post('/api/auth/reset-password', limiter, async (req, res) => {
    const fields = { password: z.string().min(8).max(128), confirmPassword: z.string().optional() };
    const input = z.union([
      z.object({ tokenHash: z.string().min(10).max(256), ...fields }).strict(),
      z.object({ accessToken: z.string().min(20).max(8192), ...fields }).strict(),
    ]).refine(value => value.confirmPassword === undefined || value.password === value.confirmPassword).safeParse(req.body);
    if (!input.success) return res.status(400).json({ success: false, message: 'A recovery link and password of at least 8 characters are required.' });
    if ('accessToken' in input.data) {
      try {
        const { user, sessionId, client } = await verifyRecoveryBearer(input.data.accessToken);
        await claimRecoverySession(sessionId);
        await Store.updateUserProfile(user.id, { sessionValidAfter: Date.now() });
        await updatePasswordWithBearer(input.data.accessToken, input.data.password);
        try { await Store.updateUserProfile(user.id, { sessionValidAfter: Date.now() }); }
        catch { return res.status(503).json({ success: false, code: 'RECOVERY_RESTART', message: 'Your password was updated, but session cleanup could not be confirmed. Request a new recovery email or contact support.' }); }
        // Password mutation already succeeded. Provider logout failure must not
        // falsely report that the password is unchanged; local sessions are revoked.
        try { await client.auth.admin.signOut(input.data.accessToken, 'global'); } catch { /* best effort provider cleanup */ }
        res.clearCookie('sid', cookie);
        return res.json({ success: true, message: 'Password updated. Please sign in again.' });
      } catch (error) {
        if (error instanceof RecoveryError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
        throw error;
      }
    }
    const client = supabaseAuth();
    const { data, error } = await client.auth.verifyOtp({ token_hash: input.data.tokenHash, type: 'recovery' });
    if (error || !data.user || !data.session) return res.status(400).json({ success: false, code: 'RECOVERY_INVALID', message: 'Recovery link is invalid, expired or already used. Request a new email.' });
    // Invalidate store sessions before changing the password, failing closed on database errors.
    await Store.updateUserProfile(data.user.id, { sessionValidAfter: Date.now() });
    const result = await client.auth.updateUser({ password: input.data.password });
    if (result.error) return res.status(400).json({ success: false, code: 'RECOVERY_RESTART', message: 'Password update failed. Request a new recovery link.' });
    await Store.updateUserProfile(data.user.id, { sessionValidAfter: Date.now() });
    try { await client.auth.signOut({ scope: 'global' }); } catch { /* password already changed and store sessions revoked */ }
    res.clearCookie('sid', cookie);
    res.json({ success: true, message: 'Password updated. Please sign in again.' });
  });
}
