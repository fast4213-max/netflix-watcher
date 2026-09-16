'use strict';

const logger = require('./logger');

// max-results=150 : Bloggerの実際の仕様上、1リクエストで返る上限は150件（それ以上を
//                    指定しても150にクランプされる）。1時間毎の実行であれば、
//                    1日30件更新が続いても十分すぎるマージンがある。
// 補足: orderby=updated は指定してもこのサイトのフィードでは効果がなく、
//       常にpublished（公開日時）降順で返ってくることを確認済み。
//       新規投稿の検知には影響しないため、無害な指定として残している。
const FEED_URL =
  'https://www.net-frx.com/feeds/posts/default?alt=json&max-results=150&orderby=updated';

/**
 * どの処理段階で失敗したかを保持するエラー
 */
class StepError extends Error {
  constructor(step, message, cause) {
    super(message);
    this.name = 'StepError';
    this.step = step;
    this.cause = cause;
  }
}

/**
 * contentのHTML文字列から最初の<img src="...">を抜き出す
 */
function extractFirstImage(contentHtml) {
  if (!contentHtml) return null;
  const match = contentHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

/**
 * Blogger JSON フィードの生データを、通知に必要な最小限の形に正規化する。
 * 1件ごとにtry/catchし、壊れているエントリだけをスキップする
 * （1件の異常で全体を失敗させない）。
 */
function parseFeed(json) {
  if (!json || typeof json !== 'object' || !json.feed) {
    throw new StepError(
      'parse',
      'フィードの構造が想定と異なります（feedキーが存在しません）。サイト側の仕様変更の可能性があります。',
      { sample: safeSlice(json) }
    );
  }

  const entries = json.feed.entry;

  if (entries === undefined) {
    // Bloggerは記事が0件のとき entry キー自体を省略することがある仕様のため、
    // これは異常ではなく「0件」として扱う。
    logger.warn('parse', 'entryキーが存在しません（記事0件、またはフィード仕様変更の可能性）');
    return [];
  }

  if (!Array.isArray(entries)) {
    throw new StepError(
      'parse',
      'feed.entryが配列ではありません。フィードの構造が変化した可能性があります。',
      { typeofEntries: typeof entries }
    );
  }

  const results = [];

  for (const entry of entries) {
    try {
      const id = entry && entry.id && entry.id.$t;
      const title = entry && entry.title && entry.title.$t;

      if (!id || !title) {
        logger.warn('parse', '必須フィールド(id/title)が欠落したエントリをスキップしました', {
          idPresent: Boolean(id),
          titlePresent: Boolean(title),
        });
        continue;
      }

      const contentHtml = entry.content && entry.content.$t;
      const updated = entry.updated && entry.updated.$t;
      const published = entry.published && entry.published.$t;

      let link = null;
      if (Array.isArray(entry.link)) {
        const alt = entry.link.find((l) => l && l.rel === 'alternate');
        if (alt) link = alt.href;
      }

      const image = extractFirstImage(contentHtml);

      results.push({ id, title, link, image, updated, published });
    } catch (err) {
      logger.warn('parse', '個別エントリのパース中に例外が発生したためスキップしました', {
        error: String(err),
      });
    }
  }

  logger.info('parse', `フィードのパースが完了しました（${results.length}件）`);
  return results;
}

function safeSlice(obj) {
  try {
    return JSON.stringify(obj).slice(0, 500);
  } catch (e) {
    return '(シリアライズ不可)';
  }
}

async function fetchFeed() {
  logger.info('fetch', 'Bloggerフィードを取得します', { url: FEED_URL });

  let res;
  try {
    res = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'netflix-watcher-bot/1.0 (+github actions)' },
    });
  } catch (err) {
    throw new StepError('fetch', 'フィードへのHTTPリクエスト自体に失敗しました（ネットワーク/DNS等）', String(err));
  }

  if (!res.ok) {
    throw new StepError(
      'fetch',
      `フィード取得のHTTPステータスが異常です: ${res.status} ${res.statusText}`
    );
  }

  let text;
  try {
    text = await res.text();
  } catch (err) {
    throw new StepError('fetch', 'レスポンス本文の読み取りに失敗しました', String(err));
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new StepError('parse', 'レスポンスのJSONパースに失敗しました（HTML等が返っている可能性）', {
      bodySample: text.slice(0, 500),
    });
  }

  return parseFeed(json);
}

module.exports = { fetchFeed, parseFeed, StepError, FEED_URL };
