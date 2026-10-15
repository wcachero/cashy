import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';

@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center sm:p-6">
        <button type="button" class="absolute inset-0 bg-slate-950/75 backdrop-blur-sm" (click)="closed.emit()" aria-label="Close dialog"></button>
        <div
          role="dialog"
          aria-modal="true"
          class="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl sm:p-6"
        >
          <ng-content />
        </div>
      </div>
    }
  `,
})
export class ModalComponent {
  readonly open = input(false);
  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.closed.emit();
  }
}
