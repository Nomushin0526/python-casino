// ゲーム結果 → 結果倍率・チップ増減の計算（サーバーとブラウザの両方で使う）
// 増減 = 賭けチップ × ゲーム結果倍率 × レバレッジ（損失は所持チップまで）

export class SettleError extends Error {}

function num(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new SettleError(`${name} が不正です`);
  return n;
}

// 各ゲームの結果オブジェクトから { multiplier, label, raw? } を返す
export function resolveOutcome(game, gameCfg, result, bet) {
  if (!result || typeof result !== 'object') throw new SettleError('結果がありません');
  switch (game) {
    case 'pinball': {
      const score = Math.max(0, Math.floor(num(result.score, 'score')));
      const m = gameCfg.multipliers;
      if (score >= gameCfg.superScore) return { multiplier: m.super, label: '超高得点！' };
      if (score >= gameCfg.highScore) return { multiplier: m.high, label: '高得点！' };
      if (score >= gameCfg.targetScore) return { multiplier: m.target, label: '目標達成！' };
      return { multiplier: m.miss, label: '目標未達…' };
    }
    case 'blackjack': {
      const m = gameCfg.multipliers;
      const labels = { win: '勝ち', blackjack: 'ブラックジャック！', push: '引き分け', lose: '負け' };
      if (!(result.outcome in labels)) throw new SettleError('outcome が不正です');
      const doubled = !!result.doubled && result.outcome !== 'blackjack';
      return {
        multiplier: m[result.outcome] * (doubled ? 2 : 1),
        label: labels[result.outcome] + (doubled ? '（ダブルダウン）' : ''),
      };
    }
    case 'baccarat': {
      const m = gameCfg.multipliers;
      const sides = ['player', 'banker', 'tie'];
      const names = { player: 'プレイヤー', banker: 'バンカー', tie: 'タイ' };
      if (!sides.includes(result.choice) || !sides.includes(result.winner)) throw new SettleError('choice/winner が不正です');
      if (result.choice === result.winner) return { multiplier: m[result.choice], label: `${names[result.winner]}の勝ち・的中！` };
      if (result.winner === 'tie' && gameCfg.tiePushesPlayerBanker) return { multiplier: 0, label: 'タイ（引き分け）' };
      return { multiplier: m.lose, label: `${names[result.winner]}の勝ち・外れ` };
    }
    case 'holdem': {
      const maxStack = bet * (gameCfg.cpuCount + 1);
      const stack = Math.floor(num(result.finalStack, 'finalStack'));
      if (stack < 0 || stack > maxStack) throw new SettleError('finalStack が範囲外です');
      const raw = stack - bet;
      return { multiplier: raw / bet, raw, label: raw > 0 ? `${raw}チップ勝ち` : raw < 0 ? `${-raw}チップ負け` : '±0' };
    }
    case 'daifugo': {
      const ranks = [null, 'daifugo', 'fugo', 'hinmin', 'daihinmin'];
      const names = { daifugo: '大富豪', fugo: '富豪', hinmin: '貧民', daihinmin: '大貧民' };
      const key = ranks[Math.floor(num(result.rank, 'rank'))];
      if (!key) throw new SettleError('rank が不正です');
      return { multiplier: gameCfg.multipliers[key], label: names[key] };
    }
    case 'koikoi': {
      const p = Math.floor(num(result.playerScore, 'playerScore'));
      const c = Math.floor(num(result.cpuScore, 'cpuScore'));
      if (p < 0 || c < 0 || p > 999 || c > 999) throw new SettleError('score が範囲外です');
      const diff = p - c;
      const m = gameCfg.multipliers;
      if (diff >= gameCfg.bigWinDiff) return { multiplier: m.bigWin, label: `大勝（${diff}点差）` };
      if (diff > 0) return { multiplier: m.win, label: `勝ち（${diff}点差）` };
      if (diff === 0) return { multiplier: m.draw, label: '引き分け' };
      return { multiplier: m.lose, label: `負け（${-diff}点差）` };
    }
    default:
      throw new SettleError(`不明なゲーム: ${game}`);
  }
}

// チップ増減の計算。勝ちは小数切り捨て、負けは所持チップまで
export function computeDelta({ bet, leverage, multiplier, raw, chips }) {
  const base = raw !== undefined ? raw : bet * multiplier;
  const value = base * leverage;
  if (value >= 0) return Math.floor(value + 1e-9);
  return -Math.min(Math.ceil(-value - 1e-9), chips);
}

// 賭けチップの上限・下限
export function betRange(chips, minBet) {
  return { min: Math.min(minBet, chips), max: chips };
}
