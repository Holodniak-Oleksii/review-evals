import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

export const DEFAULT_MODEL = 'claude-opus-5-5';

export type Effort = 'low' | 'medium' | 'high';

export interface ModelRequest<S extends z.ZodType> {
  system: string;
  prompt: string;
  schema: S;
  effort: Effort;
}

export type ModelResult<T> = { ok: true; value: T; model: string } | { ok: false; reason: string };

export interface ModelClient {
  readonly model: string;
  generate<S extends z.ZodType>(request: ModelRequest<S>): Promise<ModelResult<z.infer<S>>>;
}

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string = DEFAULT_MODEL,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 5 * 60 * 1000 });
  }

  async generate<S extends z.ZodType>(request: ModelRequest<S>): Promise<ModelResult<z.infer<S>>> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        output_config: { effort: request.effort, format: betaZodOutputFormat(request.schema) },
      });

      if (response.stop_reason === 'refusal') {
        return { ok: false, reason: `модель відмовилась відповідати (${response.stop_details?.category ?? 'без категорії'})` };
      }
      if (response.stop_reason === 'max_tokens') return { ok: false, reason: 'відповідь моделі обрізано за max_tokens' };
      if (response.parsed_output === null) return { ok: false, reason: 'модель відповіла не за схемою' };
      return { ok: true, value: response.parsed_output as z.infer<S>, model: response.model };
    } catch (error) {
      return { ok: false, reason: describeError(error) };
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'ключ Anthropic API недійсний';
  if (error instanceof Anthropic.PermissionDeniedError) return 'ключ Anthropic API не має доступу до моделі';
  if (error instanceof Anthropic.NotFoundError) return 'модель не знайдено';
  if (error instanceof Anthropic.RateLimitError) return 'перевищено ліміт запитів до Anthropic API';
  if (error instanceof Anthropic.BadRequestError) return `некоректний запит до Anthropic API: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return 'немає з\'єднання з Anthropic API';
  if (error instanceof Anthropic.APIError) return `помилка Anthropic API ${error.status ?? ''}`.trim();
  return error instanceof Error ? error.message : String(error);
}
