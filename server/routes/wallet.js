// ─────────────────────────────────────────────────────────────
//  wallet.js — Wallet routes with FULL Flutterwave integration
//  Real bank transfers, real airtime, real webhook handling.
//  No mocks. Production-ready.
// ─────────────────────────────────────────────────────────────

import { Router } from 'express';
import {
  getUser,
  getUserById,
  updateUser,
  addTransaction,
  createWithdrawal,
  getPendingWithdrawalsCount,
  getRecentWithdrawals,
  getWithdrawalById,
  getWithdrawalByReference,
  updateWithdrawalFlutterwave,
  updateWithdrawalStatusById,
  getBankAccounts,
  getBankAccountById,
  saveBankAccount,
  deleteBankAccount,
  getDailyWithdrawalTotal,
  getMonthlyWithdrawalTotal,
  logAudit,
  getOne,
  run,
  flushNow,
  incrementTotalWithdrawn,
  unlockAchievement,
} from '../db.js';
import { accrueMinedORL } from '../services/mining.js';
import { getUserState } from './user.js';
import { getEconomyConfig, isFeatureEnabled } from '../settings.js';
import {
  listBanks,
  resolveAccount,
  createTransfer,
  purchaseAirtime,
  isValidNgPhone,
  normalizeNgPhone,
  generateTransferReference,
  generateAirtimeReference,
  verifyWebhookSignature,
} from '../services/flutterwave.js';
import {
  notifyWithdrawalCompleted,
  notifyWithdrawalFailed,
  notifyWithdrawalPendingApproval,
  notifyAdminsPendingWithdrawal,
} from '../services/notifications.js';
import crypto from 'crypto';
import { checkWithdrawalPattern } from '../services/monitoring.js';

const router = Router();

/* ─── PIN helpers ───────────────────────────────────────────── */
/**
 * Hash a 4-digit PIN using scrypt with a per-user random salt.
 * Returns a self-describing string "scrypt:<saltHex>:<hashHex>" so verify
 * doesn't need the telegram_id. scrypt is memory-hard, making offline brute
 * force of a leaked DB infeasible (unlike the old fast SHA-256 scheme that
 * used the user's PUBLIC telegram_id as the "salt").
 */
function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Verify a PIN against a stored hash, constant-time. Supports the new scrypt
 * format and a legacy SHA-256(telegramId:pin) fallback for pins set before
 * this fix (so existing users aren't locked out on upgrade).
 */
function verifyPin(pin, stored, telegramId) {
  if (!stored) return false;
  if (stored.startsWith('scrypt:')) {
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    if (expected.length === 0) return false;
    const computed = crypto.scryptSync(String(pin), salt, expected.length, { N: 16384, r: 8, p: 1 });
    if (computed.length !== expected.length) return false;
    return crypto.timingSafeEqual(computed, expected);
  }
  // Legacy fallback: SHA-256(telegramId:pin) — constant-time compare.
  const legacy = crypto.createHash('sha256').update(`${telegramId}:${pin}`).digest();
  const storedBuf = Buffer.from(stored, 'hex');
  if (legacy.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(legacy, storedBuf);
}

/* ─── POST /api/wallet/set-pin — set withdrawal PIN ─────────── */

router.post('/set-pin', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { pin } = req.body;
    if (!pin || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    // Don't allow 0000, 1234, etc.
    const weak = ['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321'];
    if (weak.includes(pin)) {
      return res.status(400).json({ error: 'PIN is too weak. Choose a different one.' });
    }

    const hashed = hashPin(pin);
    updateUser(user.id, { withdrawal_pin: hashed });
    flushNow();
    logAudit(user.id, 'user', 'set_withdrawal_pin', user.id, {}, req.ip);

    return res.json({ success: true, message: 'Withdrawal PIN set successfully' });
  } catch (err) {
    console.error('POST /set-pin error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /api/wallet/verify-pin — verify PIN (used by withdraw) ─ */

router.post('/verify-pin', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    if (!user.withdrawal_pin) {
      return res.status(400).json({ error: 'No PIN set. Set your withdrawal PIN first.', needsPin: true });
    }

    const ok = verifyPin(pin, user.withdrawal_pin, telegramUser.id);
    if (!ok) {
      return res.status(403).json({ error: 'Incorrect PIN', valid: false });
    }

    return res.json({ valid: true });
  } catch (err) {
    console.error('POST /verify-pin error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /api/wallet/pro — generate Telegram Stars invoice ──────── */

router.post('/pro', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    let user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const token = process.env.BOT_TOKEN;
    if (!token) {
      return res.status(500).json({ error: 'Telegram Bot token is not configured on the server' });
    }

    const invoiceData = {
      title: 'Orael Pro Subscription',
      description: '2× mining rate · 5% withdrawal fee · Daily free chest (150-200 ORL) · Priority payouts · 30 days',
      payload: `pro_subscription:${user.id}`,
      provider_token: '',
      currency: 'XTR',
      prices: [
        { label: 'Orael Pro (30 Days)', amount: 250 }
      ]
    };

    const teleRes = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoiceData)
    });
    const data = await teleRes.json();

    if (!data.ok) {
      console.error('[payment] createInvoiceLink failed:', data);
      return res.status(500).json({ error: 'Failed to generate Stars payment link from Telegram API' });
    }

    return res.json({ success: true, invoiceLink: data.result });
  } catch (err) {
    console.error('POST /pro error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── GET /api/wallet/methods — available withdrawal methods ──────── */

router.get('/methods', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const country = user.country || null;
    const isNG = !country || country === 'NG';

    const methods = [];
    for (const [key, m] of Object.entries(E.WITHDRAWAL_METHODS)) {
      if (m.countries === 'all' || (Array.isArray(m.countries) && m.countries.includes(country))) {
        methods.push({
          id: key,
          name: m.name,
          minOrl: m.minOrl,
          fiat: m.fiat,
          icon: m.icon
        });
      }
    }

    if (!isNG && !methods.find(m => m.id === 'usdt')) {
      methods.push({ id: 'usdt', ...E.WITHDRAWAL_METHODS.usdt });
    }

    return res.json({ methods, country, isNG });
  } catch (err) {
    console.error('GET /methods error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── GET /api/wallet/banks — list Nigerian banks from Flutterwave ── */

router.get('/banks', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!process.env.FLW_SECRET_KEY) {
      return res.status(500).json({ error: 'Flutterwave is not configured. Contact support.' });
    }

    const banks = await listBanks('NG');
    return res.json({ banks });
  } catch (err) {
    console.error('GET /banks error:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch banks' });
  }
});

/* ─── POST /api/wallet/resolve-account — verify account number ────── */

router.post('/resolve-account', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { account_number, account_bank } = req.body;

    if (!account_number || !account_bank) {
      return res.status(400).json({ error: 'account_number and account_bank are required' });
    }

    if (!/^\d{10}$/.test(account_number)) {
      return res.status(400).json({ error: 'Account number must be exactly 10 digits' });
    }

    if (!process.env.FLW_SECRET_KEY) {
      return res.status(500).json({ error: 'Flutterwave is not configured. Contact support.' });
    }

    const result = await resolveAccount(account_number, account_bank);
    return res.json(result);
  } catch (err) {
    console.error('POST /resolve-account error:', err);
    return res.status(400).json({ error: err.message || 'Could not resolve account name' });
  }
});

/* ─── POST /api/wallet/save-bank — save verified bank account ─────── */

router.post('/save-bank', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { account_number, account_bank, bank_code, bank_name, account_name } = req.body;

    if (!account_number || !account_bank || !bank_code || !bank_name || !account_name) {
      return res.status(400).json({ error: 'All bank details are required' });
    }

    // Limit to 3 saved accounts per user
    const existing = getBankAccounts(user.id);
    if (existing.length >= 3) {
      return res.status(400).json({ error: 'You can only save up to 3 bank accounts' });
    }

    saveBankAccount(user.id, account_number, account_bank, bank_code, bank_name, account_name);
    logAudit(user.id, 'user', 'save_bank_account', user.id, { account_number, bank_name }, req.ip);

    return res.json({ success: true });
  } catch (err) {
    console.error('POST /save-bank error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── GET /api/wallet/bank-accounts — list saved bank accounts ────── */

router.get('/bank-accounts', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const accounts = getBankAccounts(user.id);
    return res.json({ accounts });
  } catch (err) {
    console.error('GET /bank-accounts error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── DELETE /api/wallet/bank-accounts/:id — delete saved account ─── */

router.delete('/bank-accounts/:id', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const accountId = parseInt(req.params.id);
    deleteBankAccount(user.id, accountId);
    logAudit(user.id, 'user', 'delete_bank_account', user.id, { account_id: accountId }, req.ip);

    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /bank-accounts/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /api/wallet/withdraw — create real Flutterwave payout ─── */

router.post('/withdraw', async (req, res) => {
  try {
    if (!isFeatureEnabled('withdrawals_enabled')) {
      return res.status(400).json({ error: 'Withdrawals are temporarily disabled' });
    }
    const telegramUser = req.telegramUser;
    let user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await accrueMinedORL(user);
    user = getUser(telegramUser.id);

    const E = getEconomyConfig();
    const { method: methodKey, walletInfo, bankAccountId, phoneNumber, pin } = req.body;

    /* ── Verify withdrawal PIN ── */
    if (!user.withdrawal_pin) {
      return res.status(400).json({ error: 'Set your withdrawal PIN first.', needsPin: true });
    }
    if (!pin) {
      return res.status(400).json({ error: 'PIN required', needsPin: true });
    }
    if (!verifyPin(pin, user.withdrawal_pin, telegramUser.id)) {
      return res.status(403).json({ error: 'Incorrect PIN' });
    }

    /* ── Validate method ── */
    const methodConfig = E.WITHDRAWAL_METHODS[methodKey];
    if (!methodConfig) {
      return res.status(400).json({ error: 'Invalid withdrawal method' });
    }

    /* ── Country check ── */
    const country = user.country || null;
    const isNG = !country || country === 'NG';
    if (Array.isArray(methodConfig.countries) && !methodConfig.countries.includes(country) && methodConfig.countries !== 'all') {
      return res.status(400).json({ error: 'This withdrawal method is not available in your country' });
    }

    /* ── Check Flutterwave is configured for NG payouts ── */
    if ((methodKey === 'bank' || methodKey === 'airtime') && !process.env.FLW_SECRET_KEY) {
      return res.status(500).json({ error: 'Bank/Airtime withdrawals are not configured. Contact support.' });
    }

    /* ── Validate balance + min ── */
    const minOrl = methodConfig.minOrl;
    if (user.balance < minOrl) {
      return res.status(400).json({ error: `Minimum withdrawal is ${minOrl} ORL` });
    }

    /* ── Validate withdrawal limits (KYC) ── */
    const maxSingle = parseInt(process.env.MAX_SINGLE_WITHDRAWAL_ORL) || 200000;
    const maxDaily = parseInt(process.env.MAX_DAILY_WITHDRAWAL_ORL) || 500000;
    const maxMonthly = parseInt(process.env.MAX_MONTHLY_WITHDRAWAL_ORL) || 5000000;

    const amountOrl = Math.floor(user.balance);
    if (amountOrl > maxSingle) {
      return res.status(400).json({ error: `Maximum single withdrawal is ${maxSingle.toLocaleString()} ORL` });
    }

    const dailyTotal = getDailyWithdrawalTotal(user.id);
    if (dailyTotal + amountOrl > maxDaily) {
      return res.status(400).json({ error: `Daily withdrawal limit is ${maxDaily.toLocaleString()} ORL. You've used ${dailyTotal.toLocaleString()} ORL today.` });
    }

    const monthlyTotal = getMonthlyWithdrawalTotal(user.id);
    if (monthlyTotal + amountOrl > maxMonthly) {
      return res.status(400).json({ error: `Monthly withdrawal limit is ${maxMonthly.toLocaleString()} ORL` });
    }

    /* ── Limit pending withdrawals ── */
    const pendingCount = getPendingWithdrawalsCount(user.id);
    if (pendingCount >= 1) {
      return res.status(400).json({ error: 'You have a pending withdrawal. Wait for it to be processed.' });
    }

    /* ── Calculate fee + net ── */
    const isPro = user.pro_until > Date.now();
    // Airtime is free — 0% network fee. Bank and USDT use standard fees.
    const feePct = method === 'airtime' ? 0 : (isPro ? E.WITHDRAWAL_FEE_PRO_PCT : E.WITHDRAWAL_FEE_PCT);
    const feeOrl = Math.floor(amountOrl * feePct);
    const netOrl = amountOrl - feeOrl;

    /* ── Method-specific validation + Flutterwave call ── */
    let flwResult = null;
    let netFiat = '';
    let walletInfoToStore = '';
    let flwReference = null;
    let needsApproval = false;

    if (methodKey === 'bank') {
      /* ── Bank transfer: require saved bank account or new one ── */
      let bankAccount;
      if (bankAccountId) {
        bankAccount = getBankAccountById(user.id, parseInt(bankAccountId));
        if (!bankAccount) {
          return res.status(400).json({ error: 'Selected bank account not found' });
        }
      } else {
        // Parse walletInfo: "bankCode|accountNumber|accountName|bankName"
        if (!walletInfo) {
          return res.status(400).json({ error: 'Bank account details required' });
        }
        const parts = walletInfo.split('|');
        if (parts.length < 4) {
          return res.status(400).json({ error: 'Invalid bank details format' });
        }
        const [bankCode, accountNumber, accountName, bankName] = parts;
        if (!/^\d{10}$/.test(accountNumber)) {
          return res.status(400).json({ error: 'Invalid account number' });
        }
        // Save for reuse
        saveBankAccount(user.id, accountNumber, bankCode, bankCode, bankName, accountName);
        bankAccount = { account_number: accountNumber, account_bank: bankCode, bank_code: bankCode, bank_name: bankName, account_name: accountName };
      }

      const netNgn = Math.floor(netOrl * E.ORL_TO_NGN);
      if (netNgn < 100) {
        return res.status(400).json({ error: 'Net amount too small for bank transfer (min ₦100)' });
      }

      flwReference = generateTransferReference(user.id);
      netFiat = `₦${netNgn.toLocaleString()}`;
      walletInfoToStore = `${bankAccount.bank_name} • ${bankAccount.account_number} • ${bankAccount.account_name}`;

      // Manual approval for large withdrawals — defer Flutterwave call until admin approves
      if (amountOrl >= E.MANUAL_APPROVAL_THRESHOLD_ORL) {
        needsApproval = true;
      } else {
        // Initiate real Flutterwave transfer
        try {
          flwResult = await createTransfer({
            account_bank: bankAccount.bank_code,
            account_number: bankAccount.account_number,
            amount: netNgn,
            narration: `Orael payout — ${user.first_name || 'User'} ${user.id}`,
            reference: flwReference,
            beneficiary_name: bankAccount.account_name,
            callback_url: `${process.env.DOMAIN}/api/flutterwave-webhook`,
          });
        } catch (flwErr) {
          console.error('[withdraw] Flutterwave transfer failed:', flwErr.message);
          return res.status(400).json({ error: `Bank transfer failed: ${flwErr.message}` });
        }
      }

    } else if (methodKey === 'airtime') {
      /* ── Airtime: require phone number ── */
      const phone = phoneNumber || walletInfo;
      if (!phone) {
        return res.status(400).json({ error: 'Phone number is required for airtime' });
      }
      if (!isValidNgPhone(phone)) {
        return res.status(400).json({ error: 'Invalid Nigerian phone number. Use format: 08012345678' });
      }
      const normalizedPhone = normalizeNgPhone(phone);

      const netNgn = Math.floor(netOrl * E.ORL_TO_NGN);
      if (netNgn < 50) {
        return res.status(400).json({ error: 'Net amount too small for airtime (min ₦50)' });
      }

      flwReference = generateAirtimeReference(user.id);
      netFiat = `₦${netNgn.toLocaleString()} airtime to ${normalizedPhone}`;
      walletInfoToStore = normalizedPhone;

      // Manual approval for large airtime withdrawals too
      if (amountOrl >= E.MANUAL_APPROVAL_THRESHOLD_ORL) {
        needsApproval = true;
      } else {
        // Initiate real Flutterwave airtime purchase
        try {
          flwResult = await purchaseAirtime({
            phone: normalizedPhone,
            amount: netNgn,
            reference: flwReference,
          });
        } catch (flwErr) {
          console.error('[withdraw] Flutterwave airtime failed:', flwErr.message);
          return res.status(400).json({ error: `Airtime purchase failed: ${flwErr.message}` });
        }
      }

    } else if (methodKey === 'usdt') {
      /* ── USDT: always manual processing (TRC20) — store wallet info ── */
      if (!walletInfo) {
        return res.status(400).json({ error: 'USDT TRC20 wallet address is required' });
      }
      if (!/^T[A-Za-z0-9]{33,34}$/.test(walletInfo)) {
        return res.status(400).json({ error: 'Invalid USDT TRC20 wallet address (must start with T)' });
      }
      const netUsd = netOrl / E.ORL_PER_USD;
      netFiat = `$${netUsd.toFixed(2)} USDT`;
      walletInfoToStore = `TRC20: ${walletInfo}`;
      // USDT is always manual — admin will process via admin panel
      needsApproval = true;
    }

    /* ── Monitoring: check for suspicious withdrawal patterns ── */
    checkWithdrawalPattern(user, amountOrl);

    /* ── Deduct from balance ── */
    const newBalance = user.balance - amountOrl;
    updateUser(user.id, { balance: newBalance });

    /* ── Create withdrawal record ── */
    const withdrawalInfo = createWithdrawal(
      user.id,
      methodKey,
      amountOrl,
      feeOrl,
      netOrl,
      walletInfoToStore
    );
    const withdrawalId = withdrawalInfo.lastInsertRowid;

    /* ── Update with Flutterwave data if applicable ── */
    if (flwResult) {
      updateWithdrawalFlutterwave(
        withdrawalId,
        flwResult.id,
        flwReference,
        flwResult.status
      );
    }

    /* ── Set status based on approval + method ── */
    let initialStatus = 'pending';
    if (needsApproval) {
      // Large withdrawal or USDT — needs admin approval
      initialStatus = 'needs_approval';
    } else if (methodKey === 'airtime' && flwResult) {
      // Airtime is usually instant
      initialStatus = (flwResult.status === 'success') ? 'completed' : 'pending';
    } else if (methodKey === 'bank' && flwResult) {
      // Bank transfer starts as pending, finalized via webhook
      initialStatus = 'pending';
    }
    updateWithdrawalStatusById(withdrawalId, initialStatus);

    /* ── Track totals + achievements ── */
    incrementTotalWithdrawn(user.id, amountOrl);
    unlockAchievement(user.id, 'first_withdrawal');

    /* ── Log transaction + audit ── */
    addTransaction(user.id, 'withdraw', -amountOrl, `Withdrawal via ${methodConfig.name} (${netFiat})`);
    logAudit(user.id, 'user', 'withdrawal_request', user.id, {
      withdrawal_id: withdrawalId,
      method: methodKey,
      amount_orl: amountOrl,
      net_fiat: netFiat,
      flw_reference: flwReference,
      needs_approval: needsApproval,
    }, req.ip);

    // CRITICAL WRITE — persist immediately so a crash can't lose the balance
    // deduction / withdrawal record (which represents real money movement).
    flushNow();

    /* ── Send notifications ── */
    if (needsApproval) {
      // Notify user it's pending approval
      await notifyWithdrawalPendingApproval(telegramUser.id, amountOrl, methodConfig.name);
      // Notify admins
      await notifyAdminsPendingWithdrawal(amountOrl, methodConfig.name, user.first_name || `User ${user.id}`);
    } else if (initialStatus === 'completed') {
      // Airtime usually instant — notify user of completion
      await notifyWithdrawalCompleted(telegramUser.id, amountOrl, methodKey, netFiat);
    }

    const state = await getUserState(telegramUser.id);
    return res.json({
      success: true,
      message: needsApproval
        ? `Withdrawal of ${amountOrl} ORL requires admin approval. You'll be notified once processed.`
        : methodKey === 'airtime'
          ? `Airtime of ${netFiat} sent successfully!`
          : methodKey === 'bank'
            ? `Bank transfer of ${netFiat} initiated. You'll receive it within 24h.`
            : `Withdrawal request created.`,
      withdrawalId,
      amountOrl,
      feeOrl,
      netOrl,
      netFiat,
      needsApproval,
      flwReference,
      user: state
    });
  } catch (err) {
    console.error('POST /withdraw error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /api/flutterwave-webhook — Flutterwave callbacks ───────── */
// PUBLIC endpoint — no Telegram auth, signature-verified instead.
// Mounted at the app level (not under /api/wallet which requires Telegram auth).

export async function handleFlutterwaveWebhook(req, res) {
  try {
    // Verify signature
    if (!verifyWebhookSignature(req.headers)) {
      console.warn('[flutterwave-webhook] Invalid signature — rejecting');
      return res.status(401).send('Invalid signature');
    }

    const { event, event: eventType, data } = req.body;

    console.log(`[flutterwave-webhook] Received event: ${event}`);

    /* ── Handle transfer.completed ── */
    if (event === 'transfer.completed' && data) {
      const flwReference = data.reference;
      const transferStatus = data.status; // SUCCESSFUL | FAILED | PENDING

      // Find our withdrawal by Flutterwave reference
      const withdrawal = getWithdrawalByReference(flwReference);
      if (!withdrawal) {
        console.warn(`[flutterwave-webhook] No withdrawal found for reference ${flwReference}`);
        return res.status(200).send('OK'); // Acknowledge to stop retries
      }

      // Idempotency: skip if already finalized
      if (withdrawal.status === 'completed' || withdrawal.status === 'rejected') {
        console.log(`[flutterwave-webhook] Withdrawal ${withdrawal.id} already ${withdrawal.status} — skipping`);
        return res.status(200).send('OK');
      }

      if (transferStatus === 'SUCCESSFUL') {
        updateWithdrawalStatusById(withdrawal.id, 'completed', data.complete_message || null);
        addTransaction(withdrawal.user_id, 'withdraw_completed', 0, `Withdrawal #${withdrawal.id} completed via Flutterwave`);
        logAudit(null, 'system', 'withdrawal_completed', withdrawal.user_id, {
          withdrawal_id: withdrawal.id,
          flw_reference: flwReference,
          amount: data.amount,
        }, null);
        console.log(`[flutterwave-webhook] Withdrawal ${withdrawal.id} marked completed`);

        // Notify user
        const user = getUserById(withdrawal.user_id);
        if (user) {
          await notifyWithdrawalCompleted(user.telegram_id, withdrawal.amount_orl, withdrawal.method, withdrawal.net_fiat || '');
        }
      } else if (transferStatus === 'FAILED') {
        // Refund the user
        updateWithdrawalStatusById(withdrawal.id, 'rejected', data.complete_message || 'Transfer failed');
        const user = getUserById(withdrawal.user_id);
        if (user) {
          updateUser(user.id, { balance: user.balance + withdrawal.amount_orl });
          addTransaction(user.id, 'withdraw_refund', withdrawal.amount_orl, `Withdrawal #${withdrawal.id} failed — refunded`);
          await notifyWithdrawalFailed(user.telegram_id, withdrawal.amount_orl, data.complete_message);
        }
        logAudit(null, 'system', 'withdrawal_failed', withdrawal.user_id, {
          withdrawal_id: withdrawal.id,
          flw_reference: flwReference,
          reason: data.complete_message,
        }, null);
        console.log(`[flutterwave-webhook] Withdrawal ${withdrawal.id} failed — user refunded`);
      } else {
        // PENDING or other — update flw_status only, don't change main status
        run('UPDATE withdrawals SET flw_status = ? WHERE id = ?', [transferStatus, withdrawal.id]);
      }
    }

    /* ── Handle bill payment (airtime) webhooks ── */
    if (event === 'singlebillpayment.status' && data) {
      const flwReference = data.reference || data.customer_reference;
      const withdrawal = getWithdrawalByReference(flwReference);
      if (withdrawal) {
        if (data.status === 'success') {
          updateWithdrawalStatusById(withdrawal.id, 'completed', data.message || null);
        } else if (data.status === 'failed') {
          updateWithdrawalStatusById(withdrawal.id, 'rejected', data.message || 'Airtime failed');
          const user = getUserById(withdrawal.user_id);
          if (user) {
            updateUser(user.id, { balance: user.balance + withdrawal.amount_orl });
            addTransaction(user.id, 'withdraw_refund', withdrawal.amount_orl, `Airtime #${withdrawal.id} failed — refunded`);
          }
        }
      }
    }

    // Always acknowledge with 200
    return res.status(200).send('OK');
  } catch (err) {
    console.error('[flutterwave-webhook] Error:', err);
    return res.status(500).send('Error');
  }
}

/* ─── GET /api/wallet/withdrawals — paginated withdrawal history ──── */

router.get('/withdrawals', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const withdrawals = getRecentWithdrawals(user.id, limit);
    const total = getOne('SELECT COUNT(*) AS cnt FROM withdrawals WHERE user_id = ?', [user.id])?.cnt || 0;

    return res.json({
      withdrawals,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('GET /withdrawals error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── GET /api/wallet/withdrawal/:id — check withdrawal status ────── */

router.get('/withdrawal/:id', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const withdrawalId = parseInt(req.params.id);
    const withdrawal = getWithdrawalById(withdrawalId);
    if (!withdrawal || withdrawal.user_id !== user.id) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    return res.json({ withdrawal });
  } catch (err) {
    console.error('GET /withdrawal/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
