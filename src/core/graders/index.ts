import type { ExecutionCommands } from '../config';
import { createLlmSuggestionEnricher } from '../enrichers/llm-suggestion';
import type { Enricher, Grader } from '../types';
import { createLintGrader } from './lint';
import { createLlmJudgeGrader } from './llm-judge';
import { createReferencesGrader } from './references';
import { suggestionApplies } from './suggestion-applies';
import { suggestionPresent } from './suggestion-present';
import { createTestsGrader } from './tests';
import { createTypecheckGrader } from './typecheck';

export {
  createLintGrader,
  createLlmJudgeGrader,
  createLlmSuggestionEnricher,
  createReferencesGrader,
  createTestsGrader,
  createTypecheckGrader,
  suggestionApplies,
  suggestionPresent,
};

export function createDefaultGraders(commands: ExecutionCommands): Grader[] {
  return [
    suggestionPresent,
    suggestionApplies,
    createReferencesGrader(),
    createTypecheckGrader(commands.typecheck),
    createLintGrader(commands.lint),
    createTestsGrader(commands.test),
    createLlmJudgeGrader(),
  ];
}

export function createDefaultEnrichers(): Enricher[] {
  return [createLlmSuggestionEnricher()];
}
