// バカラ（標準の3枚目ルール）
export const point = (c) => (c.r >= 10 ? 0 : c.r);
export const total = (cards) => cards.reduce((a, c) => a + point(c), 0) % 10;

// バンカーが3枚目を引くか（playerThird はプレイヤーの3枚目、引いていなければ null）
export function bankerDraws(bankerTotal, playerThird) {
  if (playerThird == null) return bankerTotal <= 5;
  const p = point(playerThird);
  switch (bankerTotal) {
    case 0: case 1: case 2: return true;
    case 3: return p !== 8;
    case 4: return p >= 2 && p <= 7;
    case 5: return p >= 4 && p <= 7;
    case 6: return p === 6 || p === 7;
    default: return false;
  }
}

// draw() で1枚ずつ引いて1ゲーム進める。配られた順の記録も返す
export function playCoup(draw) {
  const player = [draw()];
  const banker = [draw()];
  player.push(draw());
  banker.push(draw());
  const steps = [['player', 0], ['banker', 0], ['player', 1], ['banker', 1]];
  const pt = total(player);
  const bt = total(banker);
  if (pt < 8 && bt < 8) {
    let playerThird = null;
    if (pt <= 5) {
      playerThird = draw();
      player.push(playerThird);
      steps.push(['player', 2]);
    }
    if (bankerDraws(bt, playerThird)) {
      banker.push(draw());
      steps.push(['banker', 2]);
    }
  }
  const p = total(player);
  const b = total(banker);
  const winner = p > b ? 'player' : b > p ? 'banker' : 'tie';
  return { player, banker, playerTotal: p, bankerTotal: b, winner, steps, natural: pt >= 8 || bt >= 8 };
}
