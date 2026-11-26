# VRM Desktop

Desktop-приложение с 3D-персонажем, чатом, локальной моделью и OpenAI-совместимым API.

## Каналы

- **Dev**: `com.ruwee.vrmapp`, порт Vite `1420`, команда `npm run tauri dev`.
- **Pre-Release**: `com.ruwee.vrmapp.prerelease`, порт Vite `1421`, product `VRM Pre-Release`.

Pre-релиз поставляется с bundled-персонажем Suzumiya Haruhi и не содержит личных данных.

## Разработка

```bash
npm install
npm run tauri dev
```

Для локального раннера в dev можно задать путь через `.env.local` (файл игнорируется git):

```bash
VITE_DEV_RUNNER_PATH=/path/to/llama-server
```

## Обновления

Обновления включены только в pre-release. Приложение автоматически проверяет endpoint GitHub Releases и показывает красную точку на иконке настроек, если доступна новая версия. Вручную обновление можно проверить в `Общее` → `Обновления`.

Endpoint: `https://github.com/ruwee-g/vrm/releases/latest/download/latest.json`.

### Ключ подписи

Публичный ключ записан в `src-tauri/tauri.prerelease.conf.json`. Приватный ключ не попадает в репозиторий.

Создать ключ:

```bash
npx tauri signer generate -w ~/.tauri/vrm-pre-release.key --password '' --ci
```

Собрать подписанный pre-release:

```bash
TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/vrm-pre-release.key" npm run tauri:build:pre
```

### Публикация

После сборки:

```bash
npm run release:pre -- "Короткие заметки релиза"
```

Скрипт создаст `latest.json` рядом с бандлами. С созданием GitHub Release:

```bash
npm run release:pre -- --create "Короткие заметки релиза"
```

Релиз создаётся обычным, без флага `prerelease`, чтобы работал `/releases/latest`.

## Проверки

```bash
npx tsc --noEmit
npm run build
cargo check
cargo check --features prerelease
```

Использование сторонних анимаций описано в `public/animations/CREDITS.txt`.
