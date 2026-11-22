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

| Тип (`kind`) | Що робить                          | Оцінювачі                                       |
| ------------ | ---------------------------------- | ----------------------------------------------- |
| `execution`  | запускає код                       | `typecheck`, `lint`, `tests`                    |
| `static`     | аналізує текст або AST без запуску | `suggestion-present`, `suggestion-applies`; ts-morph (етап 3) |
| `model`      | використовує LLM                   | LLM-as-a-judge (етап 3)                         |
| `human`      | мітка від людини                   | розмітка датасету (етап 5)                      |

Одне ядро (`src/core`) працює у двох режимах:

- **онлайн** — GitHub Action оцінює коментарі рев'ю в pull request (`src/action`);
- **офлайн** — CLI-харнес проганяє розмічений датасет і рахує метрики (`src/cli`, етап 5).

## Стан: етап 2

### Оцінювачі

| Оцінювач             | Що перевіряє                                                       | Результат |
| -------------------- | ------------------------------------------------------------------ | --------- |
| `suggestion-present` | чи є в коментарі блок ```` ```suggestion ````                       | `pass` / `skip` |
| `suggestion-applies` | чи можна застосувати suggestion до файлу в коміті коментаря        | `fail`, якщо рядків немає, файлу немає або suggestion нічого не змінює |
| `typecheck`          | перевірка типів **до** і **після** зміни                           | `fail`, якщо з'явилася нова помилка TypeScript |
| `lint`               | ESLint для зміненого файлу до і після зміни                        | `fail` для нової помилки, `pass` з оцінкою 0.5 для нового попередження |
| `tests`              | тести, пов'язані зі зміненим файлом, до і після зміни              | `fail`, якщо хоча б один тест проходив до зміни і падає після неї |

Execution-оцінювачі порівнюють стан «до» і «після», а не лише «після». Тому старі помилки
проєкту не роблять рекомендацію поганою: важливо лише, що **додала** сама зміна.
Помилки порівнюються без номерів рядків, бо suggestion зсуває рядки.

`tests` порівнює **окремі тести** з JSON-звітів Vitest або Jest (`{report}` у команді).
Тест, який падав ще до зміни (наприклад, бо немає БД), на результат не впливає.
Якщо звіту немає, оцінювач порівнює лише коди виходу команди.

Коли результат не можна отримати чесно, оцінювач повертає `skip`, а не `fail`:
команда не працює навіть без зміни, тести падали ще до зміни, вийшов ліміт часу,
змінено не код JavaScript/TypeScript.

### Як працює запуск коду

1. Для коміту, до якого залишено коментар, створюється `git worktree` «до». Він один на коміт.
   Якщо коміту немає локально, Action робить `git fetch` цього коміту.
2. Для кожної рекомендації створюється окремий `git worktree` «після», і в ньому
   застосовується suggestion. Кінці рядків `\r\n` і фінальний перенос зберігаються.
3. В обидва worktree додається посилання на `node_modules` з основного checkout.
   Тому залежності треба встановити **до** кроку Review Evals.
4. Команди запускаються по черзі, з лімітом часу. Після ліміту Action зупиняє всю групу процесів.
   Результати «до» кешуються, тому команда «до» запускається один раз на коміт.
5. Наприкінці всі worktree видаляються.

### Команди за замовчуванням

Action визначає команди з `package.json` основного checkout:

| Перевірка   | Як визначається                                                                    |
| ----------- | ---------------------------------------------------------------------------------- |
| `typecheck` | скрипт `typecheck` (або `type-check`, `check-types`, `tsc`), інакше `tsc --noEmit`, якщо є `typescript` |
| `lint`      | `eslint`, якщо він є в залежностях. Action сам додає `--format json -- <файл>`     |
| `tests`     | `vitest related --run --passWithNoTests --reporter=json --outputFile={report} {files}` або `jest --findRelatedTests --passWithNoTests --json --outputFile={report} {files}` |

Менеджер пакетів береться з поля `packageManager` або з lock-файлу (pnpm, yarn, npm).
Кожну команду можна замінити через input, а значення `off` вимикає перевірку.

### Що робить Action під час запуску

1. Знаходить номер PR: з `payload.pull_request` або з `payload.workflow_run.pull_requests[0]`.
2. Читає всі review comments цього PR.
3. Пропускає відповіді, а також коментарі, під якими вже є відповідь Review Evals
   (з прихованим маркером `<!-- review-evals -->`). Тому повторний запуск не дублює відповіді.
4. Для кожного нового коментаря запускає всі оцінювачі й відповідає під ним чек-листом.
5. Пише Job Summary з таблицею «файл:рядки | джерело | результати оцінювачів» і списком команд.

Джерело визначається за автором: `user.type === 'Bot'` → `LLM`, інакше → `людина`.

Приклад відповіді під коментарем:

```markdown
**Review Evals** — автоматична перевірка рекомендації

Джерело: **LLM (`claude[bot]`)**

- ✔ `suggestion-present` — Коментар містить блок suggestion (рядків коду: 1).
- ✔ `suggestion-applies` — Suggestion застосовується до src/App.tsx:12.
- ✘ `typecheck` — Зміна додає помилок TypeScript: 1. Перша: TS2322 у src/App.tsx:12: Type 'string' is not assignable to type 'number'.
- ✔ `lint` — Зміна не додає проблем ESLint.
- – `tests` — Немає тестів, пов'язаних зі зміненим файлом.
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
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.event.pull_request.head.sha }}
          persist-credentials: false

      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - uses: <OWNER>/review-evals@main
        with:
          timeout-seconds: 300
```

### Приклад для pnpm (демо-репозиторій Pampojo)

У Pampojo залежності встановлює локальний composite action `./.github/actions/setup`
(pnpm, Node з `.nvmrc`, `pnpm install`).

`next.config.ts` у Pampojo перевіряє env через `parseEnv`, тому без `DATABASE_URL`
і `BETTER_AUTH_SECRET` падає вже `next typegen`. Для перевірки типів досить фіктивних
значень: це не секрети, і БД з ними недоступна. Тому job виглядає так:

```yaml
  evaluate:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    env:
      DATABASE_URL: postgres://review-evals:placeholder@127.0.0.1:5432/none
      BETTER_AUTH_SECRET: review-evals-placeholder-secret-not-real-0000
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.event.pull_request.head.sha }}
          persist-credentials: false

      - uses: ./.github/actions/setup

      - uses: Holodniak-Oleksii/review-evals@main
        with:
          timeout-seconds: 300
```

Команди визначаються автоматично: `pnpm run typecheck`, `pnpm exec eslint`,
`pnpm exec vitest related --run --passWithNoTests --reporter=json --outputFile={report} {files}`.

Тести Pampojo, яким потрібна БД, з фіктивним `DATABASE_URL` падають і до, і після зміни
(`ECONNREFUSED`). `tests` їх не враховує і порівнює лише ті тести, що працюють без БД.
Справжні секрети БД сюди навмисно не передаються: БД спільна з production.
Browser-тести потребують `pnpm exec playwright install --with-deps chromium`.

### Що треба знати

- `workflow_run` спрацьовує, лише коли файл workflow є в гілці за замовчуванням (`main`).
  Поки файл є лише в гілці PR, працюватиме тільки тригер `pull_request_review`.
- Назва в `workflows: ["Claude Auto Review"]` має точно збігатися з полем `name:` workflow рев'ю.
- При `workflow_run` `actions/checkout` без `ref` бере `main`, а не гілку PR. Тому в прикладі
  є `ref: head_sha`: залежності встановлюються саме для коду PR.
- Події, які створює `GITHUB_TOKEN`, не запускають інші workflow. Тому відповіді Review Evals
  не запускають його повторно. З тієї ж причини, якщо рев'ю пише коментарі через `GITHUB_TOKEN`,
  подія `pull_request_review` не прийде. Для цього випадку і є тригер `workflow_run`.
- `concurrency` не дає двом запускам для одного PR працювати одночасно й відповісти двічі.
- Кожна suggestion — це окремий запуск перевірки типів, ESLint і тестів. Для великого PR
  це може тривати довго, тому в прикладі є `timeout-minutes: 60`.

### Безпека

Execution-оцінювачі **запускають код із PR**: скрипти `package.json`, конфіги ESLint і Vitest.
`workflow_run` і `pull_request_review` працюють з токеном, який може писати в PR.

- Для PR з форків запуск коду вимкнено (`allow-forks: false`). Для них `workflow_run.pull_requests`
  порожній, а токен у `pull_request_review` має лише право читання.
- Команди отримують env без токенів: Action прибирає `INPUT_*`, `ACTIONS_*`, `GITHUB_TOKEN`, `GH_TOKEN`.
- `persist-credentials: false` у checkout не залишає токен у `.git/config`, який може прочитати код PR.
  Для `git fetch` Action передає токен окремо, через env процесу git.
- Секрети репозиторію не передавайте в цей workflow.

### Вхідні параметри

| Параметр            | За замовчуванням      | Опис |
| ------------------- | --------------------- | ---- |
| `github-token`      | `${{ github.token }}` | Токен для GitHub API. Потрібен дозвіл `pull-requests: write`. |
| `mode`              | `annotate`            | `annotate` — відповідати під коментарями. `filter` і `hybrid` — етап 4; зараз вони працюють як `annotate` і пишуть попередження. |
| `typecheck-command` | автоматично           | Команда перевірки типів. `off` вимикає. |
| `lint-command`      | автоматично           | Команда ESLint без аргументів, наприклад `pnpm exec eslint`. `off` вимикає. |
| `test-command`      | автоматично           | Команда тестів; `{files}` замінюється на змінені файли. `off` вимикає. |
| `timeout-seconds`   | `300`                 | Ліміт часу для однієї команди. |
| `allow-forks`       | `false`               | Запускати код із PR з форків. Небезпечно. |

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
   Execution-оцінювачу допоможуть `runExecutionCheck` і `runBeforeAfter` з `graders/execution.ts`.
2. Додайте його в `createDefaultGraders` у `src/core/graders/index.ts`.
3. Додайте тест у `test/`.

Якщо оцінювач кидає помилку, ядро не зупиняється: результат стає `skip` з текстом помилки.

## Структура

```
action.yml              опис Action (node24 → dist/index.js)
src/core/               ядро, спільне для онлайн- і офлайн-режиму
  types.ts              Recommendation, GradeResult, Grader, Workspace, Sandbox
  parse.ts              parseRecommendation, extractSuggestion
  selection.ts          які коментарі оцінювати
  evaluate.ts           запуск оцінювачів
  config.ts             автовизначення команд перевірок
  report.ts, marker.ts  текст відповіді та Job Summary
  mode.ts               annotate | filter | hybrid
  workspace/            git worktree «до» і «після», застосування suggestion, запуск команд
  checks/               розбір виводу tsc і ESLint, різниця «до/після»
  graders/              оцінювачі
src/action/             онлайн-режим: тонкий шар над GitHub API
src/cli/                офлайн-режим (етап 5)
datasets/               розмічені датасети (етап 5)
test/                   тести vitest
docs/                   приклад workflow
dist/                   зібраний Action (комітиться)
```

## Наступні етапи

3. **Static і model-оцінювачі.** ts-morph: чи існують символи та пакети, на які посилається
   рекомендація. LLM перетворює текстовий коментар на зміну; LLM-as-a-judge.
4. **Агрегатор і режими.** Правила, потім логістична регресія (`weights.json`).
   Режими `filter` і `hybrid`: згортання коментаря через GraphQL `minimizeComment`, не видалення.
5. **Офлайн CLI-харнес.** Датасет JSON/YAML з мітками. Метрики Precision, Recall, F1,
   Accuracy, Brier Score, діаграма калібрування, ablation.
