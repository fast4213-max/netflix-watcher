'use strict';

const logger = require('./logger');

// Discordのメッセージ1件に含められるEmbed数の上限(10)に合わせる
const MAX_SEND_PER_RUN = 10;

/**
 * フィードから取得した最新エントリ一覧と現在のstateを比較し、
 * まだ見ていないIDをpendingQueueの末尾に追加する（順序は古い→新しい）。
 * 通知しきれず溜まった分は次回以降も保持され続けるため、取りこぼしがない。
 */
function detectNewEntries(feedEntries, state) {
  const seenSet = new Set(state.seenIds);
  const pendingIdSet = new Set(state.pendingQueue.map((item) => item.id));

  // フィードは新しい順（updated降順）で来る想定なので、
  // 古い→新しいの順でキューに積むために反転させる
  const chronological = [...feedEntries].reverse();

  let newCount = 0;
  for (const entry of chronological) {
    if (seenSet.has(entry.id) || pendingIdSet.has(entry.id)) continue;

    state.pendingQueue.push({
      id: entry.id,
      title: entry.title,
      image: entry.image,
      detectedAt: new Date().toISOString(),
    });
    pendingIdSet.add(entry.id);
    newCount++;
  }

  logger.info(
    'diff',
    `新規検知: ${newCount}件（送信待ちキュー合計: ${state.pendingQueue.length}件）`
  );

  return state;
}

/**
 * pendingQueueの先頭から最大N件を取り出す（この時点ではまだ削除しない）
 */
function peekNextBatch(state, limit = MAX_SEND_PER_RUN) {
  return state.pendingQueue.slice(0, limit);
}

/**
 * Discordへの送信が成功したアイテムだけをpendingQueueから取り除き、seenIdsへ移す。
 */
function confirmSent(state, sentItems) {
  const sentIds = new Set(sentItems.map((item) => item.id));
  state.pendingQueue = state.pendingQueue.filter((item) => !sentIds.has(item.id));
  state.seenIds.push(...sentIds);

  logger.info('diff', `送信確定: ${sentIds.size}件をseenIdsへ移動しました`);
  return state;
}

/**
 * 初回セットアップ用: フィードに存在する全件を「既読」として登録する。
 * これにより、導入時点までの作品は通知されず、以降の新着だけが通知対象になる。
 */
function markAllAsSeen(feedEntries, state) {
  const seenSet = new Set(state.seenIds);
  let addedCount = 0;

  // フィードは新しい順で来る想定なので、seenIdsを古い→新しいの順で保持する
  // stateManager側の「配列の先頭側が古い」という前提と合わせるために反転させる
  // （detectNewEntriesと同じ並び順にする）
  const chronological = [...feedEntries].reverse();

  for (const entry of chronological) {
    if (!seenSet.has(entry.id)) {
      state.seenIds.push(entry.id);
      seenSet.add(entry.id);
      addedCount++;
    }
  }

  state.pendingQueue = [];

  logger.info(
    'diff',
    `初期化: ${addedCount}件を既読化しました（取得フィード全体: ${feedEntries.length}件）`
  );
  return state;
}

module.exports = {
  detectNewEntries,
  peekNextBatch,
  confirmSent,
  markAllAsSeen,
  MAX_SEND_PER_RUN,
};
