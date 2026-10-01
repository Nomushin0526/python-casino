// バカラ（プレイヤー / バンカー / タイ）
import { el, clear, cardEl, sleep, multLabel } from '../ui.js';
import { makeShoe } from '../lib/cards.js';
import { playCoup, total } from '../lib/baccarat.js';

const NAMES = { player: 'プレイヤー', banker: 'バンカー', tie: 'タイ' };

export default {
  id: 'baccarat',
  title: 'バカラ',
  icon: '🎴',
  desc: 'プレイヤーとバンカー、どちらが9に近いかを予想。タイは高配当！',
  payout: (cfg) => [['プレイヤー', cfg.multipliers.player], ['バンカー', cfg.multipliers.banker], ['タイ', cfg.multipliers.tie], ['外れ', cfg.multipliers.lose]],
  mount(root, ctx) {
    const { sound, cfg } = ctx;
    let alive = true;
    let chosen = null;

    const pCards = el('div.cards');
    const bCards = el('div.cards');
    const pTotal = el('div.status-line', { style: { fontSize: '40px' } });
    const bTotal = el('div.status-line', { style: { fontSize: '40px' } });
    const status = el('div.status-line', { style: { fontSize: '30px', color: 'var(--gold)' } }, 'どちらが勝つか選んでね');
    const choiceBtns = ['player', 'banker', 'tie'].map((side, i) => el('button.btn.big', {
      class: side === 'player' ? 'blue' : side === 'banker' ? 'danger' : 'green',
      on: { click: () => choose(side) },
    }, `${NAMES[side]} ${multLabel(cfg.multipliers[side])}`, el('kbd', String(i + 1))));
    const sideBox = (name, color, cards, tot) => el('div.col', { style: { alignItems: 'center', flex: 1 } },
      el('div', { style: { fontSize: '28px', fontWeight: 900, color } }, name), cards, tot);

    clear(root,
      el('div.table-felt.col', { style: { width: 'min(1100px, 100%)', flex: 1, padding: '24px', alignItems: 'center', justifyContent: 'center', gap: '20px' } },
        el('div.row', { style: { width: '100%', alignItems: 'flex-start' } },
          sideBox('PLAYER', 'var(--blue)', pCards, pTotal),
          el('div', { style: { width: '2px', alignSelf: 'stretch', background: 'rgba(255,255,255,.2)' } }),
          sideBox('BANKER', 'var(--red)', bCards, bTotal)),
        status,
        el('div.muted', cfg.tiePushesPlayerBanker ? 'プレイヤー/バンカーに賭けてタイになったときは引き分け（±0）' : '')),
      el('div.actions', { style: { marginTop: '14px' } }, choiceBtns));

    async function choose(side) {
      if (chosen || !alive) return;
      chosen = side;
      sound.chip();
      choiceBtns.forEach((b, i) => {
        b.disabled = true;
        if (['player', 'banker', 'tie'][i] === side) { b.disabled = false; b.classList.add('sel'); }
      });
      status.textContent = `${NAMES[side]} に賭けました。カードを配ります…`;
      const shoe = makeShoe({ decks: 8 });
      const coup = playCoup(() => shoe.pop());
      const shown = { player: [], banker: [] };
      for (const [who, idx] of coup.steps) {
        await sleep(650);
        if (!alive) return;
        shown[who].push(coup[who][idx]);
        sound.card();
        pCards.replaceChildren(...shown.player.map((c, i) => cardEl(c, { cls: i === shown.player.length - 1 && who === 'player' ? 'flip' : '' })));
        bCards.replaceChildren(...shown.banker.map((c, i) => cardEl(c, { cls: i === shown.banker.length - 1 && who === 'banker' ? 'flip' : '' })));
        pTotal.textContent = String(total(shown.player));
        bTotal.textContent = String(total(shown.banker));
        if (idx === 1 && who === 'banker' && coup.natural) status.textContent = 'ナチュラル！';
        if (idx === 2) status.textContent = `${who === 'player' ? 'プレイヤー' : 'バンカー'}が3枚目を引きます`;
      }
      await sleep(700);
      const win = coup.winner;
      status.textContent = win === 'tie' ? 'タイ（引き分け）！' : `${NAMES[win]}の勝ち！`;
      if (win !== 'tie') (win === 'player' ? pCards : bCards).querySelectorAll('.pcard').forEach((c) => c.classList.add('win'));
      await sleep(1500);
      if (alive) ctx.finish({ choice: side, winner: win });
    }

    const onKey = (e) => {
      if (e.key === '1') choose('player');
      else if (e.key === '2') choose('banker');
      else if (e.key === '3') choose('tie');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey);
    };
  },
};
