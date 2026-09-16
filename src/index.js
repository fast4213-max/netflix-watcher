'use strict';

const logger = require('./logger');
const { fetchFeed, StepError } = require('./fetchFeed');
const stateManager = require('./stateManager');
const diffEngine = require('./diffEngine');
const notifier = require('./discordNotifier');

// modeは環境変数MODE、なければコマンドライン引数、それも無ければ"run"
const MODE = (process.env.MODE || process.argv[2] || 'run').toLowerCase();
const VALID_MODES = ['init', 'test', 'run'];

async function main() {
  logger.info('main', `監視Botを起動しました (mode=${MODE})`);

  if (!VALID_MODES.includes(MODE)) {
    const msg = `未知のmodeが指定されました: "${MODE}"（init / test / run のいずれかを指定してください）`;
    logger.error('main', msg);
    await notifier.notifyError('main', msg);
    process.exitCode = 1;
    return;
  }

  // --- フィード取得（ここで失敗したら即エラー通知して終了） ---
  let feedEntries;
  try {
    feedEntries = await fetchFeed();
  } catch (err) {
    const step = err instanceof StepError ? err.step : 'fetch';
    const extra = err instanceof StepError ? err.cause : err.stack;
    logger.error(step, err.message, { extra });
    await notifier.notifyError(step, err.message, extra);
    process.exitCode = 1;
    return;
  }

  if (feedEntries.length === 0) {
    logger.warn(
      'fetch',
      'フィードから0件しか取得できませんでした。サイト側の一時障害または構造変化の可能性があります。'
    );
    await notifier.notifyError(
      'fetch',
      'フィード取得結果が0件でした。サイトの一時的な障害か、フィード構造の変化が疑われます。手動確認をおすすめします。'
    );
    // 0件は致命的エラーではないため、状態(state.json)には一切触れずに正常終了する
    return;
  }

  const state = stateManager.loadState();

  try {
    if (MODE === 'init') {
      await handleInit(feedEntries, state);
      return;
    }

    if (MODE === 'test') {
      await handleTest(feedEntries);
      return;
    }

    // MODE === 'run'
    await handleRun(feedEntries, state);
  } catch (err) {
    logger.error('main', '処理中に予期しないエラーが発生しました', {
      error: String(err),
      stack: err.stack,
    });
    await notifier.notifyError('main', err.message, err.stack);
    process.exitCode = 1;
  }
}

/**
 * 初回セットアップ用：フィードの全件を既読化し、以降は新着のみ通知されるようにする。
 */
async function handleInit(feedEntries, state) {
  diffEngine.markAllAsSeen(feedEntries, state);
  stateManager.saveState(state);
  await notifier.notifyInfo(
    '✅ 初期化完了',
    `フィード内の ${feedEntries.length} 件を既読として登録しました。以降はこれより新しい作品のみ通知されます。`
  );
}

/**
 * テスト用：先頭（＝最新）の1件だけを試験的に通知する。状態は一切変更しない。
 */
async function handleTest(feedEntries) {
  const latest = feedEntries[0];
  await notifier.notifyNewItems([
    { title: `[TEST] ${latest.title}`, image: latest.image },
  ]);
  logger.info('main', 'テスト通知を送信しました（stateは変更していません）');
}

/**
 * 本番用：新着を検知してキューに積み、先頭最大10件をDiscordへ通知する。
 * 送信に成功した分だけをキューから確定して既読化する。
 */
async function handleRun(feedEntries, state) {
  diffEngine.detectNewEntries(feedEntries, state);
  const batch = diffEngine.peekNextBatch(state);

  if (batch.length > 0) {
    await notifier.notifyNewItems(batch);
    diffEngine.confirmSent(state, batch);
  } else {
    logger.info('main', '新着なし、または送信待ちキューが空です');
  }

  stateManager.saveState(state);
}

main();
