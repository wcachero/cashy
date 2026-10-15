import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { AuthService } from '../../services/auth.service';
import { BudgetStateService } from '../../services/budget-state.service';
import { ThemeToggleComponent } from '../../shared/theme-toggle.component';

@Component({
  selector: 'app-auth',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ThemeToggleComponent],
  template: `
    <main class="grid min-h-screen place-items-center px-4 py-10">
      <section class="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/30">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400 text-xl font-extrabold text-slate-950">₱</span>
            <div>
              <p class="text-lg font-bold leading-none">Cashy</p>
              <p class="mt-1 text-xs text-slate-400">Cash flow & Finance Planner</p>
            </div>
          </div>
          <app-theme-toggle />
        </div>
        <h1 class="mt-6 text-2xl font-extrabold tracking-tight">{{ mode() === 'login' ? 'Sign in' : 'Create an account' }}</h1>
        <p class="mt-2 text-sm text-slate-400">
          This is where you manage your finances.
        </p>

        <form class="relative mt-5 space-y-3" (submit)="submit($event)">
          @if (mode() === 'register') {
            <label class="block text-sm">
              Name
              <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" name="name" autocomplete="name" [value]="name()" (input)="name.set(inputValue($event))" />
            </label>
            <label class="block text-sm">
              Username
              <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" name="username" autocomplete="username" [value]="username()" (input)="username.set(inputValue($event))" />
            </label>
          }
          <label class="block text-sm">
            {{ mode() === 'login' ? 'Email or username' : 'Email' }}
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" [type]="mode() === 'login' ? 'text' : 'email'" [name]="mode() === 'login' ? 'username' : 'email'" [attr.autocomplete]="mode() === 'login' ? 'username' : 'email'" [value]="email()" (input)="email.set(inputValue($event))" />
          </label>
          <label class="block text-sm">
            Password
            <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2" type="password" name="password" autocomplete="current-password" [value]="password()" (input)="password.set(inputValue($event))" />
          </label>
          @if (mode() === 'register') {
            <div class="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
              <label>
                Website
                <input tabindex="-1" autocomplete="off" name="website" [value]="website()" (input)="website.set(inputValue($event))" />
              </label>
            </div>
            <div class="block text-sm">
              Captcha
              <div class="mt-1 flex items-center gap-2">
                @if (captchaImage(); as image) {
                  <img class="h-16 w-44 rounded-xl border border-white/10 bg-white object-cover" [src]="image" alt="Captcha characters" />
                } @else {
                  <span class="grid h-16 w-44 place-items-center rounded-xl border border-white/10 text-xs text-slate-400">Loading image…</span>
                }
                <button type="button" class="rounded-xl border border-white/15 px-3 py-2 text-xs" (click)="loadChallenge()">New image</button>
              </div>
            </div>
            <label class="block text-sm">
              Characters in the image
              <input class="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 uppercase tracking-[0.2em]" autocomplete="off" spellcheck="false" [value]="challengeAnswer()" (input)="challengeAnswer.set(inputValue($event))" />
            </label>
          }
          @if (error()) {
            <p class="text-sm text-rose-300">{{ error() }}</p>
          }
          <button type="submit" class="w-full rounded-2xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-60" [disabled]="busy()">
            {{ busy() ? 'Please wait…' : mode() === 'login' ? 'Sign in' : 'Create account' }}
          </button>
        </form>

        <button type="button" class="mt-4 text-sm text-emerald-200" (click)="toggle()">
          {{ mode() === 'login' ? 'Need an account? Register' : 'Already registered? Sign in' }}
        </button>
      </section>
    </main>
  `,
})
export class AuthComponent {
  private readonly auth = inject(AuthService);
  private readonly budget = inject(BudgetStateService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly mode = signal<'login' | 'register'>('login');
  readonly name = signal('');
  readonly username = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly website = signal('');
  readonly challengeToken = signal('');
  readonly captchaImage = signal<SafeUrl | null>(null);
  readonly challengeAnswer = signal('');
  readonly error = signal('');
  readonly busy = signal(false);

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  toggle(): void {
    this.mode.update((mode) => (mode === 'login' ? 'register' : 'login'));
    this.error.set('');
    if (this.mode() === 'register') void this.loadChallenge();
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set('');
    this.busy.set(true);
    try {
      if (this.mode() === 'register') {
        await this.auth.register({
          name: this.name(),
          username: this.username(),
          email: this.email(),
          password: this.password(),
          website: this.website(),
          challengeToken: this.challengeToken(),
          challengeAnswer: this.challengeAnswer(),
        });
      } else {
        await this.auth.login(this.email(), this.password());
      }
      await this.budget.hydrate();
    } catch (error) {
      this.error.set(this.readError(error));
      if (this.mode() === 'register') void this.loadChallenge();
    } finally {
      this.busy.set(false);
    }
  }

  async loadChallenge(): Promise<void> {
    try {
      const challenge = await this.auth.challenge();
      this.challengeToken.set(challenge.token);
      this.captchaImage.set(this.sanitizer.bypassSecurityTrustUrl(challenge.image));
      this.challengeAnswer.set('');
    } catch {
      this.captchaImage.set(null);
      this.error.set('The captcha could not be loaded.');
    }
  }

  private readError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const message = error.error?.error;
      if (typeof message === 'string') return message;
      if (error.status === 0) return 'The local API is not running. Start it with npm start.';
    }
    return 'Something went wrong. Try again.';
  }
}
