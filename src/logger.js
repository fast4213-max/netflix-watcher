'use strict';

/**
 * 構造化ログ出力モジュール
 * GitHub Actionsのログにも、後から原因を追いやすい形式(JSON1行)で出力する。
 * level: debug / info / warn / error
 * step : どの処理段階で発生したログか（fetch / parse / diff / notify / state / main など）
 */

function timestamp() {
  return new Date().toISOString();
}

function log(level, step, message, extra) {
  const entry = {
    time: timestamp(),
    level,
    step,
    message,
  };
  if (extra !== undefined) {
    entry.extra = extra;
  }

  const line = JSON.stringify(entry);

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }

  return entry;
}

module.exports = {
  debug: (step, message, extra) => log('debug', step, message, extra),
  info: (step, message, extra) => log('info', step, message, extra),
  warn: (step, message, extra) => log('warn', step, message, extra),
  error: (step, message, extra) => log('error', step, message, extra),
};
