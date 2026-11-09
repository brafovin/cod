import { Game } from './game.js';

const bar = document.querySelector('#loadbar div');
const txt = document.getElementById('loadtxt');
const sm = document.getElementById('loadsm');
const wait = () => new Promise((r) => setTimeout(r, 30));
const game = new Game();
window.__game = game;
game.init(async (p, label) => {
  bar.style.width = (p * 100) + '%'; txt.textContent = label.toUpperCase();
  await wait();
}).then(() => {
  document.getElementById('playBtn').disabled = false; sm.textContent = 'Team-Deathmatch · 4 gegen 4';
  document.getElementById('loadbar').style.display = 'none'; txt.style.display = 'none';
}).catch((e) => { console.error(e); txt.textContent = 'FEHLER: ' + e.message; });
import * as TT from './terrain.js';
import { ctx as CTX } from './ctx.js';
window.__T = TT; window.__ctx = CTX;
import * as AA from './actions.js';
window.__A = AA;
import * as CC from './combat.js';
window.__C = CC;
