# Veronika Salon API

## Переменные окружения в ONREZA

- `DATABASE_URL` — строка подключения PostgreSQL из панели ONREZA. Не публикуйте её в GitHub.
- `ADMIN_TOKEN` — секрет администратора длиной не менее 24 символов.
- `CLIENT_ORIGIN` — полный origin опубликованного сайта, например `https://example.com` (без пути). Можно указать несколько origin через запятую.

## Подключение сайта

В `index.html` задайте `window.VERONIKA_API_URL` равным публичному URL сервиса API ONREZA, например `https://your-api-host.example`, без завершающего слэша. Сайт остаётся на отдельном хостинге; API и PostgreSQL работают в ONREZA.

## Проверка

После деплоя откройте `https://ВАШ-АДРЕС-API/api/health`. Ответ при рабочей базе: `{"status":"ok","service":"veronika-api"}`.

Админ-панель: `https://ВАШ-АДРЕС-API/admin`. Введите значение `ADMIN_TOKEN` из переменных окружения ONREZA.
