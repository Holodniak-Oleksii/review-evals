# datasets — розмічені датасети

Тут зберігаються датасети рекомендацій code review з мітками людини.
На етапі 5 офлайн-харнес порівнюватиме з цими мітками оцінку довіри і рахуватиме метрики.

## Як отримати датасет

```bash
npm run cli -- export --repo Holodniak-Oleksii/Pampojo --pr 26 --pr 27 --out datasets/pampojo.json
```

Команда читає review comments з PR. Для коментарів, під якими вже є відповідь Review Evals,
вона бере результати оцінювачів з прихованих даних у відповіді. Для інших коментарів `results` — `null`.

Повторний запуск з тим самим `--out` додає нові рекомендації та оновлює результати,
але залишає ваші `label` і `note` без змін.

## Формат

```json
{
  "version": 1,
  "items": [
    {
      "id": "Holodniak-Oleksii/Pampojo#27/4644023036",
      "repo": "Holodniak-Oleksii/Pampojo",
      "pullNumber": 27,
      "recommendation": {
        "id": "4644023036",
        "source": "llm",
        "author": "claude[bot]",
        "path": "src/server/db/utils.ts",
        "startLine": 7,
        "endLine": 7,
        "body": "[bug] `now()` returns the transaction start time…",
        "severity": "bug",
        "suggestion": "…",
        "suggestionOrigin": "comment",
        "commitId": "…",
        "url": "https://github.com/…"
      },
      "results": [
        { "grader": "typecheck", "status": "pass", "score": 1, "evidence": "…" }
      ],
      "label": null,
      "note": ""
    }
  ]
}
```

`recommendation` має тип `Recommendation` з `src/core/types.ts`, а `results` — масив `GradeResult`.

## Як розмічати

Заповніть `label` для кожного елемента:

| `label`     | Коли ставити |
| ----------- | ------------ |
| `correct`   | Проблема справжня, і рекомендація (або її suggestion) правильно її виправляє. |
| `incorrect` | Проблеми немає, або запропонована зміна хибна чи шкідлива. |
| `unclear`   | Без додаткового контексту вирішити не можна. |

У `note` коротко запишіть причину, особливо для `incorrect` і `unclear`.
Мітку ставте за кодом і коментарем, а **не** за результатами оцінювачів: інакше метрики
на етапі 5 будуть завищені.
