# Netflix Watcher Bot

Get Freax（`net-frx.com`）の「Netflix新着作品」一覧ページを監視し、新着作品をDiscordへ通知するBotです。

- 監視対象: https://www.net-frx.com/p/netflix-new-arrivals.html
- 通知先: Discord（Webhook）
- 実行環境: GitHub Actions（サーバー不要）
- 起動トリガー: cron-job.org（GitHub純正の`schedule`は使いません。時刻精度が甘いためです）

---

## 1. 全体の仕組み（なぜHTMLを直接見ないのか）

対象ページの作品一覧は、ページのHTMLそのものには含まれていません。ページ内のJavaScriptが、裏で以下のBlogger標準フィードAPIを取得して一覧を組み立てています。

```
https://www.net-frx.com/feeds/posts/default?alt=json&max-results=300&orderby=updated
```

このBotは同じフィードを直接取得します。理由は次のとおりです。

- HTMLのレイアウト変更に影響されず、壊れにくい
- 取得が軽量（JSONのみ、画像やスクリプトを読み込まない）
- `orderby=updated`を指定することで、**過去日付でのバックデート投稿や後からの編集**も、実際に更新された順として確実に上位（＝取得範囲内）に来る

`max-results=300` としているのは、1日30件の更新が1週間続いても（約210件）取りこぼさないよう余裕を持たせた件数です。

---

## 2. 処理の流れ（1回の実行）

1. フィードを取得・パースする
2. `data/state.json` を読み込む
3. まだ見たことのないIDを新着として「送信待ちキュー（pendingQueue）」に追加する
   - 一度で全部送らず、**先頭から最大10件だけ**をDiscordに送る（Discordの1メッセージあたりEmbed上限が10件のため）
   - 送りきれなかった分は`pendingQueue`に残り、**消えることなく次回以降に持ち越されます**
4. 送信に成功した分だけを`pendingQueue`から取り除き、「既読(seenIds)」に登録する
5. `data/state.json` を保存し、GitHub Actionsがそのままリポジトリへコミット・pushする

これにより、一度に40件・50件と大量投稿された場合でも、1回の実行では10件しか通知されませんが、**残りは次回（1時間後）以降に順番に通知され、失われることはありません**。

---

## 3. ファイル構成

```
netflix-watcher/
├─ .github/workflows/dispatch.yml   … GitHub Actionsの定義（外部トリガー専用）
├─ src/
│  ├─ index.js               … エントリーポイント（init/test/runの振り分け）
│  ├─ fetchFeed.js           … フィード取得＆パース
│  ├─ diffEngine.js          … 新着判定・送信キュー管理
│  ├─ discordNotifier.js     … Discordへの通知・エラー送信
│  ├─ stateManager.js        … state.jsonの読み書き
│  └─ logger.js              … 構造化ログ出力
├─ data/state.json           … 永続化される状態（Actionsが自動コミット）
├─ package.json
├─ .env.example              … ローカル実行時の環境変数サンプル
└─ README.md                 … このファイル
```

---

## 4. state.json の中身

```json
{
  "version": 1,
  "lastCheckedAt": "2026-09-16T21:00:00.000Z",
  "seenIds": ["tag:blogger.com,1999:blog-xxxx.post-yyyy", "..."],
  "pendingQueue": [
    {
      "id": "tag:blogger.com,1999:blog-xxxx.post-zzzz",
      "title": "作品タイトル",
      "image": "https://blogger.googleusercontent.com/.../xxx.jpg",
      "detectedAt": "2026-09-16T20:00:00.000Z"
    }
  ]
}
```

- `seenIds`: 通知済み・既読登録済みのID一覧。直近**1500件**まで保持し、超えた分は古い順に間引かれます。
- `pendingQueue`: 検知したがまだDiscordに送っていないアイテム。**上限はなく、全件保持されます**（Discordへの送信は毎回先頭10件までですが、キュー自体は減るまで保持され続けます）。

---

## 5. セットアップ手順

### 5-1. Discord Webhookを作る

1. Discordのチャンネル設定 →「連携サービス」→「ウェブフックを作成」
2. 表示されたWebhook URLをコピーしておく（後で使います）

### 5-2. GitHubリポジトリを作る

1. 本一式のファイルをそのままリポジトリにpushする
2. リポジトリの `Settings > Secrets and variables > Actions > New repository secret` で以下を登録する

   | Name | Value |
   |---|---|
   | `DISCORD_WEBHOOK_URL` | 5-1でコピーしたWebhook URL |

   ※ 通知用・エラー用ともにこの1本のWebhookを共通で使います。

3. `Settings > Actions > General > Workflow permissions` で **「Read and write permissions」** を選択して保存する（`data/state.json`をActionsが自動コミットするために必要です）

### 5-3. GitHubのPersonal Access Token（PAT）を発行する（cron-job.orgから叩くため）

1. GitHubの自分のアイコン → `Settings > Developer settings > Personal access tokens > Tokens (classic)`
2. `Generate new token (classic)` を選択
3. スコープは **`repo`** と **`workflow`** にチェックを入れる（細かい権限設定は行わず、シンプルなクラシックトークンでOKという前提です）
4. 有効期限はお好みで（`No expiration`でも構いません）
5. 発行されたトークンをコピーしておく（**このトークンはリポジトリには一切書き込まず、次のcron-job.orgの設定にのみ使います**）

### 5-4. cron-job.orgの設定

1. https://cron-job.org でアカウントを作成し、新しいCronジョブを作成
2. 以下のとおり設定する

   | 項目 | 値 |
   |---|---|
   | URL | `https://api.github.com/repos/<あなたのユーザー名>/<リポジトリ名>/actions/workflows/dispatch.yml/dispatches` |
   | Method | `POST` |
   | Schedule | 毎時0分（1時間ごと） |

3. Headersに以下を追加

   | Header名 | 値 |
   |---|---|
   | `Authorization` | `Bearer <5-3で発行したPAT>` |
   | `Accept` | `application/vnd.github+json` |
   | `Content-Type` | `application/json` |

4. Request Body（Payload）に以下を設定

   ```json
   { "ref": "main", "inputs": { "mode": "run" } }
   ```

   ※ ブランチ名が`main`でない場合は合わせて変更してください。

5. 保存すれば、以降は毎時0分に自動でGitHub Actionsが起動し、`mode=run`で監視が実行されます。

---

## 6. 3つのモードの使い方

初回導入時や動作確認時は、cron-job.orgの同じジョブの`inputs.mode`を書き換えて手動テストするか、GitHubの `Actions` タブから該当ワークフローを選んで `Run workflow` ボタンで手動実行し、`mode`のプルダウンから選択してください。

| mode | 説明 | state.jsonへの影響 |
|---|---|---|
| `init` | **初回セットアップ用**。フィードにある全作品を「既読」として登録する。導入前の作品が誤って一斉通知されるのを防ぐ。 | `seenIds`に全件登録、`pendingQueue`は空にする |
| `test` | **動作確認用**。フィードの先頭（最新）1件だけを試験的にDiscordへ通知する（タイトル頭に`[TEST]`が付く）。 | **変更なし**（何度実行しても安全） |
| `run` | **本番用（常時これを使う）**。新着を検知し、最大10件をDiscordへ通知する。 | `seenIds`/`pendingQueue`を更新してコミットする |

### 導入時のおすすめの手順

1. まず `mode=init` を1回実行し、既存作品をすべて既読化する
2. 次に `mode=test` を実行し、Discordに正しく通知が飛ぶか確認する
3. 問題なければ、cron-job.orgのスケジュール実行（`mode=run`、毎時0分）を有効にする

---

## 7. エラー時の挙動（構造が壊れた場合）

対象サイトのフィード構造が変わってパースに失敗した場合など、想定外のエラーが起きると：

1. どの処理段階（`fetch`＝取得 / `parse`＝解析 / `diff`＝差分判定 / `notify`＝通知 / `state`＝保存 / `main`＝その他）で失敗したかを記録
2. 同じDiscord Webhookへ、**赤色のEmbed**でエラー内容を通知します
   - タイトル：`⚠️ 監視Botエラー: <段階名>`
   - 説明文：エラーメッセージ
   - 詳細情報欄：デバッグ用の追加情報（レスポンスの一部やスタックトレースなど）
3. GitHub Actionsの実行ログ（`Actions`タブ）にも同内容がJSON形式で残るので、詳しい調査もそこから行えます

フィードが**0件**しか取れなかった場合（サイト障害の可能性）も、致命的エラーとはせず、Discordに注意喚起の通知を送った上で状態は変更せず安全に終了します。

---

## 8. 既知の制限事項

- ごく稀に「Discordへの送信は成功したが、直後の`state.json`保存がネットワーク等の理由で失敗した」場合、次回実行時に同じバッチが**重複して通知される**可能性があります。ただし、通知が失われることは設計上ありません（安全側に倒しています）。
- `seenIds`は直近1500件のみ保持します。理論上、1500件を超えて古い記事が編集された場合は再度新着として検知される可能性がありますが、実運用でこの規模の巻き戻りが起きることはまずありません。

---

## 9. ローカルでのテスト実行（任意）

```bash
cd netflix-watcher
cp .env.example .env
# .envにDISCORD_WEBHOOK_URLを設定してから

export $(cat .env | xargs)
node src/index.js test    # または: npm run test
```

Node.js 18以上が必要です（組み込みの`fetch`を使用しているため）。
