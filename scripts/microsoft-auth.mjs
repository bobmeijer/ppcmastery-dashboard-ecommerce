// One-time Microsoft Advertising OAuth: opens the consent flow, stores the refresh token in
// .env.local (never printed) and lists the CustomerId / AccountId pairs this login can reach.
//
// Needs in .env.local: MSADS_DEVELOPER_TOKEN, MSADS_CLIENT_ID, MSADS_CLIENT_SECRET.
// The Entra app must have redirect URI http://localhost:8765/callback (platform "Web").
//
//   npm run msads:auth

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env.local');
const REDIRECT_URI = 'http://localhost:8765/callback';
const SCOPE = 'https://ads.microsoft.com/msads.manage offline_access';
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const CUSTOMER_API =
  'https://clientcenter.api.bingads.microsoft.com/Api/CustomerManagement/v13/CustomerManagementService.svc';

function readEnv() {
  const text = readFileSync(ENV_PATH, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { text, env };
}

function writeEnvValue(key, value) {
  const { text } = readEnv();
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
  writeFileSync(ENV_PATH, next, 'utf8');
}

function waitForCode(state) {
  return new Promise((resolveCode, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const ok = !error && code && url.searchParams.get('state') === state;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(ok ? 'Done, you can close this tab.' : `Failed: ${error ?? 'state or code is missing'}`);
      server.close();
      if (ok) resolveCode(code);
      else reject(new Error(`${error ?? 'invalid callback'}: ${url.searchParams.get('error_description') ?? ''}`));
    });
    server.listen(8765);
  });
}

async function tokenRequest(env, params) {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MSADS_CLIENT_ID,
      client_secret: env.MSADS_CLIENT_SECRET,
      scope: SCOPE,
      ...params,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.refresh_token) {
    throw new Error(`Token exchange failed (${res.status}): ${body.error ?? ''} ${body.error_description ?? ''}`);
  }
  return body;
}

async function soap(env, accessToken, action, bodyXml) {
  const envelope = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
<s:Header xmlns="https://bingads.microsoft.com/Customer/v13">
<Action s:mustUnderstand="1">${action}</Action>
<AuthenticationToken>${accessToken}</AuthenticationToken>
<DeveloperToken>${env.MSADS_DEVELOPER_TOKEN}</DeveloperToken>
</s:Header>
<s:Body>${bodyXml}</s:Body>
</s:Envelope>`;
  const res = await fetch(CUSTOMER_API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action },
    body: envelope,
  });
  const xml = await res.text();
  if (!res.ok) {
    const fault = xml.match(/<(?:\w+:)?Message>([^<]*)</)?.[1] ?? xml.slice(0, 400);
    throw new Error(`${action} failed (${res.status}): ${fault}`);
  }
  return xml;
}

const tag = (xml, name) => xml.match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`))?.[1];

async function main() {
  const { env } = readEnv();
  for (const key of ['MSADS_DEVELOPER_TOKEN', 'MSADS_CLIENT_ID', 'MSADS_CLIENT_SECRET']) {
    if (!env[key]) throw new Error(`${key} is missing from .env.local`);
  }

  // --list: reuse the stored refresh token, no browser login.
  if (process.argv.includes('--list')) {
    if (!env.MSADS_REFRESH_TOKEN) throw new Error('MSADS_REFRESH_TOKEN is missing, run without --list first');
    const tokens = await tokenRequest(env, {
      grant_type: 'refresh_token',
      refresh_token: env.MSADS_REFRESH_TOKEN,
    });
    writeEnvValue('MSADS_REFRESH_TOKEN', tokens.refresh_token);
    await listAccounts(env, tokens.access_token);
    return;
  }

  const state = randomBytes(16).toString('hex');
  const authUrl = `${AUTHORITY}/authorize?${new URLSearchParams({
    client_id: env.MSADS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    response_mode: 'query',
    scope: SCOPE,
    state,
    prompt: 'select_account',
  })}`;
  console.log('Open this URL and log in with the user who can access the account in Microsoft Ads:\n');
  console.log(authUrl, '\n');

  const code = await waitForCode(state);
  const tokens = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
  writeEnvValue('MSADS_REFRESH_TOKEN', tokens.refresh_token);
  console.log('Refresh token saved in .env.local (MSADS_REFRESH_TOKEN).\n');
  await listAccounts(env, tokens.access_token);
}

async function listAccounts(env, accessToken) {
  const userXml = await soap(
    env,
    accessToken,
    'GetUser',
    '<GetUserRequest xmlns="https://bingads.microsoft.com/Customer/v13"><UserId i:nil="true"/></GetUserRequest>',
  );
  // User/ContactInfo/Address carries its own <Id>; take the user's Id after ContactInfo is cut out.
  const userBlock = userXml.match(/<(?:\w+:)?User\b[\s\S]*?<\/(?:\w+:)?User>/)?.[0] ?? '';
  const userId = tag(userBlock.replace(/<(?:\w+:)?ContactInfo\b[\s\S]*?<\/(?:\w+:)?ContactInfo>/, ''), 'Id');
  if (!userId) throw new Error('GetUser returned no user id');
  const roles = [...userXml.matchAll(/<(?:\w+:)?CustomerRole\b[\s\S]*?<\/(?:\w+:)?CustomerRole>/g)].map(([b]) => ({
    customerId: tag(b, 'CustomerId'),
    roleId: tag(b, 'RoleId'),
  }));
  console.log(`User id ${userId}, client roles:`, roles.length ? roles : 'none');

  const accountsXml = await soap(
    env,
    accessToken,
    'SearchAccounts',
    `<SearchAccountsRequest xmlns="https://bingads.microsoft.com/Customer/v13">
<Predicates xmlns:e="https://bingads.microsoft.com/Customer/v13/Entities">
<e:Predicate><e:Field>UserId</e:Field><e:Operator>Equals</e:Operator><e:Value>${userId}</e:Value></e:Predicate>
</Predicates>
<Ordering i:nil="true"/>
<PageInfo xmlns:e="https://bingads.microsoft.com/Customer/v13/Entities"><e:Index>0</e:Index><e:Size>100</e:Size></PageInfo>
</SearchAccountsRequest>`,
  );

  const accounts = [...accountsXml.matchAll(/<(?:\w+:)?AdvertiserAccount\b[\s\S]*?<\/(?:\w+:)?AdvertiserAccount>/g)].map(
    ([block]) => ({
      name: tag(block, 'Name'),
      accountId: tag(block, 'Id'),
      number: tag(block, 'Number'),
      customerId: tag(block, 'ParentCustomerId'),
      status: tag(block, 'AccountLifeCycleStatus'),
      currency: tag(block, 'CurrencyCode'),
    }),
  );
  if (accounts.length === 0) {
    console.log('No accounts found for this login. Does this user have access to the account?');
    return;
  }
  console.table(accounts);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
