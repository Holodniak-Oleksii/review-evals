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

Агрегатор об'єднує результати оцінювачів в одну **оцінку довіри** від 0 до 1.

Головний принцип: рішення ухвалюють **детерміновані перевірки** — компілятор, лінтер,
тести, AST. LLM дає лише допоміжний сигнал.

| Тип (`kind`) | Що робить                          | Оцінювачі                                       |
| ------------ | ---------------------------------- | ----------------------------------------------- |
| `execution`  | запускає код                       | `typecheck`, `lint`, `tests`                    |
| `static`     | аналізує текст або AST без запуску | `suggestion-present`, `suggestion-applies`, `references` |
| `model`      | використовує LLM                   | `llm-suggestion`, `llm-judge`                   |
| `human`      | мітка від людини                   | розмітка датасету (`npm run cli -- export`)     |

Одне ядро (`src/core`) працює у двох режимах:

- **онлайн** — GitHub Action оцінює коментарі рев'ю в pull request (`src/action`);
- **офлайн** — CLI (`src/cli`): зараз експорт датасету для розмітки, на етапі 5 — метрики.

## Стан: етапи 1–4

### Оцінювачі

| Оцінювач             | Що перевіряє                                                       | Результат |
| -------------------- | ------------------------------------------------------------------ | --------- |
| `suggestion-present` | чи є в коментарі блок ```` ```suggestion ````                       | `pass` / `skip` |
| `suggestion-applies` | чи можна застосувати suggestion до файлу в коміті коментаря        | `fail`, якщо рядків немає, файлу немає або suggestion нічого не змінює |
| `typecheck`          | перевірка типів **до** і **після** зміни                           | `fail`, якщо з'явилася нова помилка TypeScript |
| `lint`               | ESLint для зміненого файлу до і після зміни                        | `fail` для нової помилки, `pass` з оцінкою 0.5 для нового попередження |
| `tests`              | тести, пов'язані зі зміненим файлом, до і після зміни              | `fail`, якщо хоча б один тест проходив до зміни і падає після неї |
| `references`         | чи існують у коді імена, поля, модулі й файли, які згадує коментар | `fail`, якщо згаданого поля, модуля чи файлу немає |
| `llm-suggestion`     | перетворює текстовий коментар без suggestion на зміну коду         | `pass`, якщо зміну згенеровано; далі її перевіряють execution-оцінювачі |
| `llm-judge`          | думка LLM: чи правильна рекомендація для показаного коду           | `pass`/`fail`, оцінка = ймовірність, що рекомендація правильна |

Execution-оцінювачі порівнюють стан «до» і «після», а не лише «після». Тому старі помилки
проєкту не роблять рекомендацію поганою: важливо лише, що **додала** сама зміна.
Помилки порівнюються без номерів рядків, бо suggestion зсуває рядки.

`tests` порівнює **окремі тести** з JSON-звітів Vitest або Jest (`{report}` у команді).
Тест, який падав ще до зміни (наприклад, бо немає БД), на результат не впливає.
Якщо звіту немає, оцінювач порівнює лише коди виходу команди.

Коли результат не можна отримати чесно, оцінювач повертає `skip`, а не `fail`:
команда не працює навіть без зміни, тести падали ще до зміни, вийшов ліміт часу,
змінено не код JavaScript/TypeScript.

### `references`: перевірка посилань на код

Оцінювач бере з тексту коментаря імена в `` `лапках` ``, виклики (`` `formatDate()` ``),
доступ до полів (`` `user.profile.name` ``), JSX-компоненти, імпорти й шляхи до файлів.
Блок suggestion він не читає: нові імена там перевіряє `typecheck`.

Перевірка йде через **TypeScript Compiler API з `node_modules` проєкту**, з його `tsconfig.json`,
у коміті коментаря. ts-morph тут навмисно не використовується: він має свою копію TypeScript,
і `dist/` виріс би приблизно до 11 MB у кожному коміті. Крім того, так перевірка йде тією самою
версією TS, що й у проєкті.

- Ім'я шукається в області видимості рядка коментаря (`getSymbolsInScope`), потім серед
  ідентифікаторів і слів у рядкових літералах усіх файлів програми, з `.d.ts` бібліотек включно.
- Поле (`user.fullName`) перевіряється за **типом** об'єкта. Немає поля в типі — це жорсткий пропуск.
- Модуль перевіряється через `resolveModuleName`, файл — за наявністю на диску.

Жорсткий пропуск (поле, модуль, файл) дає `fail`. Окреме ім'я, якого немає ніде, — це м'який
пропуск: найчастіше коментар пропонує **нове** ім'я («Rename it to `warm`»). М'які пропуски лише
знижують оцінку, а `fail` дають, тільки якщо в коментарі немає жодного знайденого посилання.

### LLM-оцінювачі

LLM-оцінювачі вмикаються лише з input `anthropic-api-key`. Без нього вони дають `skip`.
Це допоміжний сигнал, а не рішення.

- `llm-suggestion` працює **перед** іншими оцінювачами. Якщо коментар текстовий, LLM пише зміну
  для прокоментованих рядків. Потім `suggestion-applies`, `typecheck`, `lint` і `tests` перевіряють
  саме цю зміну. У рекомендації це позначено як `suggestionOrigin: "model"`, а у відповіді
  згенерована зміна показана в розгорнутому блоці. Якщо коментар — питання чи загальне зауваження,
  LLM повертає «не застосовується», і зміна не генерується.
- `llm-judge` отримує фрагмент файлу (±20 рядків) і коментар і повертає вердикт
  `correct` / `incorrect` / `unsure` з впевненістю.

Технічно: модель `claude-opus-5-5` (input `model`), офіційний SDK `@anthropic-ai/sdk`,
structured outputs через `output_config.format` (zod-схема), `effort` `medium` для judge і `high`
для генерації зміни. Увімкнено серверний `fallbacks: "default"`: якщо класифікатори безпеки
відхилять запит, API сам повторить його на рекомендованій моделі. Відмова (`stop_reason: "refusal"`)
і помилки API дають `skip` з поясненням. Код і коментар передаються як дані з попередженням
не виконувати інструкції з них. Кожен коментар — це один-два запити до API, тобто платні виклики.

### Оцінка довіри

Обидва агрегатори рахують довіру однаково: `довіра = sigmoid(зсув + Σ вага × ознака)`.
Ознаки беруться з результатів оцінювачів:

- `<оцінювач>:pass` — оцінка `score` для `pass`;
- `<оцінювач>:fail` — сила провалу `1 − score` для `fail` (для `typecheck` це 1, для `references` — частка ненайдених посилань, для `llm-judge` — впевненість LLM);
- `skip` не дає ознаки;
- мета-ознаки: `source:llm`, `suggestion:comment`, `suggestion:model`, `severity:high` (`bug`, `security`), `severity:low` (`minor`, `nit`).

**Правила** (`aggregator: rules`, за замовчуванням) — ваги задано вручну в `src/core/aggregate/rules.ts`:

| Ознака | Вага | Вето |
| --- | --- | --- |
| `typecheck:pass` / `tests:pass` | +0.8 | |
| `typecheck:fail` / `tests:fail` | −3 | так |
| `suggestion-applies:pass` / `lint:pass` / `suggestion-present:pass` | +0.3 | |
| `suggestion-applies:fail` | −2.5 | так |
| `lint:fail` | −1.5 | так |
| `references:pass` | +0.6 | |
| `references:fail` | −1.5 | так |
| `llm-judge:pass` / `llm-judge:fail` | +1 / −1, разом не більше ±0.4 | |

- **Вето.** Будь-який детермінований `fail` обмежує довіру значенням 0.2. Рішення ухвалюють
  детерміновані перевірки.
- **LLM — допоміжний сигнал.** Внесок `llm-judge` обмежено ±0.4 logit. Тому LLM сам по собі тримає
  довіру між 0.40 і 0.60, тобто в зоні «сумнівна», і ніколи не дає «високу».
- **Зміна від LLM.** Якщо suggestion згенерував `llm-suggestion`, результати перевірок цієї зміни
  мають половинну вагу і не дають вето. Невдала реалізація від LLM ще не означає, що сама порада хибна.

Рівні: `висока` ≥ 0.7, `сумнівна` ≥ 0.4, `низька` < 0.4. Без жодних сигналів довіра дорівнює 0.5.

**Логістична регресія** (`aggregator: logistic`) бере ваги з `weights.json`, навчені на розміченому
датасеті (`npm run cli -- train`). У режимі `auto` Action використовує регресію, якщо поруч з Action
лежить `weights.json` (або задано `weights-file`), інакше — правила. Формат `weights.json`:

```json
{ "version": 1, "bias": -0.4, "weights": { "typecheck:fail": -2.1, "tests:pass": 0.9 }, "items": 120, "l2": 1 }
```

### Режими

| Режим | Відповідь під коментарем | Згортання |
| --- | --- | --- |
| `annotate` (за замовчуванням) | так | ні |
| `filter` | ні | так, для довіри нижче `min-trust` |
| `hybrid` | так | так, для довіри нижче `min-trust` |

- Згортання — це GraphQL `minimizeComment`, а **не видалення**: коментар можна розгорнути одним кліком.
  GitHub не має причини «низька якість», тому використовується `OFF_TOPIC`.
- За замовчуванням згортаються лише коментарі ботів (`minimize-sources: llm`). Коментарі людей
  лише отримують відповідь. `minimize-sources: all` згортає і їх.
- У режимі `filter` відповідей немає, тому ідемпотентність тримає один коментар-стан у PR
  (`<!-- review-evals-state -->`). Він показує, що згорнуто, і містить приховані дані про оцінені коментарі.
- Поріг `min-trust` за замовчуванням 0.3. З правилами це означає: згортаються лише рекомендації
  з вето або з кількома детермінованими провалами.

### Як працює запуск коду

1. Для коміту, до якого залишено коментар, створюється `git worktree` «до». Він один на коміт.
   Якщо коміту немає локально, Action робить `git fetch` цього коміту.
2. Для кожної рекомендації створюється окремий `git worktree` «після», і в ньому
   застосовується suggestion. Кінці рядків `\r\n` і фінальний перенос зберігаються.
3. В обидва worktree додається посилання на `node_modules` з основного checkout.
   Тому залежності треба встановити **до** кроку Review Evals.
   Команди отримують `pnpm_config_verify_deps_before_run=false`. Без цього pnpm 12 у worktree
   вирішує, що залежності застаріли, і перевстановлює їх **через посилання у спільний
   `node_modules`**, з шляхами до тимчасової теки. Після видалення worktree ці посилання стають
   битими. Додатковий захист: якщо після команди змінився `node_modules/.modules.yaml`,
   `.package-lock.json` чи `.yarn-state.yml`, усі наступні execution-перевірки дають `skip`.
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

Джерело: **LLM (`claude[bot]`)** · тег `bug`
Оцінка довіри: **0.11** — низька (правила)
Головні чинники: ✘ typecheck −3.00 · ✔ suggestion-present +0.30 · ✔ suggestion-applies +0.30

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
- Команди отримують env без токенів: Action прибирає `INPUT_*`, `ACTIONS_*`, `ANTHROPIC_*`,
  `GITHUB_TOKEN`, `GH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`. Ключ Anthropic передавайте **лише через input**
  `anthropic-api-key`, а не через `env:` job: тоді код PR не зможе його прочитати.
- `persist-credentials: false` у checkout не залишає токен у `.git/config`, який може прочитати код PR.
  Для `git fetch` Action передає токен окремо, через env процесу git.
- Секрети репозиторію не передавайте в цей workflow.

### Вхідні параметри

| Параметр            | За замовчуванням      | Опис |
| ------------------- | --------------------- | ---- |
| `github-token`      | `${{ github.token }}` | Токен для GitHub API. Потрібен дозвіл `pull-requests: write`. |
| `mode`              | `annotate`            | `annotate`, `filter` або `hybrid` (див. «Режими»). |
| `typecheck-command` | автоматично           | Команда перевірки типів. `off` вимикає. |
| `lint-command`      | автоматично           | Команда ESLint без аргументів, наприклад `pnpm exec eslint`. `off` вимикає. |
| `test-command`      | автоматично           | Команда тестів; `{files}` замінюється на змінені файли. `off` вимикає. |
| `timeout-seconds`   | `300`                 | Ліміт часу для однієї команди. |
| `allow-forks`       | `false`               | Запускати код із PR з форків. Небезпечно. |
| `anthropic-api-key` | порожньо              | Ключ Anthropic API. Без нього `llm-suggestion` і `llm-judge` дають `skip`. |
| `model`             | `claude-opus-5-5`     | Модель Claude для LLM-оцінювачів. |
| `aggregator`        | `auto`                | `auto`, `rules` або `logistic`. |
| `weights-file`      | порожньо              | Шлях до `weights.json` від кореня репозиторію. Порожньо — `weights.json` у репозиторії Action. |
| `min-trust`         | `0.3`                 | Поріг довіри для згортання в режимах `filter` і `hybrid`. |
| `minimize-sources`  | `llm`                 | `llm` — згортати лише коментарі ботів, `all` — усі. |

## Датасет для розмітки

Кожна відповідь Review Evals містить приховані дані: `<!-- review-evals-data {...} -->` з
рекомендацією і результатами всіх оцінювачів. CLI збирає їх у JSON для розмітки:

```bash
npm run cli -- export --repo Holodniak-Oleksii/Pampojo --pr 26 --pr 27 --out datasets/pampojo.json
```

Токен GitHub береться з `GITHUB_TOKEN`, `GH_TOKEN` або з `gh auth token`. Повторний експорт
додає нові рекомендації й оновлює результати, але **не стирає** вже поставлені мітки.
Формат і правила розмітки описано в [datasets/README.md](datasets/README.md).

Коли розмічено щонайменше 10 прикладів обох класів (`correct` і `incorrect`), можна навчити ваги:

```bash
npm run cli -- train --dataset datasets/pampojo.json --out weights.json
```

Це логістична регресія з L2-регуляризацією (`--l2`, за замовчуванням 1), градієнтний спуск без
сторонніх бібліотек. Команда друкує accuracy і log loss **на тих самих даних**, тобто завищені.
Чесні метрики з поділом на навчальну і тестову частини — етап 5. Щоб Action використовував ваги,
закомітьте `weights.json` у корінь цього репозиторію.

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
  enrichers/            llm-suggestion: текстовий коментар → зміна коду
  static/               витяг посилань з коментаря, TypeScript Compiler API
  model/                клієнт Claude API, фрагмент коду для промптів
  aggregate/            ознаки, правила, логістична регресія, навчання
  decision.ts, state.ts режими: відповідати чи згортати, стан PR для filter
  data.ts, dataset.ts   дані у відповіді, формат датасету
src/action/             онлайн-режим: тонкий шар над GitHub API
src/cli/                офлайн-режим: export і train (метрики — етап 5)
datasets/               розмічені датасети
test/                   тести vitest
docs/                   приклад workflow
dist/                   зібраний Action (комітиться)
```

## Наступні етапи

5. **Офлайн CLI-харнес.** Датасет JSON/YAML з мітками. Метрики Precision, Recall, F1,
   Accuracy, Brier Score, діаграма калібрування, ablation.
