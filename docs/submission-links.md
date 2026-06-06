# Ссылки для загрузки результата на платформу

Перед сдачей нужно заменить плейсхолдеры на реальные ссылки.

## Макеты

Figma: https://www.figma.com/design/GnJooVBRAqkXPla72dZiGL/vk-project?node-id=0-1&t=eb8g0nYV48JD1dkn-1

Miro: `TODO: вставить ссылку на Miro-доску после создания`

Для Miro подготовлен файл: `docs/miro-board.md`

## Репозиторий

GitHub/GitLab: `TODO: вставить ссылку на репозиторий после публикации`

Рекомендуемое имя репозитория: `vk-quizhub-mvp`

## Работоспособный продукт

Локально через Docker:

```bash
docker compose up --build -d
```

После запуска:

- Frontend: http://127.0.0.1:8080
- Healthcheck: http://127.0.0.1:8080/api/health

Перед демонстрацией нужно запустить Docker Desktop. Конфигурация `docker compose config` проверена; фактическая сборка выполняется командой выше.

Публичный деплой: `опционально`
