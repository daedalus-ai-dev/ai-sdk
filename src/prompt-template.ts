/**
 * Prompt Templates
 *
 * Two syntaxes for building reusable, parameterized prompts:
 *
 * 1. Tagged template literal — type-safe at compile time:
 *    ```ts
 *    const greet = promptTemplate`Hello, ${'name'}! You are a ${'role'}.`;
 *    greet({ name: 'Alice', role: 'developer' });
 *    ```
 *
 * 2. String with {{variable}} placeholders — convenient for dynamic/runtime use:
 *    ```ts
 *    const greet = createPrompt('Hello, {{name}}! You are a {{role}}.');
 *    greet({ name: 'Alice', role: 'developer' });
 *    ```
 */

// ─── Tagged Template Literal ──────────────────────────────────────────────────

type TemplateVars<Keys extends string[]> = { [K in Keys[number]]: string };

/**
 * Creates a type-safe prompt template using tagged template literal syntax.
 * Variable names are inferred from the interpolated string literals.
 *
 * @example
 * const summarize = promptTemplate`Summarize the following ${'language'} code:\n\n${'code'}`;
 * const prompt = summarize({ language: 'TypeScript', code: '...' });
 */
export function promptTemplate<const Keys extends string[]>(
  strings: TemplateStringsArray,
  ...keys: Keys
): (vars: TemplateVars<Keys>) => string {
  return (vars: TemplateVars<Keys>): string => {
    let result = strings[0] ?? '';
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as Keys[number];
      result += vars[key];
      result += strings[i + 1] ?? '';
    }
    return result;
  };
}

// ─── String-based Template ────────────────────────────────────────────────────

/**
 * Creates a prompt template from a string with `{{variable}}` placeholders.
 * Useful when the template is loaded from config, a file, or user input.
 *
 * @example
 * const classify = createPrompt('Classify the following text as ${{sentiment}}: {{text}}');
 * const prompt = classify({ sentiment: 'positive/negative/neutral', text: '...' });
 */
export function createPrompt(template: string): (vars: Record<string, string>) => string {
  return (vars: Record<string, string>): string => {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string): string => {
      if (!(key in vars)) {
        throw new Error(`Missing template variable: "${key}"`);
      }
      return vars[key] as string;
    });
  };
}
