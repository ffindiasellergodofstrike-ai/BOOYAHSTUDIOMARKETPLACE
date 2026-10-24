import { User } from '../types';

const USER_STORAGE_KEY = 'booyah-studio_auth_user_v1';
const LEGACY_STORAGE_KEY = 'booyah_studio_legacy_user_v1';

export interface RegisterPayload {
  mobile: string;
  email: string;
  password: string;
  confirmPassword: string;
  name?: string;
}

export interface ResetPasswordPayload { email: string; }

type AuthListener = (user: User | null) => void;

class AuthServiceImpl {
  private currentUser: User | null = null;
  private listeners: Set<AuthListener> = new Set();
  private isInitialized = false;

  constructor() {
    // A cached profile is presentation data, never proof of an authenticated session.
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    this.verifySession();
  }

  public subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    listener(this.currentUser);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l(this.currentUser));
  }

  public getCurrentUser(): User | null {
    return this.currentUser;
  }

  public isAuthenticated(): boolean {
    return this.currentUser !== null;
  }

  /**
   * Verify session cookie with backend API
   */
  public async verifySession(): Promise<User | null> {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          this.currentUser = data.user;
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
          this.isInitialized = true;
          this.notify();
          return this.currentUser;
        }
      }

      // If session invalid, clear local user
      this.signOutLocal();
      return null;
    } catch (err) {
      this.isInitialized = true;
      this.signOutLocal();
      return null;
    }
  }

  /**
   * Register a new user via backend API
   */
  public async register(
    payload: RegisterPayload
  ): Promise<{ success: boolean; user?: User; message?: string }> {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        return {
          success: false,
          message: data.message || 'Registration failed. Please check your information.',
        };
      }

      // Signup requires email confirmation and does not create an application session.
      return { success: true, message: data.message };
    } catch (err: any) {
      return { success: false, message: 'Network error during registration. Please try again.' };
    }
  }

  /**
   * Login via backend API with email and password
   */
  public async signIn(
    identifier: string,
    password: string
  ): Promise<{ success: boolean; user?: User; message?: string }> {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        return {
          success: false,
          message: data.message || 'Invalid email or password.',
        };
      }

      this.currentUser = data.user;
      if (this.currentUser) {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(this.currentUser));
      }

      this.notify();
      return {
        success: true,
        user: this.currentUser || undefined,
      };
    } catch (err) {
      return { success: false, message: 'Invalid email or password.' };
    }
  }

  /** Request an email recovery link. */
  public async requestPasswordReset(
    payload: ResetPasswordPayload
  ): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        return {
          success: false,
          message: data.message || 'Could not request password recovery.',
        };
      }

      return {
        success: true,
        message: data.message || 'Check your email for a recovery link.',
      };
    } catch (err) {
      return {
        success: false,
        message: 'Could not request password recovery.',
      };
    }
  }

  /**
   * Update Profile
   */
  public async updateProfile(data: Partial<User>): Promise<{ success: boolean; user?: User }> {
    const current = this.currentUser;
    if (!current) return { success: false };

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (res.ok) {
        const result = await res.json();
        if (result.success && result.user) {
          this.currentUser = { ...current, ...result.user };
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(this.currentUser));
          this.notify();
          return { success: true, user: this.currentUser || undefined };
        }
      }
    } catch (err) {
      console.error('Update profile error:', err);
    }

    return { success: false };
  }

  private signOutLocal(): void {
    this.currentUser = null;
    localStorage.removeItem(USER_STORAGE_KEY);
    this.notify();
  }

  /**
   * Sign out: Destroy session and clear private state
   */
  public async signOut(): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok || !(await response.json()).success) return false;
      this.signOutLocal();
      return true;
    } catch { return false; }
  }
}

export const AuthService = new AuthServiceImpl();
