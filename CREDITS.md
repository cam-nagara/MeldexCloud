# Credits

Meldex はオープンソースのライブラリ・フォント・アイコンに支えられています。
`app/...` で始まるパスはリポジトリ内の場所です。配布物ではソース配布なら `app/` を除いた配布ルート配下、exe 配布なら主に `_internal/` 配下にも配置されます。

## Application

Meldex 本体は MIT License で提供されています。詳細は [LICENSE](LICENSE) を参照してください。

## Icons

### Lucide

Meldex の UI 全体で使用されているアイコンは [Lucide](https://lucide.dev/) です。ISC License のもとで利用しています。
一部の Lucide アイコンは Feather 由来で、Feather 側の MIT notice も保持しています。

### Tray Icons

`app/tray-icons/` 配下の PNG 画像（16個）は Lucide の SVG アイコンから変換生成したものです。
元の SVG は Lucide Contributors による ISC License で提供されています。

元ファイル一覧: calendar, camera, circle-x, clapperboard, database, file-text, folder-open, home, message-square, monitor, paintbrush, scissors, settings, sticky-note, triangle-alert, user

## Fonts

### Noto Sans JP

日本語デフォルトフォントとして [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP) を同梱しています。
SIL Open Font License 1.1 のもとで利用しています。

ライセンス本文: [app/fonts/OFL.txt](app/fonts/OFL.txt)

### Google Noto Emoji

スタンプ、コールアウト、ページアイコン、ユーザーアイコンのアイコン選択用として [Google Noto Emoji](https://github.com/googlefonts/noto-emoji) を同梱しています。
フォントは SIL Open Font License 1.1、SVG ソース由来データは Apache License 2.0 のもとで利用しています。

ライセンス本文:

- [app/fonts/NotoColorEmoji-OFL.txt](app/fonts/NotoColorEmoji-OFL.txt)
- [app/fonts/NotoEmoji-LICENSE.txt](app/fonts/NotoEmoji-LICENSE.txt)
- [app/fonts/NotoEmoji-SVG-APACHE-LICENSE.txt](app/fonts/NotoEmoji-SVG-APACHE-LICENSE.txt)

## Emoji Graphics

### Twemoji

旧チャットスタンプ素材として [Twemoji](https://github.com/twitter/twemoji) v14.0.2 のスプライトを同梱しています。

Twemoji by Twitter, Inc. and contributors, licensed under CC-BY 4.0.

ライセンス表記: [app/stamps/TWEMOJI-LICENSE.txt](app/stamps/TWEMOJI-LICENSE.txt)

## JavaScript Libraries

- [html2canvas](https://github.com/niklasvh/html2canvas) — MIT License
- [PDF.js](https://github.com/mozilla/pdf.js) — Apache License 2.0

## Python Libraries

必須/主要依存:

- [FastAPI](https://github.com/fastapi/fastapi) — MIT License
- [Starlette](https://github.com/encode/starlette) — BSD 3-Clause
- [Uvicorn](https://github.com/encode/uvicorn) — BSD 3-Clause
- [Pydantic](https://github.com/pydantic/pydantic) — MIT License
- [PyYAML](https://github.com/yaml/pyyaml) — MIT License
- [openpyxl](https://openpyxl.readthedocs.io/) — MIT License
- [python-docx](https://github.com/python-openxml/python-docx) — MIT License
- [Pillow](https://python-pillow.github.io/) — MIT-CMU
- [python-multipart](https://github.com/Kludex/python-multipart) — Apache License 2.0

任意機能/連携:

- [Anthropic Python SDK](https://github.com/anthropics/anthropic-sdk-python) — MIT License
- [OpenAI Python SDK](https://github.com/openai/openai-python) — Apache License 2.0
- [Google Gen AI SDK](https://github.com/googleapis/python-genai) — Apache License 2.0
- [Google API Python Client](https://github.com/googleapis/google-api-python-client) — Apache License 2.0
- [Notion SDK for Python](https://github.com/ramnes/notion-sdk-py) — MIT License
- [python-dotenv](https://github.com/theskumar/python-dotenv) — BSD 3-Clause
- [requests](https://requests.readthedocs.io/) — Apache License 2.0
- Radicale / icalendar / pystray / pynput / PyAutoGUI / pywebview / pywin32 / torch / transformers — 詳細は [THIRD-PARTY.md](THIRD-PARTY.md) を参照してください。

詳細な同梱形態と権利表記チェック結果は [THIRD-PARTY.md](THIRD-PARTY.md) を参照してください。
