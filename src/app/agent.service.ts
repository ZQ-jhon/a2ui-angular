/*!
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */
import { Injectable, signal, resource, linkedSignal } from '@angular/core';
import { runFlow } from 'genkit/beta/client';

const USER = 'USER';
const AGENT = 'AGENT';
const ENDPOINT = '/chatFlow';
const SUBMIT_ENDPOINT = '/submitForm';

@Injectable({
  providedIn: 'root'
})
export class AgentService {
  userInput = signal('');

  // 仅在首次请求时生成,后续沿用同一会话 id。
  // 注意:此处仅为演示,生产环境请用更稳妥的会话管理方案。
  sessionId = linkedSignal<string, string>({
    source: () => this.agentResource.value()?.agentResponse || '',
    computation: (_agentResponse, previous): string =>
      (!previous ? Date.now() + '' + Math.floor(Math.random() * 1000000000) : previous.value)
  });

  // 首次请求置 true(清空会话),之后置 false 以保留会话上下文。
  clearSession = linkedSignal({
    source: () => this.agentResource.value()?.agentResponse,
    computation: (_agentResponse, previous): boolean => !previous
  });

  chat = linkedSignal<AgentResponse, Chat[]>({
    source: () => this.agentResource.value(),
    computation: (response, previous): Chat[] => {
      if (response.agentResponse === '') {
        return previous?.value || [];
      }

      const chatItem = this.chatItem(response.agentResponse, AGENT, response.form);
      return (previous) ? [chatItem, ...previous.value] : [chatItem];
    }
  });

  agentResource = resource({
    defaultValue: { agentResponse: '', options: [] },
    request: () => this.userInput(),
    loader: ({request}): Promise<AgentResponse> => {
      return runFlow({ url: ENDPOINT, input: {
        userInput: request,
        sessionId: this.sessionId(),
        clearSession: this.clearSession()
      }});
    }
  });

  updateChatFromUser(userInput: string): void {
    const chatItem = this.chatItem(userInput, USER);
    this.chat.update(value => [chatItem, ...value]);
    this.userInput.set(userInput);
  }

  /**
   * 提交动态表单(方案 C 双路闭环):
   *  ① 立即把成功回执作为 AGENT 气泡推入对话;
   *  ② 把"用户已提交表单"带同一 sessionId 回喂 chatFlow,让 Agent 续聊。
   */
  async submitForm(form: FormSpec, data: Record<string, unknown>): Promise<void> {
    const result = await runFlow<SubmitResponse>({
      url: SUBMIT_ENDPOINT,
      input: { formId: form.formId, sessionId: this.sessionId(), data },
    });

    // 路①:即时回执气泡
    const receipt = this.chatItem(result.message, AGENT);
    this.chat.update(value => [receipt, ...value]);

    // 路②:把提交结果回喂会话续聊
    const summary = `我已提交表单「${form.title}」(formId: ${form.formId}),数据为 ${JSON.stringify(data)}。`;
    this.userInput.set(summary);
  }

  chatItem(text: string, role: Role, form?: FormSpec): Chat {
    return {
      id: Math.floor(Math.random() * 2000),
      role,
      text,
      form
    };
  }
}

type Role = 'AGENT' | 'USER';

interface Chat {
  id: number,
  role: Role;
  text: string;
  form?: FormSpec;
}

interface AgentResponse {
  agentResponse: string;
  options: string[];
  form?: FormSpec;
}

export type FormFieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox';

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  placeholder?: string;
}

export interface FormSpec {
  formId: string;
  title: string;
  fields: FormField[];
  submitLabel?: string;
}

export interface SubmitResponse {
  success: boolean;
  message: string;
  submittedAt: string;
}