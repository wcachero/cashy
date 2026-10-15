import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ModalComponent } from './modal.component';

@Component({
  selector: 'app-warning',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent],
  template: `
    <app-modal [open]="message().trim().length > 0" [layer]="90" (closed)="closed.emit()">
      <h2 class="text-xl font-bold">Please check this</h2>
      <p class="mt-2 text-sm text-rose-200">{{ message() }}</p>
      <button type="button" class="mt-5 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-950" (click)="closed.emit()">OK</button>
    </app-modal>
  `,
})
export class WarningPopupComponent {
  readonly message = input('');
  readonly closed = output<void>();
}
