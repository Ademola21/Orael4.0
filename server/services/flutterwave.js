// ─────────────────────────────────────────────────────────────
//  flutterwave.js — Flutterwave v3 API client for Orael
//  Real API calls for: list banks, resolve account, transfer,
//  airtime purchase, get transfer status, verify webhook signature.
//  No mocks. Production-ready.
// ─────────────────────────────────────────────────────────────
//
//  AUTH: Bearer FLW_SECRET_KEY on all calls.
//  WEBHOOK: verify `verif-hash` header == FLW_SECRET_HASH (direct compare, NOT HMAC).
//  TRANSFER FLOW: create → status=NEW → webhook fires transfer.completed
//                 with data.status = SUCCESSFUL | FAILED.
//  RATE LIMIT: 500 req/min. Implement exponential backoff on 429.
//  IDEMPOTENCY: send X-Idempotency-Key on retries to avoid duplicates.
// ─────────────────────────────────────────────────────────────

const FLW_BASE = 'https://api.flutterwave.com/v3';

/**
 * Get the Flutterwave secret key from env.
 * @returns {string}
 */
function getSecretKey() {
  const key = process.env.FLW_SECRET_KEY;
  if (!key) {
    throw new Error('FLW_SECRET_KEY is not set in environment');
  }
  return key;
}

/**
 * Core Flutterwave API caller with retry-on-429 + idempotency.
 *
 * @param {string} path - e.g. '/transfers' (must start with /)
 * @param {object} opts - { method, body, idempotencyKey }
 * @returns {Promise<object>} parsed JSON response
 */
async function flwRequest(path, opts = {}) {
  const key = getSecretKey();
  const method = opts.method || 'GET';
  const headers = {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (opts.idempotencyKey) {
    headers['X-Idempotency-Key'] = opts.idempotencyKey;
  }

  const fetchOpts = { method, headers };
  if (opts.body) {
    fetchOpts.body = JSON.stringify(opts.body);
  }

  let lastErr = null;
  // Retry up to 3 times on 429 (rate limit) with exponential backoff + jitter
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${FLW_BASE}${path}`, fetchOpts);

      // Handle non-JSON responses (Cloudflare 1015, etc.)
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        if (res.status === 429 || res.status === 503) {
          // Rate limited or service unavailable — back off and retry
          lastErr = new Error(`Flutterwave rate limited (HTTP ${res.status}): ${text.slice(0, 200)}`);
          await sleep(Math.pow(2, attempt) * 1000 + Math.random() * 500);
          continue;
        }
        throw new Error(`Flutterwave returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
      }

      const data = await res.json();

      // Rate limit — back off
      if (res.status === 429) {
        lastErr = new Error(`Flutterwave rate limited: ${data.message || 'Too many requests'}`);
        await sleep(Math.pow(2, attempt) * 1000 + Math.random() * 500);
        continue;
      }

      // Non-2xx — surface the error
      if (!res.ok) {
        const errMsg = data.message || data.error?.message || `HTTP ${res.status}`;
        const err = new Error(`Flutterwave API error: ${errMsg}`);
        err.flwResponse = data;
        err.httpStatus = res.status;
        throw err;
      }

      return data;
    } catch (err) {
      // Network error or fetch failure — retry with backoff
      if (err.flwResponse || err.message.startsWith('Flutterwave returned non-JSON')) {
        throw err;
      }
      lastErr = err;
      if (attempt < 2) {
        await sleep(Math.pow(2, attempt) * 1000 + Math.random() * 500);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Flutterwave request failed after retries');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ─── 1. List Banks (Nigeria) ───────────────────────────────── */
/**
 * Fetch all Nigerian banks from Flutterwave.
 * Caches for 1 hour to stay under rate limit.
 *
 * @returns {Promise<Array<{id:number, code:string, name:string}>>}
 */
let banksCache = null;
let banksCacheTime = 0;
const BANKS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const NG_FALLBACK_BANKS = [
  { code: '044', name: 'Access Bank' },
  { code: '058', name: 'Guaranty Trust Bank (GTBank)' },
  { code: '057', name: 'Zenith Bank' },
  { code: '033', name: 'United Bank for Africa (UBA)' },
  { code: '011', name: 'First Bank of Nigeria (FirstBank)' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '214', name: 'First City Monument Bank (FCMB)' },
  { code: '050', name: 'Ecobank Nigeria' },
  { code: '032', name: 'Union Bank of Nigeria' },
  { code: '035', name: 'Wema Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '219', name: 'Stanbic IBTC Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '101', name: 'Providus Bank' },
  { code: '103', name: 'Globus Bank' },
  { code: '100', name: 'SunTrust Bank' },
  { code: '215', name: 'Unity Bank' },
  { code: '301', name: 'Jaiz Bank' },
  { code: '302', name: 'TAJ Bank' },
  { code: '303', name: 'Lotus Bank' },
  { code: '102', name: 'Titan Trust Bank' },
  { code: '104', name: 'PremiumTrust Bank' },
  { code: '50515', name: 'Moniepoint MFB' },
  { code: '999992', name: 'OPay' },
  { code: '999991', name: 'PalmPay' },
  { code: '090267', name: 'Kuda Bank' },
  { code: '51341', name: 'VFD Microfinance Bank' }
];

export async function listBanks(country = 'NG') {
  // Return cache if fresh
  if (banksCache && Date.now() - banksCacheTime < BANKS_CACHE_TTL) {
    return banksCache;
  }

  try {
    const res = await flwRequest(`/banks/${country}`);
    if (res.status === 'success' && Array.isArray(res.data)) {
      banksCache = res.data;
      banksCacheTime = Date.now();
      return banksCache;
    }
  } catch (err) {
    console.error(`[flutterwave] Failed to fetch bank list: ${err.message}. Using fallback list.`);
    if (banksCache) {
      return banksCache;
    }
  }

  // Return fallback banks if Flutterwave API failed or returned bad data
  return NG_FALLBACK_BANKS;
}

/* ─── 2. Resolve Account Number → Account Name ─────────────── */
/**
 * Verify a bank account number and get the account holder's name.
 *
 * @param {string} accountNumber - 10-digit NUBAN
 * @param {string} accountBank - bank code (e.g. "044" for Access Bank)
 * @returns {Promise<{account_number:string, account_name:string}>}
 */
export async function resolveAccount(accountNumber, accountBank) {
  if (!accountNumber || !accountBank) {
    throw new Error('account_number and account_bank are required');
  }
  if (!/^\d{10}$/.test(accountNumber)) {
    throw new Error('account_number must be exactly 10 digits');
  }

  const res = await flwRequest('/accounts/resolve', {
    method: 'POST',
    body: {
      account_number: accountNumber,
      account_bank: accountBank,
    },
  });

  if (res.status !== 'success' || !res.data) {
    throw new Error(res.message || 'Could not resolve account name');
  }

  return {
    account_number: res.data.account_number,
    account_name: res.data.account_name,
  };
}

/* ─── 3. Transfer to Bank Account ───────────────────────────── */
/**
 * Initiate a bank transfer via Flutterwave.
 * Returns immediately with status=NEW. Final status arrives via webhook.
 *
 * @param {object} params
 * @param {string} params.account_bank - bank code
 * @param {string} params.account_number - 10-digit NUBAN
 * @param {number} params.amount - amount in NGN (kobo not needed — Flutterwave uses naira)
 * @param {string} params.narration - description
 * @param {string} params.reference - unique merchant reference (used for idempotency + tracking)
 * @param {string} [params.beneficiary_name] - recipient name
 * @param {string} [params.callback_url] - webhook URL override
 * @returns {Promise<{id:number, status:string, reference:string}>}
 */
export async function createTransfer(params) {
  if (!params.account_bank || !params.account_number || !params.amount || !params.reference) {
    throw new Error('account_bank, account_number, amount, and reference are required');
  }

  const body = {
    account_bank: params.account_bank,
    account_number: params.account_number,
    amount: Math.round(params.amount), // Flutterwave expects naira as integer
    narration: params.narration || 'Orael payout',
    currency: 'NGN',
    reference: params.reference,
    debit_currency: 'NGN',
  };
  if (params.beneficiary_name) body.beneficiary_name = params.beneficiary_name;
  if (params.callback_url) body.callback_url = params.callback_url;

  const res = await flwRequest('/transfers', {
    method: 'POST',
    body,
    idempotencyKey: params.reference, // idempotent on our reference
  });

  if (res.status !== 'success' || !res.data) {
    throw new Error(res.message || 'Transfer creation failed');
  }

  return {
    id: res.data.id,
    status: res.data.status, // will be 'NEW'
    reference: res.data.reference,
    fee: res.data.fee,
    amount: res.data.amount,
    bank_name: res.data.bank_name,
  };
}

/* ─── 4. Get Transfer Status (polling fallback) ────────────── */
/**
 * Poll the status of a transfer by its Flutterwave ID.
 *
 * @param {number} transferId - the data.id returned by createTransfer
 * @returns {Promise<{id:number, status:string, reference:string, complete_message:string}>}
 */
export async function getTransferStatus(transferId) {
  if (!transferId) throw new Error('transferId is required');

  const res = await flwRequest(`/transfers/${transferId}`);

  if (res.status !== 'success' || !res.data) {
    throw new Error(res.message || 'Failed to fetch transfer status');
  }

  // Note: webhook uses `fullname`, polling uses `full_name` — normalize
  return {
    id: res.data.id,
    status: res.data.status, // SUCCESSFUL | FAILED | PENDING | NEW | CANCELLED
    reference: res.data.reference,
    amount: res.data.amount,
    fee: res.data.fee,
    bank_name: res.data.bank_name,
    account_number: res.data.account_number,
    full_name: res.data.full_name || res.data.fullname, // handle both
    complete_message: res.data.complete_message,
    created_at: res.data.created_at,
  };
}

/* ─── 5. Airtime Purchase (Bills Payment) ───────────────────── */
/**
 * Purchase airtime for a Nigerian phone number.
 *
 * @param {object} params
 * @param {string} params.phone - phone number in +234... or 0XX... format
 * @param {number} params.amount - amount in NGN
 * @param {string} params.reference - unique merchant reference
 * @returns {Promise<{status:string, flw_ref:string, tx_ref:string, network:string}>}
 */
export async function purchaseAirtime(params) {
  if (!params.phone || !params.amount || !params.reference) {
    throw new Error('phone, amount, and reference are required');
  }

  // Normalize phone to +234 format
  let phone = params.phone.trim().replace(/\s/g, '');
  if (phone.startsWith('0')) {
    phone = '+234' + phone.slice(1);
  } else if (phone.startsWith('234') && !phone.startsWith('+')) {
    phone = '+' + phone;
  } else if (!phone.startsWith('+')) {
    phone = '+234' + phone;
  }

  const body = {
    country: 'NG',
    customer: phone,
    amount: Math.round(params.amount),
    recurrence: 'ONCE',
    type: 'AIRTIME',
    reference: params.reference,
  };

  const res = await flwRequest('/bills', {
    method: 'POST',
    body,
    idempotencyKey: params.reference,
  });

  if (res.status !== 'success' || !res.data) {
    throw new Error(res.message || 'Airtime purchase failed');
  }

  // Airtime is usually instant — data.status tells us the result
  return {
    status: res.data.status || 'success',
    flw_ref: res.data.flw_ref,
    tx_ref: res.data.tx_ref,
    network: res.data.network,
    phone_number: res.data.phone_number,
    amount: res.data.amount,
    reference: res.data.reference,
  };
}

/* ─── 6. Webhook Signature Verification ─────────────────────── */
/**
 * Verify a Flutterwave webhook request.
 * v3 mechanism: direct string comparison of `verif-hash` header
 * against FLW_SECRET_HASH env var.
 *
 * @param {object} headers - request headers (Express req.headers)
 * @returns {boolean} true if signature is valid
 */
export function verifyWebhookSignature(headers) {
  const secretHash = process.env.FLW_SECRET_HASH;
  if (!secretHash) {
    console.error('[flutterwave] FLW_SECRET_HASH is not set — webhook verification disabled');
    return false;
  }
  const signature = headers['verif-hash'];
  if (!signature) return false;
  // Constant-time comparison
  if (signature.length !== secretHash.length) return false;
  let diff = 0;
  for (let i = 0; i < signature.length; i++) {
    diff |= signature.charCodeAt(i) ^ secretHash.charCodeAt(i);
  }
  return diff === 0;
}

/* ─── 7. Generate unique references ─────────────────────────── */
/**
 * Generate a unique Flutterwave transfer reference.
 * Format: orael-w-{userId}-{timestamp}-{random}
 */
export function generateTransferReference(userId) {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `orael-w-${userId}-${ts}-${rand}`;
}

/**
 * Generate a unique Flutterwave airtime reference.
 * Format: orael-air-{userId}-{timestamp}-{random}
 */
export function generateAirtimeReference(userId) {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `orael-air-${userId}-${ts}-${rand}`;
}

/* ─── 8. Validate Nigerian phone number ─────────────────────── */
/**
 * Validate a Nigerian phone number.
 * Accepts: 08012345678, +2348012345678, 2348012345678
 * @param {string} phone
 * @returns {boolean}
 */
export function isValidNgPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.trim().replace(/\s/g, '').replace(/-/g, '');
  // 0XX XXXX XXXX (11 digits starting with 0)
  if (/^0\d{10}$/.test(cleaned)) return true;
  // +234 XXX XXXX XXXX (13 digits with +)
  if (/^\+234\d{10}$/.test(cleaned)) return true;
  // 234 XXX XXXX XXXX (12 digits without +)
  if (/^234\d{10}$/.test(cleaned)) return true;
  return false;
}

/* ─── 9. Normalize phone to +234 format ─────────────────────── */
export function normalizeNgPhone(phone) {
  if (!phone) return null;
  let cleaned = phone.trim().replace(/\s/g, '').replace(/-/g, '');
  if (cleaned.startsWith('0')) {
    return '+234' + cleaned.slice(1);
  }
  if (cleaned.startsWith('234') && !cleaned.startsWith('+')) {
    return '+' + cleaned;
  }
  if (!cleaned.startsWith('+')) {
    return '+234' + cleaned;
  }
  return cleaned;
}

export default {
  listBanks,
  resolveAccount,
  createTransfer,
  getTransferStatus,
  purchaseAirtime,
  verifyWebhookSignature,
  generateTransferReference,
  generateAirtimeReference,
  isValidNgPhone,
  normalizeNgPhone,
};
