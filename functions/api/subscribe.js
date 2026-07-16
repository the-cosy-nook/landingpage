const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const RATE_LIMIT_MAX_REQUESTS = 10;
const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...jsonHeaders,
      'Allow': 'POST, OPTIONS'
    }
  });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!isSameOrigin(request)) {
      return json({ ok: false, code: 'invalid_origin' }, 403);
    }

    const clientIp = getClientIp(request);
    const rateLimit = await checkRateLimit(env, clientIp);

    if (!rateLimit.allowed) {
      return json(
        {
          ok: false,
          code: 'rate_limited',
          retryAfter: rateLimit.retryAfter
        },
        429,
        {
          'Retry-After': String(rateLimit.retryAfter)
        }
      );
    }

    const payload = await readPayload(request);
    const email = normalizeEmail(payload.email);
    const language = normalizeLanguage(payload.language);
    const turnstileToken = String(payload.turnstileToken || payload['cf-turnstile-response'] || '');

    if (!email || !isValidEmail(email)) {
      return json({ ok: false, code: 'invalid_email' }, 400);
    }

    if (!turnstileToken) {
      return json({ ok: false, code: 'turnstile_required' }, 400);
    }

    const turnstileResult = await verifyTurnstile(env, turnstileToken, clientIp);

    if (!turnstileResult.success) {
      return json({ ok: false, code: 'turnstile_failed' }, 400);
    }

    const mailchimpResult = await subscribeWithDoubleOptIn(env, email, language);

    return json({
      ok: true,
      code: getSuccessCode(mailchimpResult),
      mailchimpStatus: mailchimpResult.status
    });
  } catch (error) {
    console.error(error);

    if (error instanceof ConfigurationError) {
      return json({ ok: false, code: 'configuration_error' }, 500);
    }

    if (error instanceof NewsletterServiceError) {
      return json({ ok: false, code: 'newsletter_service_error' }, 502);
    }

    return json({ ok: false, code: 'server_error' }, 500);
  }
}

export async function onRequestGet() {
  return methodNotAllowed();
}

export async function onRequestPut() {
  return methodNotAllowed();
}

export async function onRequestPatch() {
  return methodNotAllowed();
}

export async function onRequestDelete() {
  return methodNotAllowed();
}

function methodNotAllowed() {
  return json({ ok: false, code: 'method_not_allowed' }, 405, {
    'Allow': 'POST, OPTIONS'
  });
}

function isSameOrigin(request) {
  const origin = request.headers.get('Origin');

  if (!origin) {
    return true;
  }

  return origin === new URL(request.url).origin;
}

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || '0.0.0.0';
}

async function checkRateLimit(env, clientIp) {
  assertEnv(env.SUBSCRIBE_RATE_LIMIT, 'SUBSCRIBE_RATE_LIMIT');

  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / RATE_LIMIT_WINDOW_SECONDS) * RATE_LIMIT_WINDOW_SECONDS;
  const retryAfter = windowStart + RATE_LIMIT_WINDOW_SECONDS - now;
  const ipHash = await sha256(clientIp);
  const key = `subscribe:${windowStart}:${ipHash}`;
  const currentValue = await env.SUBSCRIBE_RATE_LIMIT.get(key);
  const currentCount = Number(currentValue || 0);

  if (currentCount >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfter };
  }

  await env.SUBSCRIBE_RATE_LIMIT.put(key, String(currentCount + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS + 60
  });

  return { allowed: true, retryAfter };
}

async function readPayload(request) {
  const contentType = request.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    return request.json();
  }

  const formData = await request.formData();
  return Object.fromEntries(formData.entries());
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeLanguage(language) {
  return language === 'en' ? 'en' : 'de';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

async function verifyTurnstile(env, token, clientIp) {
  assertEnv(env.TURNSTILE_SECRET_KEY, 'TURNSTILE_SECRET_KEY');

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
    remoteip: clientIp
  });

  const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
    method: 'POST',
    body
  });

  if (!response.ok) {
    return { success: false };
  }

  const result = await response.json();

  return {
    success: result.success === true && (!result.action || result.action === 'newsletter')
  };
}

async function subscribeWithDoubleOptIn(env, email, language) {
  assertEnv(env.MAILCHIMP_API_KEY, 'MAILCHIMP_API_KEY');
  assertEnv(env.MAILCHIMP_AUDIENCE_ID, 'MAILCHIMP_AUDIENCE_ID');

  const dataCenter = env.MAILCHIMP_SERVER_PREFIX || env.MAILCHIMP_API_KEY.split('-').pop();

  if (!dataCenter || dataCenter === env.MAILCHIMP_API_KEY) {
    throw new ConfigurationError('MAILCHIMP_SERVER_PREFIX is required when the API key has no data center suffix.');
  }

  const memberHash = md5(email);
  const baseUrl = `https://${dataCenter}.api.mailchimp.com/3.0`;
  const memberUrl = `${baseUrl}/lists/${encodeURIComponent(env.MAILCHIMP_AUDIENCE_ID)}/members/${memberHash}`;
  const authHeader = `Basic ${btoa(`cozy:${env.MAILCHIMP_API_KEY}`)}`;
  const existingResponse = await fetch(memberUrl, {
    headers: {
      'Authorization': authHeader,
      'Accept': 'application/json'
    }
  });

  if (existingResponse.ok) {
    const existingMember = await existingResponse.json();

    if (existingMember.status === 'subscribed' || existingMember.status === 'pending') {
      console.info('Mailchimp member already exists.', {
        status: existingMember.status,
        listId: existingMember.list_id,
        webId: existingMember.web_id
      });

      return {
        alreadySubscribed: existingMember.status === 'subscribed',
        alreadyPending: existingMember.status === 'pending',
        created: false,
        status: existingMember.status
      };
    }
  } else if (existingResponse.status !== 404) {
    throw new NewsletterServiceError(`Mailchimp member lookup failed with ${existingResponse.status}.`);
  }

  const tags = parseTags(env.MAILCHIMP_TAGS);
  const response = await fetch(memberUrl, {
    method: 'PUT',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      email_address: email,
      status_if_new: 'pending',
      status: 'pending',
      language,
      tags
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new NewsletterServiceError(`Mailchimp subscribe failed with ${response.status}: ${errorBody}`);
  }

  const member = await response.json();

  console.info('Mailchimp subscription request accepted.', {
    status: member.status,
    listId: member.list_id,
    webId: member.web_id
  });

  return {
    alreadySubscribed: member.status === 'subscribed',
    alreadyPending: false,
    created: true,
    status: member.status || 'unknown'
  };
}

function getSuccessCode(mailchimpResult) {
  if (mailchimpResult.alreadySubscribed) {
    return 'already_subscribed';
  }

  if (mailchimpResult.alreadyPending) {
    return 'confirmation_pending';
  }

  if (mailchimpResult.status === 'pending') {
    return 'confirmation_sent';
  }

  return 'confirmation_processed';
}

function parseTags(tags) {
  return String(tags || 'Landing Page')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...headers
    }
  });
}

function assertEnv(value, name) {
  if (!value) {
    throw new ConfigurationError(`Missing required environment binding: ${name}`);
  }
}

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

class NewsletterServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NewsletterServiceError';
  }
}

function md5(input) {
  const bytes = utf8Bytes(input);
  const originalBitLength = BigInt(bytes.length) * 8n;

  bytes.push(0x80);

  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }

  for (let i = 0; i < 8; i += 1) {
    bytes.push(Number((originalBitLength >> BigInt(8 * i)) & 0xffn));
  }

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32));

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = [];

    for (let i = 0; i < 16; i += 1) {
      const wordOffset = offset + i * 4;
      words[i] = bytes[wordOffset]
        | (bytes[wordOffset + 1] << 8)
        | (bytes[wordOffset + 2] << 16)
        | (bytes[wordOffset + 3] << 24);
    }

    let aa = a;
    let bb = b;
    let cc = c;
    let dd = d;

    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;

      if (i < 16) {
        f = (bb & cc) | (~bb & dd);
        g = i;
      } else if (i < 32) {
        f = (dd & bb) | (~dd & cc);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = bb ^ cc ^ dd;
        g = (3 * i + 5) % 16;
      } else {
        f = cc ^ (bb | ~dd);
        g = (7 * i) % 16;
      }

      const temp = dd;
      dd = cc;
      cc = bb;
      bb = add32(bb, leftRotate(add32(add32(aa, f), add32(constants[i], words[g])), shifts[i]));
      aa = temp;
    }

    a = add32(a, aa);
    b = add32(b, bb);
    c = add32(c, cc);
    d = add32(d, dd);
  }

  return [a, b, c, d]
    .flatMap((word) => [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff])
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function utf8Bytes(input) {
  return [...new TextEncoder().encode(input)];
}

function add32(a, b) {
  return (a + b) >>> 0;
}

function leftRotate(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}
