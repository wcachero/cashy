import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  username?: string | null;
}

const TOKEN_KEY = 'cutoff_auth_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  readonly user = signal<AuthUser | null>(null);
  readonly ready = signal(false);

  headers(): Record<string, string> {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async restore(): Promise<AuthUser | null> {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      this.ready.set(true);
      return null;
    }
    try {
      const response = await firstValueFrom(this.http.get<{ user: AuthUser }>('/api/auth/me', { headers: this.headers() }));
      this.user.set(response.user);
      return response.user;
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      this.user.set(null);
      return null;
    } finally {
      this.ready.set(true);
    }
  }

  async register(input: {
    name: string;
    username: string;
    email: string;
    password: string;
    website: string;
    challengeToken: string;
    challengeAnswer: string;
  }): Promise<void> {
    const response = await firstValueFrom(this.http.post<{ token: string; user: AuthUser }>('/api/auth/register', input));
    this.keep(response);
  }

  async login(login: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<{ token: string; user: AuthUser }>('/api/auth/login', { login, password }),
    );
    this.keep(response);
  }

  challenge(): Promise<{ token: string; image: string }> {
    return firstValueFrom(this.http.get<{ token: string; image: string }>('/api/auth/challenge'));
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}, { headers: this.headers() }));
    } catch {
      // The local session is cleared even if the API is unreachable.
    }
    localStorage.removeItem(TOKEN_KEY);
    this.user.set(null);
  }

  private keep(response: { token: string; user: AuthUser }): void {
    localStorage.setItem(TOKEN_KEY, response.token);
    this.user.set(response.user);
    this.ready.set(true);
  }
}
