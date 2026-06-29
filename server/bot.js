import dotenv from 'dotenv';
import { initDB, getUserById, updateUser, addTransaction, unlockAchievement } from './db.js';
import { notifyProActivated } from './services/notifications.js';

// Load environment variables
dotenv.config();

const TOKEN = process.env.BOT_TOKEN;
const DOMAIN = process.env.DOMAIN || 'https://yorubacinemax.xyz';

if (!TOKEN) {
  console.error('[bot] Error: BOT_TOKEN is not defined in .env');
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

/**
 * Helper to call Telegram Bot API methods
 */
async function callTelegram(method, body) {
  try {
    const res = await fetch(`${TELEGRAM_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[bot] Telegram API Error (${method}):`, data);
    }
    return data;
  } catch (err) {
    console.error(`[bot] Request Failed (${method}):`, err);
    return null;
  }
}

let offset = 0;

/**
 * Polling loop to fetch new bot updates
 */
async function pollUpdates() {
  try {
    const data = await callTelegram('getUpdates', {
      offset,
      timeout: 30, // long polling
      allowed_updates: ['message', 'pre_checkout_query']
    });

    if (data && data.ok && data.result) {
      for (const update of data.result) {
        offset = update.update_id + 1;
        if (update.message) {
          await handleMessage(update.message);
        } else if (update.pre_checkout_query) {
          await handlePreCheckoutQuery(update.pre_checkout_query);
        }
      }
    }
  } catch (err) {
    console.error('[bot] Error in polling loop:', err);
  }
  
  // Schedule next poll immediately
  setTimeout(pollUpdates, 500);
}

/**
 * Pre-checkout queries must be answered within 10 seconds.
 * We automatically approve the transaction.
 */
async function handlePreCheckoutQuery(query) {
  console.log(`[bot] Approving pre-checkout query: ${query.id}`);
  await callTelegram('answerPreCheckoutQuery', {
    pre_checkout_query_id: query.id,
    ok: true
  });
}

/**
 * Handle incoming messages from users
 */
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const firstName = msg.from?.first_name || 'Miner';

  if (msg.successful_payment) {
    const payload = msg.successful_payment.invoice_payload;
    console.log(`[bot] Payment successful! Payload: ${payload}`);
    if (payload && payload.startsWith('pro_subscription:')) {
      const userId = parseInt(payload.split(':')[1]);
      try {
        const user = getUserById(userId);
        if (user) {
          const duration = 30 * 24 * 60 * 60 * 1000; // 30 days
          const now = Date.now();
          const currentProUntil = user.pro_until > now ? user.pro_until : now;
          const newProUntil = currentProUntil + duration;

          updateUser(user.id, { pro_until: newProUntil });
          addTransaction(user.id, 'pro_activate', 0, 'Activated 30 days of Pro (Telegram Stars)');
          unlockAchievement(user.id, 'pro_member');

          console.log(`[bot] Pro subscription activated in DB for user ${user.first_name} (ID: ${user.id})`);
          await notifyProActivated(chatId);
          await callTelegram('sendMessage', {
            chat_id: chatId,
            text: `🎉 Thank you! Your payment of 250 Telegram Stars was received. Orael Pro has been activated for 30 days! 🚀`
          });
        } else {
          console.error(`[bot] User ID ${userId} not found for Pro activation`);
        }
      } catch (err) {
        console.error('[bot] Failed to activate Pro in DB:', err);
      }
    }
    return;
  }

  if (text.startsWith('/start')) {
    console.log(`[bot] User ${firstName} (${chatId}) started the bot.`);

    // Extract referral code if user joined via a referral link (/start ref_code)
    const parts = text.split(' ');
    const refParam = parts.length > 1 ? parts[1] : '';

    // Build the launch URL with cache-buster parameter
    // Telegram Mini App passes the start parameter via tg.initDataUnsafe.start_param
    const launchUrl = refParam ? `${DOMAIN}?v=3.0.1&start_app=${refParam}` : `${DOMAIN}?v=3.0.1`;

    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: `Hello ${firstName}! Welcome to Orael 🚀\n\nWatch ads to refuel your mining engine, play games, and earn ORL tokens — cash out to airtime, bank, or USDT!\n\n💰 Earn 25-35 ORL per ad\n🎮 Spin, scratch, coin flip, mystery chest\n🏆 Daily ad challenge: up to +400 ORL bonus\n👥 Refer friends: 8% + 2% lifetime commission\n\n👇 Tap below to start earning!`,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Play Orael 🚀',
              web_app: { url: launchUrl }
            }
          ]
        ]
      }
    });
  }
}

async function startBot() {
  console.log('[bot] Initializing database...');
  await initDB();

  console.log('[bot] Setting Chat Menu Button...');
  await callTelegram('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'Play Orael',
      web_app: { url: `${DOMAIN}?v=3.0.1` }
    }
  });

  console.log('[bot] Starting Telegram Bot polling loop...');
  console.log(`[bot] Target WebApp Domain: ${DOMAIN}`);
  pollUpdates();
}

startBot();
