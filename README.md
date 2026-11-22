# review-evals

Eval-фреймворк для оцінювання достовірності рекомендацій code review.

Частина магістерської роботи «Розроблення системи оцінювання достовірності рекомендацій
щодо якості програмного коду» (УжНУ, 121 Інженерія програмного забезпечення).

## Що це

Кожна рекомендація — коментар рев'ю від LLM або від людини — проходить через набір
**оцінювачів** (graders). Оцінювач — це одна окрема перевірка. Вона повертає:

- статус: `pass` (пройдено), `fail` (не пройдено) або `skip` (не застосовується);
- оцінку від 0 до 1;
- коротке пояснення (evidence).

На етапі 4 агрегатор об'єднає результати оцінювачів в одну **оцінку довіри** від 0 до 1.

Головний принцип: рішення ухвалюють **детерміновані перевірки** — компілятор, лінтер,
тести, AST. LLM дає лише допоміжний сигнал.

| Тип (`kind`) | Що робить                          | Приклади                                   |
| ------------ | ---------------------------------- | ------------------------------------------ |
| `execution`  | запускає код                       | `tsc --noEmit`, ESLint, тести (етап 2)     |
| `static`     | аналізує текст або AST без запуску | `suggestion-present`, ts-morph (етап 3)    |
| `model`      | використовує LLM                   | LLM-as-a-judge (етап 3)                    |
| `human`      | мітка від людини                   | розмітка датасету (етап 5)                 |

Одне ядро (`src/core`) працює у двох режимах:

- **онлайн** — GitHub Action оцінює коментарі рев'ю в pull request (`src/action`);
- **офлайн** — CLI-харнес проганяє розмічений датасет і рахує метрики (`src/cli`, етап 5).

## Стан: етап 1

Зараз є один оцінювач — `suggestion-present`. Він перевіряє, чи містить коментар
блок ```` ```suggestion ````. Лише таку конкретну зміну коду можна буде застосувати
й перевірити компілятором і тестами на етапі 2.

Що робить Action під час запуску:

1. Знаходить номер PR: з `payload.pull_request` або з `payload.workflow_run.pull_requests[0]`.
2. Читає всі review comments цього PR.
3. Пропускає відповіді, а також коментарі, під якими вже є відповідь Review Evals
   (з прихованим маркером `<!-- review-evals -->`). Тому повторний запуск не дублює відповіді.
4. Для кожного нового коментаря запускає всі оцінювачі й відповідає під ним чек-листом.
5. Пише Job Summary з таблицею «файл:рядки | джерело | результати оцінювачів».

Джерело визначається за автором: `user.type === 'Bot'` → `LLM`, інакше → `людина`.

Приклад відповіді під коментарем:

```markdown
**Review Evals** — автоматична перевірка рекомендації

Джерело: **LLM (`claude[bot]`)**

- ✔ `suggestion-present` — Коментар містить блок suggestion (рядків коду: 1).
```

## Як підключити

1. Репозиторій `review-evals` має бути доступний для workflow: публічний або приватний
   з дозволом у *Settings → Actions → General → Access*.
2. У своєму репозиторії скопіюйте [docs/example-workflow.yml](docs/example-workflow.yml)
   у `.github/workflows/review-evals.yml` і замініть `<OWNER>`:

```yaml
name: Review Evals

on:
  workflow_run:
    workflows: ["Claude Auto Review"]
    types: [completed]
  pull_request_review:
    types: [submitted]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: review-evals-${{ github.event.pull_request.number || github.event.workflow_run.pull_requests[0].number || github.run_id }}
  cancel-in-progress: false

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: <OWNER>/review-evals@main
        with:
          mode: annotate
```

Що треба знати:

- `workflow_run` спрацьовує, лише коли файл workflow є в гілці за замовчуванням (`main`).
  Поки файл є лише в гілці PR, працюватиме тільки тригер `pull_request_review`.
- Назва в `workflows: ["Claude Auto Review"]` має точно збігатися з полем `name:` workflow рев'ю.
- Події, які створює `GITHUB_TOKEN`, не запускають інші workflow. Тому відповіді Review Evals
  не запускають його повторно. З тієї ж причини, якщо рев'ю пише коментарі через `GITHUB_TOKEN`,
  подія `pull_request_review` не прийде. Для цього випадку і є тригер `workflow_run`.
- Для PR з форків `workflow_run.pull_requests` порожній, а токен у `pull_request_review`
  має лише право читання. Етап 1 розрахований на PR з того самого репозиторію.
- `concurrency` не дає двом запускам для одного PR працювати одночасно й відповісти двічі.

### Вхідні параметри

| Параметр       | За замовчуванням      | Опис                                                                  |
| -------------- | --------------------- | --------------------------------------------------------------------- |
| `github-token` | `${{ github.token }}` | Токен для GitHub API. Потрібен дозвіл `pull-requests: write`.         |
| `mode`         | `annotate`            | `annotate` — відповідати під коментарями. `filter` і `hybrid` — етап 4; зараз вони працюють як `annotate` і пишуть попередження. |

## Розробка

Потрібен Node.js 24 (`nvm use` читає версію з `.nvmrc`).

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

`npm run all` виконує всі три перевірки підряд.

**`dist/` комітиться.** GitHub запускає `dist/index.js` напряму, без `npm install`.
Після кожної зміни в `src/` виконайте `npm run build` і закомітьте `dist/` разом зі змінами.

TypeScript закріплено на версії 6.0. TypeScript 7 (нативний компілятор) не має JS API,
який потрібен `@vercel/ncc`, а на етапі 3 — ts-morph.

### Як додати оцінювача

1. Створіть `src/core/graders/<name>.ts`, який реалізує інтерфейс `Grader` з `src/core/types.ts`.
2. Додайте його в `defaultGraders` у `src/core/graders/index.ts`.
3. Додайте тест у `test/`.

Якщо оцінювач кидає помилку, ядро не зупиняється: результат стає `skip` з текстом помилки.

## Структура

```
action.yml              опис Action (node24 → dist/index.js)
src/core/               ядро, спільне для онлайн- і офлайн-режиму
  types.ts              Recommendation, GradeResult, EvalContext, Grader, Evaluation
  parse.ts              parseRecommendation, extractSuggestion
  selection.ts          які коментарі оцінювати
  evaluate.ts           запуск оцінювачів
  report.ts, marker.ts  текст відповіді та Job Summary
  mode.ts               annotate | filter | hybrid
  graders/              оцінювачі
src/action/             онлайн-режим: тонкий шар над GitHub API
src/cli/                офлайн-режим (етап 5)
datasets/               розмічені датасети (етап 5)
test/                   тести vitest
docs/                   приклад workflow
dist/                   зібраний Action (комітиться)
```

## Наступні етапи

2. **Execution-оцінювачі.** Застосувати suggestion у git worktree гілки PR. Запустити
   `tsc --noEmit`, ESLint і тести до і після зміни, з таймаутами.
3. **Static і model-оцінювачі.** ts-morph: чи існують символи та пакети, на які посилається
   рекомендація. LLM перетворює текстовий коментар на зміну; LLM-as-a-judge.
4. **Агрегатор і режими.** Правила, потім логістична регресія (`weights.json`).
   Режими `filter` і `hybrid`: згортання коментаря через GraphQL `minimizeComment`, не видалення.
5. **Офлайн CLI-харнес.** Датасет JSON/YAML з мітками. Метрики Precision, Recall, F1,
   Accuracy, Brier Score, діаграма калібрування, ablation.
