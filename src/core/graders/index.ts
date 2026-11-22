import type { ExecutionCommands } from '../config';
import type { Grader } from '../types';
import { createLintGrader } from './lint';
import { suggestionApplies } from './suggestion-applies';
import { suggestionPresent } from './suggestion-present';
import { createTestsGrader } from './tests';
import { createTypecheckGrader } from './typecheck';

export { createLintGrader, createTestsGrader, createTypecheckGrader, suggestionApplies, suggestionPresent };

export function createDefaultGraders(commands: ExecutionCommands): Grader[] {
  return [
    suggestionPresent,
    suggestionApplies,
    createTypecheckGrader(commands.typecheck),
    createLintGrader(commands.lint),
    createTestsGrader(commands.test),
  ];
}
