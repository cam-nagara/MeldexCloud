# Third-Party Notices

Meldex は以下のサードパーティ製ソフトウェア、フォント、アイコン、絵文字素材を利用しています。
本ファイルは、配布物に同梱する権利表記の棚卸しと参照先を兼ねます。
`app/...` で始まるパスはリポジトリ内の場所を示します。配布物ではソース配布なら `app/` を除いた配布ルート配下、exe 配布なら主に `_internal/` 配下にも配置されます。

## 表記場所チェック

| 対象 | ライセンス / 必要な表記 | 利用箇所 | ソース入手 URL | リンク/同梱区分 | 同梱要否 | 表記・同梱場所 | 状態 |
|---|---|---|---|---|---|---|---|
| Meldex 本体 | MIT License / Copyright (c) 2026 Meldex Contributors | アプリ本体 | https://github.com/cam-nagara/Meldex | アプリ本体 | 必須 | `LICENSE`, About, 配布ルート | 表記済み |
| Lucide Icons | ISC License。Feather 由来アイコンは MIT notice も保持 | UIアイコン、`app/vendor/lucide-icons.js`, トレイPNG | https://github.com/lucide-icons/lucide | JS/PNG同梱 | 必須 | `THIRD-PARTY.md`, `CREDITS.md`, About | 表記済み |
| Google Noto Sans JP | SIL Open Font License 1.1 | 既定UIフォント | https://github.com/notofonts/noto-cjk | WOFF2同梱 | 必須 | `app/fonts/OFL.txt`, `THIRD-PARTY.md`, `CREDITS.md`, About | 表記済み |
| Google Noto Emoji | フォントは SIL Open Font License 1.1 / SVGソースは Apache License 2.0 | スタンプ、コールアウト、ユーザーアイコン等の絵文字選択 | https://github.com/googlefonts/noto-emoji | TTF/データ同梱 | 必須 | `app/fonts/NotoEmoji-LICENSE.txt`, `app/fonts/NotoColorEmoji-OFL.txt`, `app/fonts/NotoEmoji-SVG-APACHE-LICENSE.txt`, `THIRD-PARTY.md`, `CREDITS.md`, About | 表記済み |
| Twemoji | グラフィック CC-BY 4.0 / コード MIT | 旧チャットスタンプ互換スプライト | https://github.com/twitter/twemoji | SVGスプライト同梱 | 必須 | `app/stamps/TWEMOJI-LICENSE.txt`, `THIRD-PARTY.md`, `CREDITS.md`, About | 表記済み |
| html2canvas | MIT License | 画像書き出しフォールバック | https://github.com/niklasvh/html2canvas | JS同梱 | 必須 | `app/vendor/html2canvas.min.js` header, `THIRD-PARTY.md`, `CREDITS.md`, About | 表記済み |
| PDF.js | Apache License 2.0 / NOTICE retention | PDFビューア | https://github.com/mozilla/pdf.js | JS/worker同梱 | 必須 | `app/vendor/pdfjs/LICENSE`, `app/vendor/pdfjs/NOTICE`, `THIRD-PARTY.md`, `CREDITS.md`, About | 表記済み |
| Radicale | GPLv3 | ローカル CalDAV サーバー | https://github.com/Kozea/Radicale | Pythonパッケージ同梱時はGPL対象 | ビルド環境に存在し exe に含まれる場合のみ必須 | package内または `*.dist-info` の LICENSE/COPYING、`THIRD-PARTY.md`, About | 検証対象 |
| pystray | LGPLv3 | 常駐トレイ | https://github.com/moses-palmer/pystray | Pythonパッケージ同梱時は動的利用相当 | ビルド環境に存在し exe に含まれる場合のみ必須 | package内または `*.dist-info` の LICENSE/COPYING、`THIRD-PARTY.md`, About | 検証対象 |
| pynput | LGPLv3 | ホットキー | https://github.com/moses-palmer/pynput | Pythonパッケージ同梱時は動的利用相当 | ビルド環境に存在し exe に含まれる場合のみ必須 | package内または `*.dist-info` の LICENSE/COPYING、`THIRD-PARTY.md`, About | 検証対象 |
| Python 必須/主要依存 | 各パッケージのライセンス表記 | APIサーバー、ファイル入出力、画像処理 | 各パッケージ公式リポジトリ / PyPI | Pythonパッケージ | 必須 | `THIRD-PARTY.md`, `CREDITS.md`, About | 表記済み |
| Python 任意機能依存 | 各パッケージのライセンス表記。ビルド環境に存在する場合のみ exe に同梱されるものを含む | LLM、Notion、CalDAV、常駐、ネイティブウィンドウ | 各パッケージ公式リポジトリ / PyPI | Pythonパッケージ | 同梱時のみ必須 | `THIRD-PARTY.md`, `CREDITS.md` | 表記済み |

## JavaScript ライブラリ

### Lucide Icons

- **ライセンス**: ISC License
- **出典**: https://github.com/lucide-icons/lucide
- **用途**: UI全体のアイコン、コールアウト/スタンプ/ユーザーアイコン等の選択肢
- **同梱形態**: `app/vendor/lucide-icons.js` および `app/meldex-core.part01.js` のアイコン定義
- **派生物**: `app/tray-icons/` の PNG は Lucide SVG から変換生成

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### html2canvas

- **バージョン**: 1.4.1
- **ライセンス**: MIT License
- **出典**: https://github.com/niklasvh/html2canvas
- **用途**: ビューのPNG書き出し（フォールバック）
- **同梱形態**: `app/vendor/html2canvas.min.js`
- **著作権表示**: Copyright (c) 2012 Niklas von Hertzen

### PDF.js (pdf.js)

- **バージョン**: 4.4.168
- **ライセンス**: Apache License 2.0
- **出典**: https://github.com/mozilla/pdf.js
- **用途**: PDFビューア
- **同梱形態**: `app/vendor/pdfjs/`
- **ライセンス全文**: `app/vendor/pdfjs/LICENSE`
- **NOTICE**: `app/vendor/pdfjs/NOTICE`

## Emoji Graphics

### Twemoji

- **バージョン**: 14.0.2（Twitter/Twemoji 本家の最終リリース）
- **ライセンス**: グラフィック CC-BY 4.0 / コード MIT
- **出典**: https://github.com/twitter/twemoji
- **用途**: 旧チャットスタンプ素材の互換保持
- **同梱形態**: `app/stamps/twemoji-sprite.svg`
- **ライセンス表記**: `app/stamps/TWEMOJI-LICENSE.txt`
- **帰属表示**: Twemoji by Twitter, Inc. and contributors, licensed under CC-BY 4.0.

## フォント

### Noto Sans JP

- **ライセンス**: SIL Open Font License 1.1
- **出典**: Google Fonts / Noto Fonts
- **用途**: Meldex の既定 UI フォント
- **同梱形態**: `app/fonts/NotoSansJP-{Regular,Medium,Bold}.woff2`
- **ライセンス全文**: `app/fonts/OFL.txt`

### Google Noto Emoji

- **ライセンス**: フォントは SIL Open Font License 1.1 / SVGソースは Apache License 2.0
- **出典**: https://github.com/googlefonts/noto-emoji
- **用途**: チャットスタンプ、コールアウト、ページアイコン、ユーザーアイコンのアイコン選択
- **同梱形態**: `app/fonts/NotoColorEmoji_WindowsCompatible.ttf`, `app/noto-emoji-data.js`
- **ライセンス全文**: `app/fonts/NotoEmoji-LICENSE.txt`, `app/fonts/NotoColorEmoji-OFL.txt`, `app/fonts/NotoEmoji-SVG-APACHE-LICENSE.txt`
- **確認事項**: `NotoColorEmoji_WindowsCompatible.ttf` は Google Noto Emoji 公式リポジトリの同名ファイルと SHA-256 が一致する未改変ファイルです。

## Python 必須/主要依存パッケージ

Meldex バックエンドと同梱サイドカーは、以下の必須/主要依存を利用します。exe 配布では PyInstaller がこれらと推移依存を同梱します。

| パッケージ | ライセンス | 用途 / 関係 |
|---|---|---|
| FastAPI | MIT | APIフレームワーク |
| Starlette | BSD 3-Clause | FastAPI の ASGI 基盤 |
| Uvicorn | BSD 3-Clause | ASGIサーバー |
| Pydantic | MIT | データバリデーション |
| PyYAML | MIT | フロントマター解析 |
| openpyxl | MIT | Excel 読み書き |
| python-docx | MIT | Word 読み書き |
| Pillow | MIT-CMU | 画像処理 |
| python-multipart | Apache License 2.0 | ファイルアップロード/フォーム処理 |
| anyio | MIT | ASGI 非同期処理の推移依存 |
| click | BSD 3-Clause | Uvicorn CLI の推移依存 |
| colorama | BSD 3-Clause | Uvicorn CLI の推移依存 |
| h11 | MIT | HTTP/1.1 実装の推移依存 |
| idna | BSD 3-Clause | anyio の推移依存 |
| lxml | BSD 3-Clause | python-docx の推移依存 |
| pydantic-core | MIT | Pydantic の推移依存 |
| sniffio | MIT OR Apache License 2.0 | anyio の推移依存 |
| typing-extensions | PSF-2.0 | 型補助の推移依存 |

## フォント再配布許諾の確認（2026-04-29）

- 参照元: Noto 公式ドキュメント `https://notofonts.github.io/noto-docs/website/use/`、Noto Emoji 公式リポジトリ `https://github.com/googlefonts/noto-emoji`。
- `app/fonts/NotoSansJP-{Regular,Medium,Bold}.woff2` は `app/fonts/OFL.txt` と同梱し、SIL Open Font License 1.1 に基づいて再配布する。
- `app/fonts/NotoColorEmoji_WindowsCompatible.ttf` は `app/fonts/NotoColorEmoji-OFL.txt` と同梱し、SIL Open Font License 1.1 に基づいて再配布する。
- `app/noto-emoji-data.js` は Noto Emoji SVG ソース由来データを含むため、`app/fonts/NotoEmoji-SVG-APACHE-LICENSE.txt` を保持する。
- 配布ビルドでは `app/build.py` と `app/build_exe.py` が `fonts/` を配布物にコピーするため、フォント本体とライセンス本文が同時に同梱される。

## Python 任意機能依存パッケージ

以下は、拡張機能、連携機能、常駐、または LLM プロバイダで使われます。ソース配布ではユーザー環境に導入された場合のみ利用され、exe ビルドでは `app/build_exe.py` がビルド環境に存在する一部 SDK を同梱対象にします。

| パッケージ | ライセンス | 用途 | ソース入手 URL | 同梱要否 |
|---|---|---|---|---|
| anthropic | MIT | Claude/Anthropic LLM 連携 | https://github.com/anthropics/anthropic-sdk-python | ビルド環境に存在し exe に含まれる場合 |
| openai | Apache License 2.0 | OpenAI LLM 連携 | https://github.com/openai/openai-python | ビルド環境に存在し exe に含まれる場合 |
| google-genai | Apache License 2.0 | Google Gemini 連携 | https://github.com/googleapis/python-genai | ビルド環境に存在し exe に含まれる場合 |
| google-generativeai | Apache License 2.0 | 旧 Google Gemini SDK 互換 | https://github.com/google-gemini/generative-ai-python | ビルド環境に存在し exe に含まれる場合 |
| google-api-python-client | Apache License 2.0 | Google Calendar 等の API 連携 | https://github.com/googleapis/google-api-python-client | ビルド環境に存在し exe に含まれる場合 |
| google-auth | Apache License 2.0 | Google API 認証 | https://github.com/googleapis/google-auth-library-python | ビルド環境に存在し exe に含まれる場合 |
| google-auth-oauthlib | Apache License 2.0 | Google OAuth | https://github.com/googleapis/google-auth-library-python-oauthlib | ビルド環境に存在し exe に含まれる場合 |
| google-auth-httplib2 | Apache License 2.0 | Google API HTTP transport | https://github.com/googleapis/google-auth-library-python-httplib2 | ビルド環境に存在し exe に含まれる場合 |
| notion-client | MIT | Notion 同期 | https://github.com/ramnes/notion-sdk-py | ビルド環境に存在し exe に含まれる場合 |
| python-dotenv | BSD 3-Clause | Notion/チャット設定の `.env` 読み込み | https://github.com/theskumar/python-dotenv | ビルド環境に存在し exe に含まれる場合 |
| requests | Apache License 2.0 | トレイ/デバッグ連携 HTTP クライアント | https://github.com/psf/requests | ビルド環境に存在し exe に含まれる場合 |
| Radicale | GPLv3 | ローカル CalDAV サーバー | https://github.com/Kozea/Radicale | 同梱時は LICENSE/COPYING 必須、自動検証対象 |
| icalendar | BSD 3-Clause | iCalendar 形式の読み書き | https://github.com/collective/icalendar | ビルド環境に存在し exe に含まれる場合 |
| pystray | LGPLv3 | 常駐トレイ | https://github.com/moses-palmer/pystray | 同梱時は LICENSE/COPYING 必須、自動検証対象 |
| pynput | LGPLv3 | ホットキー | https://github.com/moses-palmer/pynput | 同梱時は LICENSE/COPYING 必須、自動検証対象 |
| PyAutoGUI | BSD | 旧アクション/RPA互換の任意依存。現行ベータ配布では RPA UI は削除済み | https://github.com/asweigart/pyautogui | ビルド環境に存在し exe に含まれる場合 |
| pywebview | BSD 3-Clause | ネイティブウィンドウ表示 | https://github.com/r0x0r/pywebview | ビルド環境に存在し exe に含まれる場合 |
| pywin32 | PSF License | Windows クリップボード連携 | https://github.com/mhammond/pywin32 | ビルド環境に存在し exe に含まれる場合 |
| torch / torchvision | BSD-style | CLIP 画像機能の任意依存 | https://github.com/pytorch/pytorch / https://github.com/pytorch/vision | ビルド環境に存在し exe に含まれる場合 |
| transformers | Apache License 2.0 | CLIP 画像機能の任意依存 | https://github.com/huggingface/transformers | ビルド環境に存在し exe に含まれる場合 |

任意依存を実際に同梱する配布物では、各パッケージに含まれる `dist-info` メタデータおよびライセンスファイルも保持してください。
特に Radicale は GPLv3、pystray / pynput は LGPLv3 です。これらを exe に同梱する場合は、ライセンス本文と対応するソース入手方法を配布物内または同梱ドキュメントで確認できる状態にしてください。`app/meldex_build_legal_check.py` はビルド後に、該当パッケージが含まれている場合の LICENSE/COPYING/NOTICE と上記ソース URL の存在を自動確認します。
