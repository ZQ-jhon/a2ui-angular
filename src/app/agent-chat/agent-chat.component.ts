/*!
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */
import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { FormsModule } from '@angular/forms';
import { AgentService, FormSpec } from '../agent.service';
import { DynamicFormComponent } from '../dynamic-form/dynamic-form.component';

@Component({
  selector: 'app-agent-chat',
  imports: [MatIconModule, FormsModule, MatProgressBarModule, DynamicFormComponent],
  templateUrl: './agent-chat.component.html',
  styleUrl: './agent-chat.component.scss'
})
export class AgentChatComponent {
  agentService = inject(AgentService);
  userInput = '';

  onSubmit(): void {
    if (this.userInput !== '') {
      this.agentService.updateChatFromUser(this.userInput);
      this.userInput = '';
    }
  }

  onFormSubmit(form: FormSpec, data: Record<string, unknown>): void {
    void this.agentService.submitForm(form, data);
  }
}