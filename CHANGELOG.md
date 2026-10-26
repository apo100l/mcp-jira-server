# Changelog

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии следуют [Semantic Versioning](https://semver.org/lang/ru/).

## [Unreleased]

## [1.2.0] - 2026-09-28

### Added

- Режим `JIRA_AUTH_MODE=browser` с отдельным постоянным Chrome-профилем.
- Автоматическое получение свежих Jira cookies перед API-запросами.
- MCP-инструменты `jira_browser_login` и `jira_browser_auth_status`.
- Настройки профиля, канала Chrome, headless-режима и TTL проверки сессии.

## [1.1.0] - 2026-09-01

### Added

- Авторизация через браузерную Jira/SSO-сессию (`JIRA_COOKIE`).
- Настройка пользовательского `User-Agent`.
- Русская документация для Codex и Claude Desktop.
- Публикация пакета в npm под областью `@apo100l`.

### Changed

- MCP SDK и Axios обновлены до актуальных исправленных версий; `npm audit` не находит известных уязвимостей.

[Unreleased]: https://github.com/apo100l/mcp-jira-server/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/apo100l/mcp-jira-server/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/apo100l/mcp-jira-server/releases/tag/v1.1.0
