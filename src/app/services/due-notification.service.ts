import { Injectable, effect, inject } from '@angular/core';
import { duePhrase, formatLongDate } from '../core/dates';
import { formatPhp } from '../core/money';
import { BudgetStateService } from './budget-state.service';

@Injectable({ providedIn: 'root' })
export class DueNotificationService {
  private readonly budget = inject(BudgetStateService);
  private readonly notified = new Set<string>();

  constructor() {
    effect(() => {
      if (!this.budget.notificationsEnabled()) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      for (const due of this.budget.upcomingDues()) {
        const key = `${due.liabilityId}:${due.dueDate}:${due.suggestedAmount}`;
        if (this.notified.has(key)) continue;
        this.notified.add(key);
        const amount = due.minimumDue && due.minimumDue < due.fullBalance ? due.minimumDue : due.suggestedAmount;
        try {
          new Notification(`${due.name} · ${duePhrase(due.daysUntil)}`, {
            body: `Pay ${formatPhp(amount)} by ${formatLongDate(due.dueDate)}.`,
            tag: key,
          });
        } catch {
          // Some browsers block the constructor outside a user gesture. The in-app banner still shows.
        }
      }
    });
  }

  async requestPermission(): Promise<boolean> {
    if (typeof Notification === 'undefined') return false;
    const result = await Notification.requestPermission();
    const granted = result === 'granted';
    this.budget.setNotificationsEnabled(granted);
    return granted;
  }
}
