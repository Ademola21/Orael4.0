/* ========================================================================
   earn.js — Earn screen UI actions
   Tasks, featured tasks, daily streak, faucet, and referral buttons.
   (Offerwall section removed — those networks don't support Telegram.)
   ======================================================================== */

import { api } from './api.js';
import { playAd } from './ads.js';
import { getState, updateState, setLocal } from './state.js';
import { $, render, toast, reward, fmt, fmtInt, naira } from './ui.js';
import { haptic, shareLink, openLink } from './telegram.js';

/* ---- SVG icon constants ---- */
const icoPlay = `<svg viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7L8 5z" fill="#e0a25b"/></svg>`;
const icoStar = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l2.5 5.5 6 .5-4.5 4 1.4 5.9L12 16.8 6.6 18.9 8 13 3.5 9l6-.5L12 3z" fill="#e0a25b"/></svg>`;

/* ---- Social media platform icons ---- */
const SOCIAL_ICONS = {
  twitter: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  telegram: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>`,
  discord: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  quiz: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

/* Detect platform from URL and return the appropriate icon */
function getTaskIcon(id, url) {
  if (id === 't3') return SOCIAL_ICONS.quiz;
  if (!url) return icoPlay;
  const u = url.toLowerCase();
  if (u.includes('x.com') || u.includes('twitter.com')) return SOCIAL_ICONS.twitter;
  if (u.includes('t.me') || u.includes('telegram')) return SOCIAL_ICONS.telegram;
  if (u.includes('youtube.com') || u.includes('youtu.be')) return SOCIAL_ICONS.youtube;
  if (u.includes('instagram.com')) return SOCIAL_ICONS.instagram;
  if (u.includes('discord.com') || u.includes('discord.gg')) return SOCIAL_ICONS.discord;
  if (u.includes('tiktok.com')) return SOCIAL_ICONS.tiktok;
  return SOCIAL_ICONS.globe;
}

/* ---- Helpers ---- */

function chipFor(done, label) {
  return `<div class="chip-go">${done ? 'Done' : label}</div>`;
}

/* ========================================================================
   RENDER FUNCTIONS
   ======================================================================== */

export function renderTasks() {
  const S = getState();
  const tasks = S.tasks && S.tasks.length ? S.tasks : [];
  const featured = S.featuredTasks && S.featuredTasks.length ? S.featuredTasks : [];
  const completed = S.completedTasks || {};

  // Tasks list
  const taskListEl = $('taskList');
  if (taskListEl) {
    if (tasks.length) {
      taskListEl.innerHTML = tasks.map(t => `
        <div class="item ${completed[t.id] ? 'done' : ''}" data-kind="tasks" data-id="${t.id}" data-r="${t.r}" data-url="${t.url || ''}">
          <div class="item-ic">${getTaskIcon(t.id, t.url)}</div>
          <div class="item-body"><div class="item-title">${t.title}</div><div class="item-sub">${t.sub}</div></div>
          ${chipFor(completed[t.id], '+' + t.r + ' ORL')}</div>`).join('');
    } else {
      taskListEl.innerHTML = `<div style="text-align:center;padding:15px;color:var(--ink-soft);font-size:13px">Loading tasks...</div>`;
    }
  }

  // Featured list
  const featListEl = $('featuredList');
  if (featListEl) {
    if (featured.length) {
      featListEl.innerHTML = featured.map(t => `
        <div class="item featured ${completed[t.id] ? 'done' : ''}" data-kind="featured" data-id="${t.id}" data-r="${t.r}" data-url="${t.url || ''}">
          <div class="item-ic">${getTaskIcon(t.id, t.url)}</div>
          <div class="item-body"><div class="item-title">${t.title}</div><div class="item-sub">${t.sub}</div></div>
          ${chipFor(completed[t.id], '+' + t.r + ' ORL')}</div>`).join('');
    } else {
      featListEl.innerHTML = `<div style="text-align:center;padding:15px;color:var(--ink-soft);font-size:13px">Loading featured tasks...</div>`;
    }
  }

  // Wire click handlers
  document.querySelectorAll('[data-kind="tasks"], [data-kind="featured"]').forEach(el => {
    el.addEventListener('click', () => {
      const { kind, id, url } = el.dataset;
      const r = parseInt(el.dataset.r);
      const S = getState();
      const completedMap = S.completedTasks || {};
      if (completedMap[id]) return;

      if (id === 't3') {
        haptic('light');
        triggerDailyQuiz();
        return;
      }

      if (url) {
        openLink(url);
      }

      const label = 'Verifying task…';
      playAd(label, 'Reward credits when you complete it.', 10, async () => {
        try {
          const res = await api('/api/earn/task', {
            method: 'POST',
            body: { taskId: id, kind },
          });
          updateState(res);
          renderTasks();
          render();
          reward(r, 'Reward earned', 'Nice. Keep stacking ORL.');
        } catch (e) { /* handled */ }
      });
    });
  });
}

async function triggerDailyQuiz() {
  try {
    const data = await api('/api/earn/quiz/question');
    
    const veil = document.createElement('div');
    veil.className = 'modal-veil';
    veil.id = 'quizModalVeil';
    veil.style.cssText = 'display: flex; opacity: 1; pointer-events: auto; justify-content: center; align-items: center; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.7); z-index: 10000;';
    
    const optionsHTML = data.options.map(opt => `
      <button class="btn quiz-opt-btn" data-option="${opt}" style="width: 100%; text-align: center; padding: 12px; border: 1px solid var(--line); background: var(--bg-inset); color: var(--ink); border-radius: 12px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; margin: 0; outline: none;">
        ${opt}
      </button>
    `).join('');

    veil.innerHTML = `
      <div class="modal" style="max-width: 340px; width: 90%; text-align: left; padding: 24px; background: var(--bg-panel); border-radius: 20px; border: 1px solid var(--line); box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <h3 style="margin-top: 0; margin-bottom: 8px; font-family: var(--font-display); color: var(--gold-1); font-size: 18px; text-align: center; font-weight: 700;">Daily Quiz</h3>
        <p style="font-size: 12px; line-height: 1.45; color: var(--ink-soft); text-align: center; margin-top: 0; margin-bottom: 20px;">Answer today's question correctly to earn 35 ORL!</p>
        
        <div style="font-family: var(--font-display); font-size: 14.5px; font-weight: 600; color: var(--ink); margin-bottom: 18px; line-height: 1.4; text-align: center;">
          ${data.question}
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
          ${optionsHTML}
        </div>
        
        <button class="btn btn-ghost" id="quizModalCancel" style="width: 100%; border: 1px solid var(--line); margin: 0;">Close</button>
      </div>
    `;
    
    document.body.appendChild(veil);
    
    // Wire close button
    const closeBtn = document.getElementById('quizModalCancel');
    closeBtn.addEventListener('click', () => {
      haptic('light');
      veil.remove();
    });

    // Wire option buttons
    veil.querySelectorAll('.quiz-opt-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        haptic('medium');
        const selected = btn.dataset.option;
        btn.style.borderColor = 'var(--gold-1)';
        btn.style.background = 'rgba(224, 162, 91, 0.1)';
        
        try {
          const res = await api('/api/earn/quiz/submit', {
            method: 'POST',
            body: { questionId: data.questionId, answer: selected }
          });
          
          veil.remove();
          updateState(res.user);
          renderTasks();
          render();
          reward(res.reward, 'Daily quiz completed', 'Nice. Keep stacking ORL.');
        } catch (e) {
          btn.style.borderColor = 'var(--red)';
          btn.style.background = 'rgba(235, 87, 87, 0.1)';
          toast('Incorrect Answer', e.message || 'Incorrect answer. Try again tomorrow!', 'error');
          setTimeout(() => {
            veil.remove();
          }, 1500);
        }
      });
    });
    
  } catch (err) {
    toast('Daily Quiz', err.message || 'Already completed today or unavailable.', 'info');
  }
}

export function renderStreak() {
  const S = getState();
  const el = $('streakStrip');
  if (!el) return;

  const STREAK_AMOUNTS = (S.streakAmounts && S.streakAmounts.length)
    ? S.streakAmounts
    : [40, 70, 110, 170, 240, 330, 440];

  el.innerHTML = STREAK_AMOUNTS.map((a, i) => {
    const day = i + 1;
    const isClaimed = day < S.streakDay || (day === S.streakDay && S.streakClaimedToday);
    const isToday = day === S.streakDay && !S.streakClaimedToday;
    const cls = isClaimed ? 'claimed' : isToday ? 'today' : '';
    return `<div class="day ${cls}" ${isToday ? 'id="streakClaim"' : ''}><div>D${day}</div><div class="d-amt">${a}</div></div>`;
  }).join('');

  const claimEl = $('streakClaim');
  if (claimEl) {
    claimEl.addEventListener('click', async () => {
      try {
        haptic('light');
        const res = await api('/api/earn/streak', { method: 'POST' });
        updateState(res.user);
        render();
        renderStreak();
        toast('Daily streak claimed', `+${STREAK_AMOUNTS[(S.streakDay || 1) - 1]} ORL`);
      } catch (e) { /* handled */ }
    });
  }
}

/* ========================================================================
   VIDEO WALL (NEW) — unlimited watch & earn
   ======================================================================== */

function setupVideoWall() {
  const videoWallBtn = $('videoWallBtn');
  if (!videoWallBtn) return;

  videoWallBtn.addEventListener('click', () => {
    playAd('Video ad loading…', 'Watch to earn 30 ORL.', 15, async () => {
      try {
        const res = await api('/api/earn/video-wall', { method: 'POST' });
        updateState(res.user || res);
        render();
        toast('Video reward', `+${res.reward || 30} ORL`);
      } catch (e) { /* handled */ }
    });
  });
}

/* ========================================================================
   FAUCET + REFERRAL
   ======================================================================== */

function setupFaucet() {
  const faucetBtn = $('faucetBtn');
  if (!faucetBtn) return;

  faucetBtn.addEventListener('click', () => {
    const S = getState();
    const elapsed = Date.now() - (S.faucetLast || 0);
    if (elapsed < 60 * 60 * 1000) return;

    playAd('Claiming bonus…', 'Your hourly drip is loading.', 10, async () => {
      try {
        const res = await api('/api/earn/faucet', { method: 'POST' });
        updateState(res);
        render();
        toast('Hourly bonus', `+${res.reward || 20} ORL`);
      } catch (e) { /* handled */ }
    });
  });
}

function setupReferral() {
  const copyBtn = $('copyRef');
  const shareBtn = $('shareRef');
  const refCodeEl = $('refCode');

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const code = refCodeEl?.textContent || '';
      navigator.clipboard?.writeText(code);
      toast('Invite link copied', 'Share it anywhere');
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const code = refCodeEl?.textContent || '';
      const url = code.startsWith('http') ? code : 'https://' + code;
      shareLink(url, 'Mine ORL free on Orael ⛏️');
      toast('Link shared', '');
    });
  }
}

/* ========================================================================
   ADSGRAM TASKS
   ======================================================================== */

function renderAdsgramTasks() {
  const container = $('adsgramTaskList');
  if (!container) return;

  const blockId = import.meta.env.VITE_ADSGRAM_TASK_BLOCK_ID;
  if (!blockId) {
    container.innerHTML = `<div style="font-size:12px;color:var(--ink-soft);text-align:center;width:100%">No Adsgram tasks configured.</div>`;
    return;
  }

  const isDebug = 'false';

  const taskEl = document.createElement('adsgram-task');
  taskEl.setAttribute('data-block-id', blockId);
  taskEl.setAttribute('data-debug', isDebug);
  taskEl.setAttribute('data-debug-console', 'false');
  taskEl.className = 'task';

  const handleReward = async (event) => {
    console.log('[Adsgram Task] Completed! Detail:', event.detail);
    haptic('success');
    toast('Task completed!', 'Updating balance...');

    // Immediately update card to show a refreshing/loading state
    container.innerHTML = `
      <div style="font-size:13px;color:var(--ink-soft);text-align:center;padding:12px 0;">
        Checking for next available task...
      </div>
    `;

    // Reload the Adsgram task widget to load the next task (or show empty state if none are left)
    setTimeout(() => {
      renderAdsgramTasks();
    }, 1000);

    // Wait 2.5 seconds for server S2S webhook to complete and credit balance, then sync local state
    setTimeout(async () => {
      try {
        const res = await api('/api/user');
        updateState(res);
        render();
        toast('Success!', 'Reward credited to your balance.');
      } catch (e) {
        console.error('Failed to sync after ad completion:', e);
      }
    }, 2500);
  };

  // Per AdsGram docs, the <adsgram-task> web component emits exactly 4 events:
  // `reward`, `onError`, `onBannerNotFound`, `onTooLongSession`. (`onReward` is
  // an AdController event for rewarded VIDEO, not a task event — the old
  // listener was dead code and has been removed.)
  taskEl.addEventListener('reward', handleReward);

  taskEl.addEventListener('onBannerNotFound', () => {
    console.log('[Adsgram Task] No banner found.');
    container.innerHTML = `
      <div style="font-size:13px;color:var(--ink-soft);text-align:center;padding:12px 0;">
        All tasks completed! Come back later.
      </div>
    `;
  });

  taskEl.addEventListener('onTooLongSession', () => {
    container.innerHTML = `
      <div style="font-size:13px;color:var(--ink-soft);text-align:center;padding:12px 0;">
        Session too long — restart the app to load fresh tasks.
      </div>
    `;
  });

  taskEl.addEventListener('onError', (err) => {
    console.error('[Adsgram Task] Error:', err);
    container.innerHTML = `
      <div style="font-size:13px;color:var(--ink-soft);text-align:center;padding:12px 0;">
        No tasks available at the moment.
      </div>
    `;
  });

  container.innerHTML = '';
  container.appendChild(taskEl);
}

/* ========================================================================
   MAIN SETUP
   ======================================================================== */

/**
 * Set up all Earn screen event listeners and initial renders.
 */
export function setupEarn() {
  renderTasks();
  renderAdsgramTasks();
  renderStreak();
  setupVideoWall();
  setupFaucet();
  setupReferral();
}
