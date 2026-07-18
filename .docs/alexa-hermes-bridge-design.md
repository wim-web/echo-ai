# Alexa × Hermes 非同期音声アシスタント 設計

## 1. 目的

Amazon Echoから音声で依頼を受け付け、Alexaの応答制限内に受付を返しつつ、Hermesで長時間処理を実行する。

処理完了後は、Home Assistant経由で依頼元のEchoから結果を読み上げる。

---

## 2. 全体構成

```text
Amazon Echo
    ↓ 音声入力
Alexaクラウド
    ↓ HTTPS
Cloudflare Tunnel
    ↓
alexa-hermes-bridge :3000
    ├─ Alexaリクエスト検証
    ├─ ジョブ保存
    ├─ 即時受付応答
    └─ 非同期Worker
            ↓
      Hermes API :8642
            ↓
      Home Assistant API
            ↓
      Alexa Media Player
            ↓
      依頼元Echoで結果を読み上げ
```

### 採用構成

- Alexaカスタムスキル
- 既存Cloudflare Tunnel
- Node.js + TypeScript
- Express
- Alexa Skills Kit SDK
- SQLite
- Hermes API Server
- Home Assistant
- Alexa Media Player

### 不要なもの

- AWS Lambda
- API Gateway
- Redis
- RabbitMQ
- 外部DBサーバー

---

## 3. コンポーネント責務

### 3.1 Alexaカスタムスキル

Echoから発話を受け取り、公開HTTPSエンドポイントへ送信する。

主なIntent:

- `AskHermesIntent`
- `AMAZON.HelpIntent`
- `AMAZON.StopIntent`
- `AMAZON.CancelIntent`
- `AMAZON.FallbackIntent`

自由発話部分には `AMAZON.SearchQuery` を使用する。

---

### 3.2 Cloudflare Tunnel

AlexaクラウドからHermesサーバー上のブリッジへ到達させる。

公開対象:

```text
https://alexa.example.com/alexa
```

ローカル転送先:

```text
http://127.0.0.1:3000/alexa
```

Hermes API、Home Assistant API、SQLiteは外部公開しない。

設定例:

```yaml
ingress:
  - hostname: alexa.example.com
    path: ^/alexa$
    service: http://127.0.0.1:3000

  - service: http_status:404
```

Cloudflare Accessのログイン認証は `/alexa` に付けない。Alexaリクエストの正当性はブリッジ側で検証する。

---

### 3.3 Alexaブリッジ

Hermesサーバー上で常時起動する。

責務:

1. Alexaリクエストを受信
2. 署名、タイムスタンプ、Skill IDを検証
3. 発話内容、ユーザー、端末を抽出
4. SQLiteへジョブを保存
5. Alexaへ即時受付応答
6. Workerへ非同期処理を引き渡す
7. Hermesの回答を音声用に整形
8. Home Assistantへ読み上げ依頼

Alexaへの受付応答例:

```text
了解。終わったらこの端末で知らせます。
```

---

### 3.4 ジョブWorker

SQLiteから未処理ジョブを取得し、Hermesへ依頼する。

処理フロー:

```text
QUEUED
  ↓
RUNNING
  ├─→ COMPLETED
  │       ↓
  │    NOTIFIED
  └─→ FAILED
```

Workerは一定間隔で `QUEUED` を取得するか、ジョブ作成直後に内部キューへ通知する。

Hermesが一時停止しても依頼を消失させないため、ジョブを先にSQLiteへ保存する。

---

### 3.5 Hermesクライアント

Hermes API Serverをローカル接続で呼び出す。

接続先例:

```text
http://127.0.0.1:8642
```

認証:

```text
Authorization: Bearer ${HERMES_API_KEY}
```

会話・記憶のスコープ:

```text
X-Hermes-Session-Key:
agent:echo:alexa:<hashed-user-id>
```

Hermesへの指示例:

```text
Amazon Echoでの音声読み上げ用です。
日本語で結論から簡潔に回答してください。
表、Markdown、URL、コードブロックは使用しないでください。
読み上げは原則60秒以内にしてください。
長い調査結果は要点だけ回答してください。
```

---

### 3.6 音声整形

Hermesの出力をEcho向けに加工する。

処理内容:

- Markdown記号を除去
- コードブロックを省略
- URLを読み上げ対象から除外
- 表を文章へ変換
- 連続空白や改行を整理
- 読み上げ上限を超える場合は要約
- 長文全文はDBへ保存

目安:

```text
読み上げ: 300〜800文字
全文: SQLiteまたは別通知先へ保存
```

---

### 3.7 Home Assistant連携

Hermesの処理完了後、Home Assistant REST APIを呼び出す。

Home Assistant側ではAlexa Media Playerを使用し、対象EchoにannounceまたはTTSを送る。

概念例:

```yaml
action: notify.alexa_media
data:
  target:
    - media_player.living_room_echo
  message: "Hermesの回答"
  data:
    type: announce
```

---

## 4. Echo端末の特定

Alexaリクエストの `deviceId` とHome Assistantの `entity_id` を対応付ける。

設定例:

```yaml
devices:
  amzn1.ask.device.ABC123:
    entity_id: media_player.living_room_echo

  amzn1.ask.device.XYZ789:
    entity_id: media_player.bedroom_echo
```

初回登録方法:

1. 各Echoからスキルを起動
2. ブリッジのログで `deviceId` を確認
3. Home AssistantのEcho entityと手動で対応付け

会話メモリはAlexaの `userId` 単位、読み上げ先は `deviceId` 単位とする。

---

## 5. ディレクトリ構成

```text
alexa-hermes-bridge/
├── src/
│   ├── server.ts
│   ├── config.ts
│   ├── alexa/
│   │   ├── handlers.ts
│   │   ├── intents.ts
│   │   └── response.ts
│   ├── jobs/
│   │   ├── repository.ts
│   │   ├── service.ts
│   │   └── worker.ts
│   ├── hermes/
│   │   ├── client.ts
│   │   └── types.ts
│   ├── home-assistant/
│   │   ├── client.ts
│   │   └── types.ts
│   ├── speech/
│   │   └── formatter.ts
│   ├── devices/
│   │   └── repository.ts
│   └── logger.ts
├── data/
│   └── bridge.sqlite
├── config/
│   └── devices.yaml
├── tests/
├── .env
├── package.json
├── tsconfig.json
└── Dockerfile
```

---

## 6. SQLite設計

### jobs

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  alexa_request_id TEXT NOT NULL UNIQUE,
  alexa_user_id_hash TEXT NOT NULL,
  alexa_device_id TEXT NOT NULL,
  query TEXT NOT NULL,
  status TEXT NOT NULL,
  hermes_run_id TEXT,
  answer TEXT,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notified_at TEXT
);
```

ステータス:

```text
QUEUED
RUNNING
COMPLETED
NOTIFIED
FAILED
```

将来追加候補:

```text
WAITING_APPROVAL
CANCELLED
```

`alexa_request_id` をUNIQUEにして、Alexa側の再送による二重実行を防止する。

### device_mappings

```sql
CREATE TABLE device_mappings (
  alexa_device_id TEXT PRIMARY KEY,
  home_assistant_entity_id TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## 7. API設計

### POST /alexa

Alexaカスタムスキル専用エンドポイント。

処理:

1. Alexaリクエスト検証
2. Intent判定
3. 発話抽出
4. ジョブ登録
5. 受付応答

Hermesの完了は待たない。

### GET /health

ローカル監視用。

レスポンス例:

```json
{
  "status": "ok",
  "database": "ok",
  "hermes": "ok",
  "homeAssistant": "ok"
}
```

外部公開する場合は、詳細な内部情報を返さない。

### GET /jobs/:id

管理・デバッグ用。原則ローカル限定。

---

## 8. エラー処理

### Hermes失敗

- 最大2〜3回リトライ
- 指数バックオフ
- 最終失敗時は対象Echoへ短いエラー通知
- 詳細エラーはログとSQLiteへ保存

読み上げ例:

```text
処理に失敗しました。詳細はサーバーのログを確認してください。
```

### Home Assistant失敗

- 回答は `COMPLETED` のまま保持
- 読み上げだけ再試行
- 成功後に `NOTIFIED` へ変更

### Echo端末未登録

- デフォルトEchoへ送信
- またはジョブを `COMPLETED` のまま保持
- ログへ未登録 `deviceId` を出力

### プロセス再起動

起動時に以下を復旧する。

- `QUEUED` は再処理
- 長時間 `RUNNING` のジョブは状態確認または再キュー
- `COMPLETED` かつ未通知は読み上げ再試行

---

## 9. セキュリティ

### 外部公開

公開するのは以下のみ。

```text
POST /alexa
```

公開しないもの:

```text
Hermes API
Home Assistant API
SQLite
管理API
デバッグ画面
```

### Alexa検証

必須:

- Alexaリクエスト署名検証
- リクエスト時刻検証
- Skill ID一致確認
- リクエストIDによる重複防止

### 秘密情報

`.env` へ保存する。

```env
PORT=3000
ALEXA_SKILL_ID=...
HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=...
HOME_ASSISTANT_URL=http://127.0.0.1:8123
HOME_ASSISTANT_TOKEN=...
DATABASE_PATH=./data/bridge.sqlite
```

### Hermesの権限

Echo経由では最初は読み取り中心とする。

許可候補:

- Web検索
- 予定確認
- ファイル読み取り
- 状態確認
- 要約

初期状態では禁止または承認必須:

- ファイル削除
- メール送信
- Git push
- 購入、課金
- サービス停止
- 任意シェル実行
- 外部への投稿

---

## 10. ログ

構造化JSONログを推奨する。

記録項目:

- job_id
- alexa_request_id
- user_id_hash
- device_id末尾のみ
- status
- Hermes処理時間
- 読み上げ処理時間
- retry_count
- error_code

発話全文やHermesの回答全文は、通常ログへ出さない。

---

## 11. MVP実装順

### Phase 1

- Alexa `/alexa` エンドポイント
- リクエスト検証
- 固定応答
- Cloudflare Tunnel接続

### Phase 2

- SQLiteジョブ保存
- Worker
- Hermes API呼び出し
- 回答保存

### Phase 3

- Home Assistant連携
- 固定Echoへの読み上げ

### Phase 4

- `deviceId` とEcho entityの対応
- 依頼元Echoへの読み上げ
- エラーリトライ
- 再起動時のジョブ復旧

### Phase 5

- 長文要約
- 危険操作の承認フロー
- Discord等への全文通知
- 管理画面またはジョブ確認CLI

---

## 12. 最終構成

```text
既存cloudflared
既存Hermes API Server
alexa-hermes-bridge 1プロセス
SQLite 1ファイル
Home Assistant
Alexa Media Player
Alexaカスタムスキル
```

Alexaは受付だけを即時応答し、Hermesの実行時間と完全に切り離す。処理結果はHome Assistant経由で依頼元Echoから読み上げる。
