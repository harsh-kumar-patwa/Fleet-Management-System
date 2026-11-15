'use strict';
/**
 * SMS providers. Each implements send({ to, body }) -> { providerMessageId }
 * and throws on failure.
 */
const crypto = require('crypto');
const config = require('../../shared/config');

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Local SMS stub (no network). Behaves like a sandbox:
 *  - rejects numbers that are not E.164
 *  - numbers ending in "0000" always fail (handy for testing the "failed" path)
 *  - keeps an in-memory outbox that can be inspected
 */
const stub = {
  name: 'sms-stub',
  outbox: [],
  async send({ to, body }) {
    if (!E164.test(to || '')) throw new Error(`Invalid destination number: ${to}`);
    if (to.endsWith('0000')) throw new Error('Carrier rejected message (simulated failure)');
    const msg = { sid: `SM${crypto.randomBytes(16).toString('hex')}`, to, body, at: new Date().toISOString() };
    this.outbox.push(msg);
    if (config.env !== 'test') console.log(`[sms-stub] -> ${to}: ${body}`);
    return { providerMessageId: msg.sid };
  },
};

/** Twilio REST API (works with Twilio trial/test credentials). */
const twilio = {
  name: 'twilio',
  async send({ to, body }) {
    const { twilioSid, twilioToken, twilioFrom } = config.sms;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: twilioFrom, Body: body }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Twilio error ${res.status}: ${data.message || 'unknown'}`);
    return { providerMessageId: data.sid };
  },
};

module.exports = { providers: { stub, twilio }, E164 };
