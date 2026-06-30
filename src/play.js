/* ========================================================================
   play.js — Play screen UI actions
   Wheel · Scratch card · Coin flip · Mystery chest · Lottery · Leaderboard
   All game outcomes come from the SERVER — the client only animates.

   Economy values (prize arrays, coinflip win/lose, lotto ticket price) are
   read from the server-provided `state.economy` config — never hardcoded.
   ======================================================================== */

import { api } from './api.js';
import { playAd } from './ads.js';
import { getState, updateState } from './state.js';
import { $, render, toast, reward, fmt, fmtInt } from './ui.js';
import { haptic } from './telegram.js';
import { launchConfetti } from './animations.js';

/* ---- Economy accessor (server-authoritative) ---- */
function econ() {
  return getState().economy || {};
}

/* ========================================================================
   WHEEL
   ======================================================================== */
let wheelRot = 0;
let spinning = false;

/**
 * Build the wheel SVG with sapphire+gold segments. Prize values come from the
 * server economy config so the displayed wheel always matches what the server
 * will actually pay. Called on boot AND whenever the economy config changes.
 */
export function buildWheel() {
  const svg = $('wheel');
  if (!svg) return;

  const prizes = econ().WHEEL_PRIZES || [120, 60, 300, 0, 40, 20, 600, 8];
  const n = prizes.length;
  const seg = 360 / n;
  const cx = 100, cy = 100, r = 92;

  // Segment colors — match the app's card palette
  const segDark = '#141a2a';
  const segLight = '#1e2538';

  let html = '';

  // Defs: gold rim gradient + segment highlight
  html += `<defs>
    <linearGradient id="wheelRim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbbf24"/>
      <stop offset="0.5" stop-color="#f59e0b"/>
      <stop offset="1" stop-color="#d97706"/>
    </linearGradient>
    <radialGradient id="segHighlight" cx="0.5" cy="0.25" r="0.6">
      <stop offset="0" stop-color="rgba(255,255,255,0.06)"/>
      <stop offset="0.6" stop-color="rgba(255,255,255,0)"/>
      <stop offset="1" stop-color="rgba(0,0,0,0.2)"/>
    </radialGradient>
  </defs>`;

  // Gold rim (matches .btn-primary gradient)
  html += `<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="none" stroke="url(#wheelRim)" stroke-width="5"/>`;
  html += `<circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="none" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>`;

  for (let i = 0; i < n; i++) {
    const a0 = (i * seg - 90) * Math.PI / 180;
    const a1 = ((i + 1) * seg - 90) * Math.PI / 180;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);

    const fill = i % 2 === 0 ? segLight : segDark;
    html += `<path d="M${cx},${cy} L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} Z" fill="${fill}"/>`;
    html += `<path d="M${cx},${cy} L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} Z" fill="url(#segHighlight)" pointer-events="none"/>`;
    html += `<line x1="${cx}" y1="${cy}" x2="${x0}" y2="${y0}" stroke="rgba(251,191,36,0.18)" stroke-width="0.6"/>`;

    const am = (a0 + a1) / 2;
    const tx = cx + r * 0.62 * Math.cos(am);
    const ty = cy + r * 0.62 * Math.sin(am);
    const rot = (i * seg) + (seg / 2);
    const prize = prizes[i];
    const big = prize >= 300;
    const label = prize === 0 ? 'MISS' : prize;

    let labelColor, fontSize, fontWeight;
    if (prize === 0) { labelColor = '#64748b'; fontSize = 11; fontWeight = 600; }
    else if (big) { labelColor = '#fbbf24'; fontSize = 15; fontWeight = 800; }
    else { labelColor = '#fde68a'; fontSize = 13; fontWeight = 700; }

    html += `<text x="${tx}" y="${ty}" fill="${labelColor}" font-size="${fontSize}" font-family="Space Grotesk" font-weight="${fontWeight}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rot} ${tx} ${ty})" style="letter-spacing:0.03em">${label}</text>`;
  }

  // Inner ring
  html += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(0,0,0,0.4)" stroke-width="1.5"/>`;
  html += `<circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="0.5"/>`;

  svg.innerHTML = html;

  // Gold stud bezel ring
  const bezel = document.querySelector('.wheel-bezel');
  if (bezel && bezel.childElementCount === 0) {
    let dots = '';
    const dotN = 16;
    for (let i = 0; i < dotN; i++) {
      const ang = (i / dotN) * 360;
      dots += `<i style="transform: rotate(${ang}deg) translate(0, -118px)"></i>`;
    }
    bezel.innerHTML = dots;
  }
}

/**
 * Animate the wheel to land on the server-provided prize index.
 * The pointer is fixed at the top (12 o'clock). Segment i's center starts at
 * angle (i*seg + seg/2 - 90). To bring it to the top (-90) we rotate the wheel
 * by R where R ≡ -(i*seg + seg/2) (mod 360). We add 6 full turns for drama.
 */
function animateWheel(prizeIndex, prizeAmount) {
  if (spinning) return;
  spinning = true;

  const prizes = econ().WHEEL_PRIZES || [120, 60, 300, 0, 40, 20, 600, 8];
  const seg = 360 / prizes.length;
  const base = wheelRot % 360;
  const landAt = (360 - (prizeIndex * seg + seg / 2)) % 360;
  const delta = (landAt - base + 360) % 360;
  const startRot = wheelRot;
  const endRot = wheelRot + 360 * 6 + delta;
  wheelRot = endRot;

  const wheelEl = $('wheel');
  if (wheelEl) {
    // Manual requestAnimationFrame animation — the most reliable approach.
    // CSS transitions on SVG elements are unreliable — setting transition
    // + transform in the same frame causes the browser to skip the animation.
    // By directly setting style.transform on every frame via rAF, nothing
    // can cancel or override the animation.
    const duration = 4600;
    const startTime = performance.now();

    function easeOut(t) {
      if (t < 0.25) return (t / 0.25) * 0.45;
      if (t < 0.50) return 0.45 + ((t - 0.25) / 0.25) * 0.25;
      if (t < 0.75) return 0.70 + ((t - 0.50) / 0.25) * 0.15;
      return 0.85 + ((t - 0.75) / 0.25) * 0.15;
    }

    function frame(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const progress = easeOut(t);
      const currentRot = startRot + (endRot - startRot) * progress;
      wheelEl.style.transform = `rotate(${currentRot}deg)`;

      if (t < 1 && spinning) {
        requestAnimationFrame(frame);
      } else {
        wheelEl.style.transform = `rotate(${endRot}deg)`;
      }
    }
    requestAnimationFrame(frame);
  }

  setTimeout(() => {
    spinning = false;
    if (prizeAmount > 0) {
      reward(prizeAmount, 'Lucky spin!', 'Watch an ad to spin again!');
      if (prizeAmount >= 300) launchConfetti(60);
    } else {
      toast('So close', 'No win this time');
    }
    render();
  }, 4900);
}

/* ========================================================================
   SCRATCH CARD (canvas-based real scratch-off)
   ======================================================================== */
let scratchReady = false;
let scratchRevealed = false;
let scratchUnlocked = false;  // gate: canvas only interactive after "Get a scratch card"

function initScratchCanvas() {
  const canvas = $('scratchCanvas');
  const wrap = $('scratch');
  if (!canvas || !wrap) return;

  // Size canvas to its display box (device pixels for crispness)
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Paint the gold foil cover
  const grad = ctx.createLinearGradient(0, 0, rect.width, rect.height);
  grad.addColorStop(0, '#b45309');
  grad.addColorStop(0.45, '#fbbf24');
  grad.addColorStop(0.55, '#f59e0b');
  grad.addColorStop(1, '#92400e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, rect.width, rect.height);

  // Subtle diagonal sheen
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#fff7e6';
  ctx.lineWidth = 1;
  for (let x = -rect.height; x < rect.width; x += 9) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + rect.height, rect.height); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Label on the foil — changes based on unlock state
  ctx.fillStyle = 'rgba(28, 17, 9, 0.55)';
  ctx.font = '700 12px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(scratchUnlocked ? 'SCRATCH TO REVEAL' : 'TAP "GET A SCRATCH CARD"', rect.width / 2, rect.height / 2);

  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 26;

  let drawing = false;
  let last = null;
  let scratchedPct = 0;
  const sample = () => {
    try {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let cleared = 0, total = 0;
      for (let i = 3; i < img.length; i += 4 * 40) { // sample every 40th px
        if (img[i] === 0) cleared++;
        total++;
      }
      return total ? cleared / total : 0;
    } catch (e) { return 0; }
  };

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  };

  const start = (e) => {
    if (scratchRevealed || !scratchUnlocked) return;  // gated
    drawing = true;
    last = pos(e);
    e.preventDefault();
  };
  const move = (e) => {
    if (!drawing || scratchRevealed) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    e.preventDefault();
  };
  const end = () => {
    if (!drawing) return;
    drawing = false;
    scratchedPct = sample();
    if (scratchedPct > 0.45) revealScratch();
  };

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  scratchReady = true;
}

function revealScratch() {
  if (scratchRevealed) return;
  scratchRevealed = true;
  const wrap = $('scratch');
  if (wrap) wrap.classList.add('revealed');
  const prize = Number(getState()._pendingScratchPrize || 0);
  if (prize > 0) {
    toast('Scratch win!', `+${prize} ORL`);
    reward(prize, 'Scratch win!', '');
  } else {
    toast('No luck', 'Try the next one');
  }
  render();
}

function loadScratchCard(prize) {
  const wrap = $('scratch');
  const prizeEl = $('scratchPrize');
  if (!wrap) return;
  scratchRevealed = false;
  scratchUnlocked = true;  // unlock the canvas for scratching
  wrap.classList.remove('revealed');
  getState()._pendingScratchPrize = prize;
  if (prizeEl) {
    prizeEl.innerHTML = prize > 0
      ? `+${prize}<small>ORL</small>`
      : `MISS<small>try again</small>`;
  }
  initScratchCanvas();
}

/* ========================================================================
   COIN FLIP — 3D coin
   ======================================================================== */
let cfBusy = false;
let cfRot = 0;

function flipCoin(result /* 'heads' | 'tails' */) {
  const coin = $('coinflipCoin');
  if (!coin) return;
  const targetFace = result === 'tails' ? 180 : 0;
  const base = cfRot % 360;
  const delta = (targetFace - base + 360) % 360;
  const startRot = cfRot;
  const endRot = cfRot + 360 * 10 + delta;
  cfRot = endRot;

  // Dramatic 3-second coin toss via requestAnimationFrame
  const duration = 3000;
  const startTime = performance.now();
  const apexHeight = 120;

  function spinEase(t) {
    if (t < 0.25) return (t / 0.25) * 0.45;
    if (t < 0.50) return 0.45 + ((t - 0.25) / 0.25) * 0.25;
    if (t < 0.75) return 0.70 + ((t - 0.50) / 0.25) * 0.15;
    return 0.85 + ((t - 0.75) / 0.25) * 0.15;
  }
  function arcHeight(t) { return -apexHeight * Math.sin(t * Math.PI); }
  function scaleFactor(t) { return 1 + 0.25 * Math.sin(t * Math.PI); }
  function wobble(t) {
    if (t < 0.95) return 0;
    const wt = (t - 0.95) / 0.05;
    return -8 * Math.sin(wt * Math.PI);
  }

  function frame(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const spinProgress = spinEase(t);
    const currentRot = startRot + (endRot - startRot) * spinProgress;
    const ty = arcHeight(t) + wobble(t);
    const sc = scaleFactor(t);
    coin.style.transform = `translateY(${ty}px) scale(${sc}) rotateY(${currentRot}deg)`;
    if (t < 1 && cfBusy) {
      requestAnimationFrame(frame);
    } else {
      coin.style.transform = `translateY(0px) scale(1) rotateY(${endRot}deg)`;
    }
  }
  requestAnimationFrame(frame);
}

/* ========================================================================
   SETUP PLAY ACTIONS
   ======================================================================== */
export function setupPlay() {
  // Refresh dynamic copy from the server economy config
  function refreshEconomyCopy() {
    const e = econ();
    const cfResult = $('coinflipResult');
    if (cfResult && !cfBusy && e.COINFLIP_WIN) {
      cfResult.textContent = `Pick heads or tails · win ${e.COINFLIP_WIN} ORL`;
    }
    const lottoBuy = $('lottoBuyBtn');
    if (lottoBuy && e.LOTTO_TICKET_ORL) {
      lottoBuy.innerHTML = `Buy ticket<small>${e.LOTTO_TICKET_ORL} ORL</small>`;
    }
  }
  refreshEconomyCopy();

  /* ---- Spin ---- */
  const spinBtn = $('spinBtn');
  if (spinBtn) {
    spinBtn.addEventListener('click', () => {
      if (spinning) return;
      const doSpin = async () => {
        try {
          const res = await api('/api/play/spin', { method: 'POST' });
          updateState(res);
          buildWheel(); // ensure wheel matches server prizes
          animateWheel(res.prizeIndex ?? 0, res.prizeAmount ?? 0);
        } catch (e) { /* handled */ }
      };
      playAd('Loading spin…', 'Watch an ad to spin the wheel.', 10, doSpin);
    });
  }

  /* ---- Scratch card ---- */
  const scratchBtn = $('scratchBtn');
  if (scratchBtn) {
    scratchBtn.addEventListener('click', () => {
      playAd('Loading card…', 'Scratch to reveal your prize.', 8, async () => {
        try {
          const res = await api('/api/play/scratch', { method: 'POST' });
          updateState(res);
          loadScratchCard(res.prizeAmount ?? 0);
        } catch (e) { /* handled */ }
      });
    });
  }
  // Init the canvas once mounted AND whenever the Play screen is shown (the
  // wrapper has 0 size while the screen is hidden, so a boot-time init produces
  // a 1x1 canvas — re-init on navigation gives it real dimensions).
  setTimeout(initScratchCanvas, 50);
  const playNav = document.querySelector('.nav-btn[data-screen="play"]');
  if (playNav) playNav.addEventListener('click', () => setTimeout(initScratchCanvas, 120));

  /* ---- Mystery chest ---- */
  const chestBtn = $('chestBtn');
  if (chestBtn) {
    chestBtn.addEventListener('click', () => {
      playAd('Filling chest…', 'Each ad gets you closer to the loot.', 10, async () => {
        try {
          const res = await api('/api/play/chest', { method: 'POST' });
          updateState(res);
          if (res.chestOpened && res.prizeAmount) {
            reward(res.prizeAmount, 'Chest unlocked!', 'Big haul. Fill another one?');
            launchConfetti(40);
          } else {
            const S = getState();
            const goal = econ().CHEST_GOAL || 5;
            toast('Chest filling', `${S.chestProgress || 0}/${goal}`);
          }
          render();
        } catch (e) { /* handled */ }
      });
    });
  }

  /* ---- Lottery: free ticket (ad) ---- */
  const lottoAdBtn = $('lottoAdBtn');
  if (lottoAdBtn) {
    lottoAdBtn.addEventListener('click', () => {
      playAd('Loading ticket…', 'Watch to grab a free entry.', 10, async () => {
        try {
          const res = await api('/api/play/lottery/ticket', { method: 'POST', body: { type: 'ad' } });
          updateState(res);
          render();
          toast('Ticket added', 'Good luck tonight');
        } catch (e) { /* handled */ }
      });
    });
  }

  /* ---- Lottery: buy ticket ---- */
  const lottoBuyBtn = $('lottoBuyBtn');
  if (lottoBuyBtn) {
    lottoBuyBtn.addEventListener('click', async () => {
      const S = getState();
      const price = econ().LOTTO_TICKET_ORL || 750;
      if (S.balance < price) {
        toast('Not enough ORL', `Need ${price}`);
        return;
      }
      try {
        const res = await api('/api/play/lottery/ticket', { method: 'POST', body: { type: 'buy' } });
        updateState(res);
        render();
        toast('Ticket bought', 'Entry confirmed');
      } catch (e) { /* handled */ }
    });
  }

  /* ---- Coin Flip ---- */
  const cfHeadsBtn = $('cfHeadsBtn');
  const cfTailsBtn = $('cfTailsBtn');

  function doCoinFlip(choice) {
    if (cfBusy) return;
    const cfResult = $('coinflipResult');
    cfBusy = true;
    if (cfResult) { cfResult.textContent = 'Flipping…'; cfResult.classList.remove('win'); }

    playAd('Loading coin flip…', 'Watch an ad to flip the coin.', 8, async () => {
      try {
        const res = await api('/api/play/coinflip', { method: 'POST', body: { choice } });
        // Animate the coin to land on the server result
        flipCoin(res.result);
        setTimeout(() => {
          updateState(res);
          if (res.won) {
            reward(res.prizeAmount, 'You won the flip!', `Landed on ${res.result}.`);
            if (cfResult) { cfResult.textContent = `Landed on ${res.result} · +${res.prizeAmount} ORL`; cfResult.classList.add('win'); }
            launchConfetti(25);
          } else {
            toast('Coin landed on ' + res.result, `+${res.prizeAmount} ORL consolation`);
            if (cfResult) { cfResult.textContent = `Landed on ${res.result} · +${res.prizeAmount} ORL`; }
          }
          render();
          cfBusy = false;
        }, 3100);  // wait for the 3s coin toss animation + 100ms buffer
      } catch (e) {
        cfBusy = false;
        refreshEconomyCopy();
      }
    });
  }

  if (cfHeadsBtn) cfHeadsBtn.addEventListener('click', () => doCoinFlip('heads'));
  if (cfTailsBtn) cfTailsBtn.addEventListener('click', () => doCoinFlip('tails'));

  renderLeaderboard();
}

/* ========================================================================
   RENDER: LEADERBOARD
   ======================================================================== */
export function renderLeaderboard(data) {
  const el = $('leaderboard');
  if (!el) return;

  const S = getState();
  const entries = data || S.leaderboard || [];

  let rows = '';
  if (entries.length) {
    rows = entries.map((n, i) => {
      const name = n.first_name || n.name || 'Anonymous';
      const amt = n.balance !== undefined ? fmtInt(n.balance) : 0;
      const initial = (name.replace('@', '')[0] || 'A').toUpperCase();
      const av = n.avatar_url || n.photo_url;
      const avHtml = av
        ? `<div class="lb-av"><img src="${av}" alt="" onerror="this.parentElement.textContent='${initial}'" /></div>`
        : `<div class="lb-av">${initial}</div>`;
      return `<div class="lb-row"><div class="lb-rank ${i < 3 ? 'top' : ''}">${i + 1}</div>
        ${avHtml}
        <div class="lb-name">${name}</div><div class="lb-amt">${amt} ORL</div></div>`;
    }).join('');
  } else {
    rows = `<div style="text-align:center;padding:20px;color:var(--ink-soft);font-size:13px">Leaderboard will update as users mine ORL.</div>`;
  }

  const userInitial = S.firstName ? S.firstName[0].toUpperCase() : 'A';
  const rankStr = S._userRank ? S._userRank : '—';
  const userAv = S.avatarUrl || S.photoUrl;
  const userAvHtml = userAv
    ? `<div class="lb-av" id="lbAv"><img src="${userAv}" alt="" onerror="this.parentElement.textContent='${userInitial}'" /></div>`
    : `<div class="lb-av" id="lbAv">${userInitial}</div>`;
  rows += `<div class="lb-row lb-me"><div class="lb-rank">${rankStr}</div>${userAvHtml}
    <div class="lb-name">You<small>climb to reach the prize pool</small></div><div class="lb-amt">${fmtInt(S.balance)} ORL</div></div>`;

  el.innerHTML = rows;
}
