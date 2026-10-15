import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { MONTH_OPTIONS } from '../core/period';

@Component({
  selector: 'app-period-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap gap-2">
      <label class="text-xs text-slate-400">
        Month
        <select class="mt-1 block rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [value]="month()" (change)="month.set(choice($event))">
          <option value="all">All</option>
          @for (item of months; track item.value) {
            <option [value]="item.value">{{ item.label }}</option>
          }
        </select>
      </label>
      <label class="text-xs text-slate-400">
        Year
        <select class="mt-1 block rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" [value]="year()" (change)="year.set(choice($event))">
          <option value="all">All</option>
          @for (item of years(); track item) {
            <option [value]="item">{{ item }}</option>
          }
        </select>
      </label>
    </div>
  `,
})
export class PeriodFilterComponent {
  readonly month = model('all');
  readonly year = model('all');
  readonly years = input<number[]>([]);
  readonly months = MONTH_OPTIONS;

  choice(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
}
