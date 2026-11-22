import type { Grader } from '../types';
import { suggestionPresent } from './suggestion-present';

export { suggestionPresent };

export const defaultGraders: readonly Grader[] = [suggestionPresent];
