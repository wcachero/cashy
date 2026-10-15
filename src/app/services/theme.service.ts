import { Injectable, signal } from '@angular/core';
import { ThemeMode, applyTheme, readStoredTheme } from '../core/theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(readStoredTheme());

  constructor() {
    applyTheme(this.mode());
  }

  toggle(): void {
    const next: ThemeMode = this.mode() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    this.mode.set(next);
  }
}
