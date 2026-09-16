'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const STATE_PATH = path.join(__dirname, '..', 'data', 'state.json');

// 直近何件のIDを「既読」として保持し続けるか。
// 300件/回取得×十分な余裕を持たせた件数。これを超えた分は古い方から間引く。
const SEEN_IDS_LIMIT = 1500;

function defaultState() {
  return {
    version: 1,
    lastCheckedAt: null,
    seenIds: [],
    pendingQueue: [],
  };
}

function isValidState(parsed) {
  return (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray(parsed.seenIds) &&
    Array.isArray(parsed.pendingQueue)
  );
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) {
      logger.warn('state', 'state.jsonが存在しないため新規に作成します');
      return defaultState();
    }

    const raw = fs.readFileSync(STATE_PATH, 'utf-8');

    if (!raw.trim()) {
      logger.warn('state', 'state.jsonが空のため初期状態として扱います');
      return defaultState();
    }

    const parsed = JSON.parse(raw);

    if (!isValidState(parsed)) {
      logger.error(
        'state',
        'state.jsonの構造が不正です（seenIds/pendingQueueが配列でない）。安全のためデフォルト状態にフォールバックします。',
        { rawSample: raw.slice(0, 300) }
      );
      return defaultState();
    }

    return parsed;
  } catch (err) {
    logger.error('state', 'state.jsonの読み込みに失敗しました。デフォルト状態にフォールバックします。', {
      error: String(err),
    });
    return defaultState();
  }
}

function saveState(state) {
  // seenIdsの上限管理（古いものから間引く。配列の先頭側が古い前提で運用する）
  if (state.seenIds.length > SEEN_IDS_LIMIT) {
    const overflow = state.seenIds.length - SEEN_IDS_LIMIT;
    state.seenIds = state.seenIds.slice(overflow);
    logger.info('state', `seenIdsが上限を超えたため古い${overflow}件を間引きました`);
  }

  state.lastCheckedAt = new Date().toISOString();

  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 書き込み中のプロセス異常終了で壊れないよう、一時ファイル経由でrenameする
  const tmpPath = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, STATE_PATH);

  logger.info('state', 'state.jsonを保存しました', {
    seenIdsCount: state.seenIds.length,
    pendingQueueCount: state.pendingQueue.length,
  });
}

module.exports = { loadState, saveState, defaultState, STATE_PATH, SEEN_IDS_LIMIT };
