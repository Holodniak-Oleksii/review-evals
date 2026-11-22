import { errorMessage } from '../errors';
import { extractReferences, type Reference } from '../static/references';
import { TypeScriptProject, type Lookup, type ProjectLoad } from '../static/typescript-project';
import type { GradeResult, Grader, Recommendation } from '../types';
import { result } from './execution';

const NAME = 'references';
const LISTED = 5;

export function createReferencesGrader(): Grader {
  const projects = new Map<string, ProjectLoad>();

  const project = (dir: string): ProjectLoad => {
    let loaded = projects.get(dir);
    if (!loaded) {
      loaded = TypeScriptProject.load(dir);
      projects.set(dir, loaded);
    }
    return loaded;
  };

  return {
    name: NAME,
    kind: 'static',
    async grade(rec, ctx): Promise<GradeResult> {
      const references = extractReferences(rec.body);
      if (references.length === 0) {
        return result(NAME, 'skip', 0, 'У коментарі немає посилань на код: імен у `лапках`, імпортів чи шляхів.');
      }
      if (!ctx.workspace || !rec.commitId) return result(NAME, 'skip', 0, 'Робочу теку не налаштовано.');

      let dir: string;
      try {
        dir = await ctx.workspace.checkout(rec.commitId);
      } catch (error) {
        return result(NAME, 'skip', 0, `Не вдалося отримати коміт коментаря: ${errorMessage(error)}.`);
      }

      const loaded = project(dir);
      if (!loaded.ok) return result(NAME, 'skip', 0, `Перевірку не запущено: ${loaded.reason}.`);

      const checked = references.map((reference) => ({ text: reference.text, lookup: check(loaded.project, reference, rec) }));
      const pick = (...kinds: Lookup[]) => checked.filter((item) => kinds.includes(item.lookup)).map((item) => item.text);
      const known = pick('found', 'unknown');
      const missing = pick('missing');
      const unseen = pick('unseen');
      const total = checked.length;
      const score = known.length / total;
      const tally = `Знайдено ${known.length} з ${total} посилань.`;
      const maybeNew = unseen.length > 0 ? ` Немає в коді (можливо, нові імена): ${list(unseen)}.` : '';

      if (missing.length > 0) {
        return result(NAME, 'fail', score, `Не знайдено в коді: ${list(missing)}.${maybeNew} ${tally}`);
      }
      if (known.length === 0) {
        return result(NAME, 'fail', 0, `Жодного посилання немає в коді: ${list(unseen)}.`);
      }
      if (unseen.length > 0) return result(NAME, 'pass', score, `${tally}${maybeNew}`);
      return result(NAME, 'pass', 1, `Усі посилання є в коді (${total}): ${list(known)}.`);
    },
  };
}

function check(project: TypeScriptProject, reference: Reference, rec: Recommendation): Lookup {
  switch (reference.kind) {
    case 'file':
      return project.hasFile(reference.path, rec.path) ? 'found' : 'missing';
    case 'module':
      return project.hasModule(reference.specifier, rec.path) ? 'found' : 'missing';
    case 'symbol':
      return project.lookup(reference.path, rec.path, rec.startLine ?? rec.endLine);
  }
}

function list(items: string[]): string {
  const shown = items.slice(0, LISTED).map((item) => `\`${item}\``);
  return items.length > LISTED ? `${shown.join(', ')} та ще ${items.length - LISTED}` : shown.join(', ');
}
