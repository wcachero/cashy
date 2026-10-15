import { Pipe, PipeTransform } from '@angular/core';
import { formatPhp } from '../core/money';

@Pipe({ name: 'php', standalone: true })
export class PhpPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatPhp(value);
  }
}
