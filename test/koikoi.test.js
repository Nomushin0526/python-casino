import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, calcYaku, KoikoiRound, cpuPickCard, cpuPickField, cpuDecideKoikoi } from '../public/js/lib/koikoi.js';

const find = (name) => CARDS.find((c) => c.name === name).id;
const names = (y) => y.yaku.map((x) => `${x.name}${x.points}`).sort();

test('札は48枚、各月4枚', () => {
  assert.equal(CARDS.length, 48);
  for (let m = 1; m <= 12; m++) assert.equal(CARDS.filter((c) => c.month === m).length, 4);
  assert.equal(CARDS.filter((c) => c.type === 'hikari').length, 5);
  assert.equal(CARDS.filter((c) => c.type === 'tane').length, 9);
  assert.equal(CARDS.filter((c) => c.type === 'tan').length, 10);
  assert.equal(CARDS.filter((c) => c.type === 'kasu').length, 24);
});

test('光札の役', () => {
  const lights = CARDS.filter((c) => c.type === 'hikari').map((c) => c.id);
  assert.deepEqual(names(calcYaku(lights)), ['五光10']);
  const noRain = lights.filter((id) => id !== find('柳に小野道風'));
  assert.deepEqual(names(calcYaku(noRain)), ['四光8']);
  assert.deepEqual(names(calcYaku([find('柳に小野道風'), find('松に鶴'), find('桜に幕'), find('芒に月')])), ['雨四光7']);
  assert.deepEqual(names(calcYaku([find('松に鶴'), find('桜に幕'), find('芒に月')])), ['三光5']);
  assert.deepEqual(names(calcYaku([find('柳に小野道風'), find('桜に幕'), find('芒に月')])), []);
});

test('一杯・猪鹿蝶・短冊', () => {
  assert.deepEqual(names(calcYaku([find('桜に幕'), find('菊に盃')])), ['花見で一杯5']);
  assert.deepEqual(names(calcYaku([find('芒に月'), find('菊に盃'), find('桜に幕')])), ['月見で一杯5', '花見で一杯5'].sort());
  assert.deepEqual(names(calcYaku([find('萩に猪'), find('紅葉に鹿'), find('牡丹に蝶')])), ['猪鹿蝶5']);
  const aka = [find('松に赤短'), find('梅に赤短'), find('桜に赤短')];
  assert.deepEqual(names(calcYaku(aka)), ['赤短5']);
  assert.deepEqual(names(calcYaku([...aka, find('藤に短冊'), find('萩に短冊')])), ['タン1', '赤短7'].sort());
});

test('タネ・カス', () => {
  const tane = CARDS.filter((c) => c.type === 'tane').slice(0, 6).map((c) => c.id);
  assert.ok(names(calcYaku(tane)).includes('タネ2'));
  const kasu = CARDS.filter((c) => c.type === 'kasu').slice(0, 11).map((c) => c.id);
  assert.deepEqual(names(calcYaku(kasu)), ['カス2']);
});

test('CPU同士で1局が最後まで進む', () => {
  for (let t = 0; t < 300; t++) {
    const r = new KoikoiRound({ oya: t % 2 });
    let guard = 0;
    while (r.phase !== 'end') {
      assert.ok(guard++ < 200);
      const p = r.turn;
      if (r.phase === 'play') r.playCard(p, cpuPickCard(r, p));
      else if (r.phase === 'chooseHand' || r.phase === 'chooseDraw') r.chooseField(p, cpuPickField(r));
      else if (r.phase === 'decide') r.decide(p, cpuDecideKoikoi(r, p));
    }
    const total = r.captured[0].length + r.captured[1].length + r.field.length + r.hands[0].length + r.hands[1].length + r.deck.length;
    assert.equal(total, 48);
    if (r.result.winner !== null) assert.ok(r.result.points[r.result.winner] > 0);
  }
});
