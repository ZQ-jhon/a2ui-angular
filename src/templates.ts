/*!
 * 意图模板注册表 —— 高频固定 UI(注册/登录等)的"热点缓存"。
 *
 * 思路(对应你的设想):
 *   注册表单这种标准、稳定的 UI 不该每次都让 LLM 现生成。
 *   这里把它们做成预建模板,用一个轻量的意图匹配把用户输入归类,
 *   命中即"0 调模型、0 延迟、确定性"返回 —— 跨用户复用、且不含任何 PII。
 *
 * 与缓存层的关系:
 *   - 模板命中 = 最高优先级的热点缓存,根本不进 LLM,也不查 Redis。
 *   - 模板是"UI 骨架/字段定义",用户实际填入的手机号/验证码等动态数据
 *     由前端持有、提交时单独发送,绝不写进任何共享缓存。
 *
 * 返回结构与 chatFlow 完全一致: { agentResponse, options }。
 * agentResponse 里用一段约定的 JSON(formSpec)描述声明式表单骨架,
 * 这正是 A2UI 风格的"LLM 输出可序列化 UI 描述"——只是这里由模板直接给出。
 */

export interface FormField {
  name: string;
  label: string;
  type: 'tel' | 'text' | 'password' | 'code' | 'email';
  required: boolean;
  placeholder?: string;
  // 校验规则(声明式,前端据此校验;不含任何用户数据)
  pattern?: string;
}

export interface FormSpec {
  formId: string;
  title: string;
  fields: FormField[];
  submitLabel: string;
}

export interface TemplateResult {
  agentResponse: string;
  options?: string[];
  // 命中的模板 id,便于上层打日志/埋点
  templateId: string;
}

interface Template {
  id: string;
  // 命中该模板的关键词(已归一化为小写);任一命中即匹配。
  keywords: RegExp;
  build: () => TemplateResult;
}

// 把声明式表单骨架塞进 agentResponse(约定: 以 @@FORM@@ 前缀标记,
// 前端可据此识别"这是一个表单",否则当普通文本渲染)。
function formMessage(intro: string, spec: FormSpec): string {
  return `${intro}\n@@FORM@@${JSON.stringify(spec)}`;
}

// ── 模板定义 ────────────────────────────────────────────────────────────────
const TEMPLATES: Template[] = [
  {
    id: 'register-phone',
    // 注册 / 注册账号 / 注册新用户 / register / sign up
    keywords:
      /(注册|开通账号|注册账号|注册新|创建账号|register|sign\s?up|signup|create account)/,
    build: (): TemplateResult => ({
      templateId: 'register-phone',
      agentResponse: formMessage('好的,请填写以下信息完成注册:', {
        formId: 'register-phone',
        title: '注册新用户',
        fields: [
          {
            name: 'phone',
            label: '手机号',
            type: 'tel',
            required: true,
            placeholder: '请输入手机号',
            pattern: '^1[3-9]\\d{9}$',
          },
          {
            name: 'code',
            label: '验证码',
            type: 'code',
            required: true,
            placeholder: '6 位短信验证码',
            pattern: '^\\d{6}$',
          },
        ],
        submitLabel: '注册',
      }),
      options: ['已有账号,去登录', '换用邮箱注册'],
    }),
  },
  {
    id: 'login-phone',
    keywords: /(登录|登入|sign\s?in|signin|log\s?in|login)/,
    build: (): TemplateResult => ({
      templateId: 'login-phone',
      agentResponse: formMessage('请登录:', {
        formId: 'login-phone',
        title: '登录',
        fields: [
          {
            name: 'phone',
            label: '手机号',
            type: 'tel',
            required: true,
            placeholder: '请输入手机号',
            pattern: '^1[3-9]\\d{9}$',
          },
          {
            name: 'code',
            label: '验证码',
            type: 'code',
            required: true,
            placeholder: '6 位短信验证码',
            pattern: '^\\d{6}$',
          },
        ],
        submitLabel: '登录',
      }),
      options: ['没有账号,去注册', '用密码登录'],
    }),
  },
];

/**
 * 尝试用模板匹配用户输入。命中返回模板结果(可直接作为 flow 输出),
 * 未命中返回 null —— 上层据此继续走缓存/模型。
 *
 * @param normalizedInput 已归一化(小写、去标点)的用户输入
 */
export function matchTemplate(normalizedInput: string): TemplateResult | null {
  for (const t of TEMPLATES) {
    if (t.keywords.test(normalizedInput)) {
      return t.build();
    }
  }
  return null;
}

// 便于测试/观测: 列出所有模板 id
export function listTemplateIds(): string[] {
  return TEMPLATES.map((t) => t.id);
}
