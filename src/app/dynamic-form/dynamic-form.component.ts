import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FormSpec } from '../agent.service';

@Component({
  selector: 'app-dynamic-form',
  imports: [FormsModule],
  templateUrl: './dynamic-form.component.html',
  styleUrl: './dynamic-form.component.scss',
})
export class DynamicFormComponent {
  form = input.required<FormSpec>();
  submitForm = output<Record<string, unknown>>();

  submitting = signal(false);
  submitted = signal(false);
  private values = signal<Record<string, unknown>>({});

  missingRequired = computed(() => {
    const v = this.values();
    return this.form().fields.some(
      (f) => f.required && (v[f.name] === undefined || v[f.name] === '')
    );
  });

  setValue(name: string, value: unknown): void {
    this.values.update((prev) => ({ ...prev, [name]: value }));
  }

  onSubmit(): void {
    if (this.missingRequired() || this.submitting() || this.submitted()) {
      return;
    }
    this.submitting.set(true);
    this.submitted.set(true);
    this.submitForm.emit(this.values());
  }
}
