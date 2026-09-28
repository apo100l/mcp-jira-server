# MCP Jira Server

MCP-сервер для работы с self-hosted Jira через Model Context Protocol. Поддерживает три способа авторизации:

- Personal Access Token (`JIRA_PAT`);
- вручную переданный cookie (`JIRA_COOKIE`);
- автоматически поддерживаемая Jira/SSO-сессия в отдельном Chrome-профиле (`JIRA_AUTH_MODE=browser`).

Браузерный режим рекомендуется для корпоративных Jira, где создание PAT отключено, а доступ выполняется через SSO. Пользователь входит один раз в отдельном окне Chrome; профиль сохраняет и обновляет cookies между запусками MCP.

## Возможности

- просмотр задач, проектов, типов задач и комментариев;
- поиск задач через JQL;
- создание и обновление задач;
- назначение исполнителей и смена статуса;
- добавление комментариев;
- удаление задач;
- получение текущего пользователя.

Сервер обращается к Jira REST API v2: `<JIRA_BASE_URL>/rest/api/2`.

## Требования

- Node.js 18 или новее;
- доступ к self-hosted Jira;
- PAT, cookie либо возможность войти в Jira через Chrome.

## Установка

Из npm:

```bash
npm install --global @apo100l/mcp-jira-server
```

Либо запуск без глобальной установки:

```bash
npx --yes @apo100l/mcp-jira-server
```

Имя без области `mcp-jira-server` в npm принадлежит исходному проекту, поэтому эта версия публикуется как `@apo100l/mcp-jira-server`.

Из исходников:

```bash
git clone git@github.com:apo100l/mcp-jira-server.git
cd mcp-jira-server
npm install
npm run build
```

Собранная точка входа: `build/index.js`.

## Переменные окружения

| Переменная | Обязательность | Описание |
| --- | --- | --- |
| `JIRA_BASE_URL` | Да | Базовый URL Jira без `/rest/api/2`, например `https://jira.example.com` |
| `JIRA_AUTH_MODE` | Нет | Установите `browser`, чтобы автоматически получать cookies из постоянного Chrome-профиля |
| `JIRA_BROWSER_PROFILE` | Нет | Каталог отдельного Chrome-профиля; по умолчанию `~/.mcp-jira-server/chrome-profile` |
| `JIRA_BROWSER_CHANNEL` | Нет | Канал Playwright; по умолчанию `chrome` |
| `JIRA_BROWSER_HEADLESS` | Нет | `true` для фонового Chrome после первоначального входа; по умолчанию `false` |
| `JIRA_BROWSER_VALIDATION_TTL_SECONDS` | Нет | Период повторной проверки Jira-сессии; по умолчанию 60 секунд |
| `JIRA_COOKIE` | Один из способов авторизации | Полное значение HTTP-заголовка `Cookie` из авторизованной браузерной сессии |
| `JIRA_PAT` | Один из способов авторизации | Personal Access Token; используется, только если `JIRA_COOKIE` не задан |
| `JIRA_USER_AGENT` | Нет | Пользовательский `User-Agent`, если reverse proxy или SSO фильтрует запросы |

Для cookie-аутентификации сервер также отправляет `X-Atlassian-Token: no-check`, необходимый некоторым Jira-инсталляциям для изменяющих запросов.

## Настройка Codex

Добавьте сервер в `~/.codex/config.toml`:

Рекомендуемая настройка с автоматической браузерной сессией:

```toml
[mcp_servers.jira]
enabled = true
command = "node"
args = ["/absolute/path/to/mcp-jira-server/build/index.js"]

[mcp_servers.jira.env]
JIRA_BASE_URL = "https://jira.example.com"
JIRA_AUTH_MODE = "browser"
JIRA_BROWSER_PROFILE = "/absolute/private/path/jira-chrome-profile"
JIRA_BROWSER_CHANNEL = "chrome"
```

При первом обращении к Jira MCP откроет отдельное окно Chrome. Войдите в Jira через SSO и повторите запрос. Cookie сохранится в `JIRA_BROWSER_PROFILE`; копировать его в `config.toml` не требуется.

Настройка с cookie, переданным вручную:

```toml
[mcp_servers.jira]
enabled = true
command = "node"
args = ["/absolute/path/to/mcp-jira-server/build/index.js"]

[mcp_servers.jira.env]
JIRA_BASE_URL = "https://jira.example.com"
JIRA_COOKIE = 'JSESSIONID=...; another_cookie=...'
JIRA_USER_AGENT = "Mozilla/5.0"
```

Для PAT укажите:

```toml
JIRA_PAT = "your-personal-access-token"
```

После изменения конфигурации полностью перезапустите Codex, чтобы MCP-процесс получил новые переменные окружения.

## Автоматическая браузерная авторизация

Доступны два служебных инструмента:

- `jira_browser_login` — открывает Jira в отдельном постоянном Chrome-профиле;
- `jira_browser_auth_status` — проверяет, авторизован ли профиль.

Перед каждым Jira-запросом сервер получает актуальные cookies из профиля. Проверка `/rest/api/2/myself` выполняется не чаще заданного TTL. Если SSO-сессия истекла, сервер открывает Jira и просит повторно войти.

Не указывайте каталог основного профиля Chrome. Современный Chrome ограничивает автоматизацию основного профиля; отдельный каталог также уменьшает последствия компрометации MCP-процесса.

Папка профиля содержит секреты сессии. Не храните её внутри Git-репозитория и ограничьте к ней доступ на уровне ОС.

## Как получить cookie вручную

1. Авторизуйтесь в Jira в браузере.
2. Откройте Developer Tools → **Network**.
3. Перезагрузите страницу Jira.
4. Выберите запрос к Jira и откройте **Request Headers**.
5. Скопируйте полное значение заголовка `Cookie`, включая все пары `name=value`, разделённые `;`.
6. Поместите значение в `JIRA_COOKIE`.

Cookie является полноценным секретом доступа. Не публикуйте его, не добавляйте в Git и не отправляйте в сообщения. После завершения браузерной/SSO-сессии значение потребуется обновить.

## Настройка Claude Desktop

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-jira-server/build/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://jira.example.com",
        "JIRA_AUTH_MODE": "browser",
        "JIRA_BROWSER_PROFILE": "/absolute/private/path/jira-chrome-profile",
        "JIRA_BROWSER_CHANNEL": "chrome"
      }
    }
  }
}
```

## Доступные MCP-инструменты

| Инструмент | Назначение |
| --- | --- |
| `jira_browser_login` | Открытие постоянного Chrome-профиля для входа через SSO |
| `jira_browser_auth_status` | Проверка браузерной Jira-сессии |
| `jira_get_current_user` | Текущий авторизованный пользователь |
| `jira_get_issue` | Получение задачи по ключу |
| `jira_search_issues` | Поиск задач через JQL |
| `jira_create_issue` | Создание задачи |
| `jira_update_issue` | Обновление полей и смена статуса |
| `jira_add_comment` | Добавление комментария |
| `jira_get_comments` | Получение комментариев |
| `jira_get_projects` | Список доступных проектов |
| `jira_get_project` | Информация о проекте |
| `jira_get_issue_types` | Типы задач проекта |
| `jira_assign_issue` | Назначение исполнителя |
| `jira_delete_issue` | Безвозвратное удаление задачи |

## Проверка

После подключения начните с безопасных операций чтения:

1. вызовите `jira_get_current_user`;
2. вызовите `jira_get_projects`;
3. получите тестовую задачу через `jira_get_issue`.

Типичные ответы при ошибке авторизации:

- `401 Unauthorized` — cookie/PAT отсутствует, истёк или не принимается Jira;
- `404 Not Found` — обычно неверный `JIRA_BASE_URL`, старый MCP-процесс либо маршрут скрывается SSO/reverse proxy;
- HTML вместо JSON или редирект на страницу входа — браузерная сессия не прошла через SSO-прокси.

## Разработка

```bash
npm run build
npm run dev
```

## Версионирование и публикация

Проект использует Semantic Versioning: `patch` для исправлений, `minor` для обратно совместимых возможностей и `major` для несовместимых изменений.

Обновите `CHANGELOG.md`, затем создайте новую версию и тег одной из команд:

```bash
npm run release:patch
# npm run release:minor
# npm run release:major
git push origin main --follow-tags
```

Тег `vX.Y.Z` запускает GitHub Actions, который проверяет проект и публикует пакет в npm. Для автоматического выпуска добавьте секрет репозитория `NPM_TOKEN`, ограниченный пакетом `@apo100l/mcp-jira-server` и правом публикации.

Не добавляйте секреты в исходники. Для локальной разработки передавайте их только через переменные окружения или конфигурацию MCP-клиента.

## Происхождение и лицензия

Проект основан на [edrich13/mcp-jira-server](https://github.com/edrich13/mcp-jira-server) и расширен поддержкой Jira/SSO cookie-аутентификации.

Лицензия: MIT.
