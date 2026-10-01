// ブラックジャックのルール
export function cardValue(c) {
  if (c.r === 1) return 11;
  return Math.min(c.r, 10);
}

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.r === 1) aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;
export const isBust = (cards) => handValue(cards).total > 21;

// ディーラーは standOn（17）以上でスタンド（ソフト17もスタンド）
export function dealerShouldHit(cards, standOn = 17) {
  return handValue(cards).total < standOn;
}

// プレイヤー・ディーラーの手札から outcome を決める
export function judge(player, dealer) {
  const pbj = isBlackjack(player);
  const dbj = isBlackjack(dealer);
  if (pbj && dbj) return 'push';
  if (pbj) return 'blackjack';
  if (dbj) return 'lose';
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  if (p > 21) return 'lose';
  if (d > 21) return 'win';
  if (p > d) return 'win';
  if (p < d) return 'lose';
  return 'push';
}
