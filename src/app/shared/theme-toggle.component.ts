import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideMoon, LucideSun } from '@lucide/angular';
import { ThemeService } from '../services/theme.service';

@Component({
  selector: 'app-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideSun, LucideMoon],
  template: `
    <button
      type="button"
      class="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-slate-300"
      [attr.aria-label]="theme.mode() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
      (click)="theme.toggle()"
    >
      @if (theme.mode() === 'dark') {
        <svg lucideSun [size]="16"></svg>
      } @else {
        <svg lucideMoon [size]="16"></svg>
      }
    </button>
  `,
})
export class ThemeToggleComponent {
  readonly theme = inject(ThemeService);
}
