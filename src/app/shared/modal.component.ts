import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, effect, input, output } from '@angular/core';

const modalStack: ModalComponent[] = [];

@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div
        class="fixed inset-0 flex min-h-dvh justify-center p-3 sm:items-center sm:p-6"
        [class.items-end]="align() !== 'center'"
        [class.items-center]="align() === 'center'"
        [style.z-index]="layer()"
      >
        <button type="button" class="absolute inset-0 bg-slate-950/75 backdrop-blur-sm" (click)="closed.emit()" aria-label="Close dialog"></button>
        <div
          role="dialog"
          aria-modal="true"
          class="relative max-h-[min(90dvh,90vh)] w-full overflow-y-auto rounded-3xl border border-white/10 bg-slate-900 p-5 text-left shadow-2xl sm:p-6"
          [class.max-w-lg]="size() !== 'lg'"
          [class.max-w-3xl]="size() === 'lg'"
        >
          <ng-content />
        </div>
      </div>
    }
  `,
})
export class ModalComponent implements OnDestroy {
  readonly open = input(false);
  readonly layer = input(70);
  readonly size = input<'md' | 'lg'>('md');
  readonly align = input<'bottom' | 'center'>('bottom');
  readonly closed = output<void>();

  constructor() {
    effect(() => {
      const isOpen = this.open();
      const index = modalStack.indexOf(this);
      if (isOpen && index < 0) modalStack.push(this);
      if (!isOpen && index >= 0) modalStack.splice(index, 1);
    });
  }

  ngOnDestroy(): void {
    const index = modalStack.indexOf(this);
    if (index >= 0) modalStack.splice(index, 1);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open() && modalStack.at(-1) === this) this.closed.emit();
  }
}
