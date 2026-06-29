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
  buildWheelForElement('wheel', '.wheel-bezel');
  buildWheelForElement('wheelModal', '#wheelModalBezel');
}

function buildWheelForElement(svgId, bezelSelector) {
  const svg = $(svgId);
  if (!svg) return;

  const prizes = econ().WHEEL_PRIZES || [120, 60, 300, 0, 40, 20, 600, 8];
  const n = prizes.length;
  const seg = 360 / n;
  const cx = 100, cy = 100, r = 94;
  const fills = ['#1a2138', '#232b45']; // alternating sapphire shades

  let html = '';
  // Gold rim
  html += `<circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="none" stroke="#d97706" stroke-width="3"/>`;
  html += `<circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="none" stroke="rgba(251,191,36,0.35)" stroke-width="1"/>`;

  for (let i = 0; i < n; i++) {
    const a0 = (i * seg - 90) * Math.PI / 180;
    const a1 = ((i + 1) * seg - 90) * Math.PI / 180;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);

    html += `<path d="M${cx},${cy} L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} Z" fill="${fills[i % 2]}" stroke="rgba(251,191,36,0.22)" stroke-width="0.6"/>`;

    // Label
    const am = (a0 + a1) / 2;
    const tx = cx + r * 0.64 * Math.cos(am);
    const ty = cy + r * 0.64 * Math.sin(am);
    const rot = (i * seg) + (seg / 2);
    const big = prizes[i] >= 300;
    const label = prizes[i] === 0 ? 'MISS' : prizes[i];
    const color = prizes[i] === 0 ? '#94a3b8' : (big ? '#fbbf24' : '#fde68a');
    const fs = big ? 16 : 13;
    html += `<text x="${tx}" y="${ty}" fill="${color}" font-size="${fs}" font-family="Space Grotesk" font-weight="700" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rot} ${tx} ${ty})">${label}</text>`;
  }
  svg.innerHTML = html;

  // Build the gold stud bezel ring (16 dots)
  const bezel = document.querySelector(bezelSelector);
  if (bezel && bezel.innerHTML === '') {
    let dots = '';
    const dotN = 16;
    for (let i = 0; i < dotN; i++) {
      const ang = (i / dotN) * 360;
      dots += `<i style="transform: rotate(${ang}deg) translate(0, -118px)"></i>`;
    }
    bezel.innerHTML = dots;
  }
}

function animateWheel(prizeIndex, prizeAmount) {
  if (spinning) return;
  spinning = true;

  const prizes = econ().WHEEL_PRIZES || [120, 60, 300, 0, 40, 20, 600, 8];
  const seg = 360 / prizes.length;
  // normalize current rotation to [0,360) so we always spin forward
  const base = wheelRot % 360;
  const landAt = (360 - (prizeIndex * seg + seg / 2)) % 360;
  const delta = (landAt - base + 360) % 360;
  wheelRot += 360 * 6 + delta;

  const wheelEl = $('wheelModal');
  if (wheelEl) {
    wheelEl.style.transition = 'transform 4.6s cubic-bezier(0.16, 0.92, 0.18, 1)';
    wheelEl.style.transform = `rotate(${wheelRot}deg)`;
  }

  const closeBtn = $('spinCloseBtn');
  if (closeBtn) closeBtn.style.display = 'none';

  setTimeout(() => {
    spinning = false;
    if (wheelEl) wheelEl.style.transition = '';
    if (closeBtn) closeBtn.style.display = '';

    const spinVeil = $('spinVeil');
    if (spinVeil) spinVeil.classList.remove('show');

    if (prizeAmount > 0) {
      reward(prizeAmount, 'Lucky spin!', 'Watch an ad to spin again!');
      if (prizeAmount >= 300) launchConfetti(60);
    } else {
      toast('So close', 'No win this time');
    }
    render();
  }, 4750);
}

/* ========================================================================
   SCRATCH CARD (canvas-based real scratch-off)
   ========================================================================= */
let scratchReady = false;
let scratchRevealed = false;

function initScratchCanvas() {
  const canvas = $('scratchCanvas');
  const wrap = $('scratch');
  if (!canvas || !wrap) return;

  // Size canvas to its display box (device pixels for crispness)
  const rect = wrap.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return; // avoid canvas scale errors when hidden
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

  // "SCRATCH HERE" label on the foil
  ctx.fillStyle = 'rgba(28, 17, 9, 0.55)';
  ctx.font = '700 12px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SCRATCH TO REVEAL', rect.width / 2, rect.height / 2);

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
    if (scratchRevealed) return;
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
  wrap.classList.remove('revealed');
  getState()._pendingScratchPrize = prize;
  if (prizeEl) {
    prizeEl.innerHTML = prize > 0
      ? `+${prize}<small>ORL</small>`
      : `MISS<small>try again</small>`;
  }
  // Re-paint the foil fresh for this card
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
  // Land with front (heads) facing up → rotateY multiple of 360.
  // Land with back (tails) facing up → rotateY = 180 mod 360.
  const targetFace = result === 'tails' ? 180 : 0;
  const base = cfRot % 360;
  const delta = (targetFace - base + 360) % 360;
  cfRot += 360 * 5 + delta;
  coin.style.transform = `rotateY(${cfRot}deg)`;
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
  const spinVeil = $('spinVeil');
  const spinCloseBtn = $('spinCloseBtn');
  const spinModalBtn = $('spinModalBtn');
  const wheelModalHub = $('wheelModalHub');
  const inlineWheel = $('wheel');

  if (spinBtn) {
    spinBtn.addEventListener('click', () => {
      haptic('light');
      buildWheel(); // ensure both wheels match current economy
      if (spinVeil) spinVeil.classList.add('show');
    });
  }
  if (inlineWheel) {
    inlineWheel.addEventListener('click', () => {
      haptic('light');
      buildWheel();
      if (spinVeil) spinVeil.classList.add('show');
    });
  }
  if (spinCloseBtn) {
    spinCloseBtn.addEventListener('click', () => {
      if (spinning) return;
      haptic('light');
      if (spinVeil) spinVeil.classList.remove('show');
    });
  }
  if (spinVeil) {
    spinVeil.addEventListener('click', (e) => {
      if (spinning) return;
      if (e.target === spinVeil) {
        haptic('light');
        spinVeil.classList.remove('show');
      }
    });
  }

  const triggerModalSpin = () => {
    if (spinning) return;
    const doSpin = async () => {
      try {
        const res = await api('/api/play/spin', { method: 'POST' });
        updateState(res);
        buildWheel();
        animateWheel(res.prizeIndex ?? 0, res.prizeAmount ?? 0);
      } catch (e) { /* handled */ }
    };
    playAd('Loading spin…', 'Watch an ad to spin the wheel.', 10, doSpin);
  };

  if (spinModalBtn) spinModalBtn.addEventListener('click', triggerModalSpin);
  if (wheelModalHub) wheelModalHub.addEventListener('click', triggerModalSpin);

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
        }, 1850);
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

export function isGameActive() {
  return spinning || cfBusy;
}
