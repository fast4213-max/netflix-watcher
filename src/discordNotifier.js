'use strict';

const logger = require('./logger');

// 通知用・エラー用は同一のWebhookを使う（環境変数からのみ読み込み、コード内には書かない）
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const COLOR_NOTIFY = 0xe50914; // Netflixレッド
const COLOR_ERROR = 0xff3333;
const COLOR_INFO = 0x5865f2;

function assertWebhookConfigured() {
  if (!DISCORD_WEBHOOK_URL) {
    throw new Error(
      'DISCORD_WEBHOOK_URL が環境変数に設定されていません。GitHub SecretsとWorkflowのenv設定を確認してください。'
    );
  }
}

function truncate(str, max) {
  if (!str) return str;
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

async function postToDiscord(payload) {
  assertWebhookConfigured();

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '(本文取得不可)');
    throw new Error(
      `Discord Webhookへの送信に失敗しました: status=${res.status} body=${bodyText.slice(0, 500)}`
    );
  }
}

/**
 * 新着作品の通知。1メッセージ・Embed最大10件（Discordの仕様上限に合わせている）。
 * 要件どおりリンク(url)は設定せず、タイトルと画像のみ。
 */
async function notifyNewItems(items) {
  if (!items || items.length === 0) return;

  const embeds = items.slice(0, 10).map((item) => {
    const embed = {
      title: truncate(item.title || '(タイトル不明)', 256),
      color: COLOR_NOTIFY,
    };
    if (item.image) {
      embed.image = { url: item.image };
    }
    return embed;
  });

  await postToDiscord({
    content: `🆕 Netflix新着作品を ${embeds.length} 件検知しました`,
    embeds,
  });

  logger.info('notify', `Discordへ新着通知を送信しました（${embeds.length}件）`);
}

/**
 * エラー発生時の通知。どの処理段階(step)で何が起きたかが一目で分かる形式にする。
 */
async function notifyError(step, message, extra) {
  const embed = {
    title: `⚠️ 監視Botエラー: ${step}`,
    description: truncate(message || '(詳細不明)', 4000),
    color: COLOR_ERROR,
    timestamp: new Date().toISOString(),
    fields: [],
  };

  if (extra !== undefined) {
    let extraText;
    try {
      extraText = typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2);
    } catch (e) {
      extraText = String(extra);
    }
    embed.fields.push({
      name: '詳細情報（デバッグ用）',
      value: truncate(extraText, 1000) || '(なし)',
    });
  }

  try {
    await postToDiscord({ embeds: [embed] });
  } catch (err) {
    // エラー通知自体の送信失敗はActionsログにのみ残す（無限ループにしないため再送はしない）
    logger.error('notify', 'エラー通知のDiscord送信自体に失敗しました', { error: String(err) });
  }
}

/**
 * init/testモードなどの情報系通知（任意）
 */
async function notifyInfo(title, description) {
  const embed = {
    title,
    description: truncate(description || '', 4000),
    color: COLOR_INFO,
    timestamp: new Date().toISOString(),
  };
  try {
    await postToDiscord({ embeds: [embed] });
  } catch (err) {
    logger.error('notify', '情報通知のDiscord送信に失敗しました', { error: String(err) });
  }
}

module.exports = { notifyNewItems, notifyError, notifyInfo };
