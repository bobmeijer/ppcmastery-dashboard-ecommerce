#!/usr/bin/env node
// Imports meeting and email digests for the Communication page. Reads one JSON file and
// calls publish_communication once per item. Safe to rerun: rows are keyed on id.
//   npm run communications:import -- path/to/digests.json [--dry-run]
// The file format is in docs/recipes/build-a-digest-step.md.
// --dry-run checks the file and writes nothing. Prints no secret values.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadEnv } from './env.mjs';

const require = createRequire(import.meta.url);

const USAGE = 'usage: npm run communications:import -- path/to/digests.json [--dry-run]';
const ITEM_FIELDS = new Set(['id', 'kind', 'title', 'date', 'time', 'participants', 'summary_md', 'decisions', 'detail_md', 'message_count', 'labels', 'actions']);
const ACTION_FIELDS = new Set(['id', 'title', 'owner', 'due', 'label']);
const MAX_ID_LENGTH = 200;   // the routes that hide items and change actions refuse longer ids

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = value => typeof value === 'string';
const isTextList = value => Array.isArray(value) && value.every(isText);
const isId = value => isText(value) && value.trim() !== '' && value.length <= MAX_ID_LENGTH;
const isDate = value => {
  if (!isText(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function checkAction(action, where, seen, report) {
  if (!isObject(action)) { report(`${where}: must be an object`); return; }
  for (const key of Object.keys(action)) if (!ACTION_FIELDS.has(key)) report(`${where}: unknown field "${key}"`);
  // The database function drops an action without id or title without saying so.
  if (!isId(action.id)) report(`${where}: "id" must be a text of 1 to ${MAX_ID_LENGTH} characters`);
  else if (seen.has(action.id)) report(`${where}: action id "${action.id}" is used twice`);
  else seen.add(action.id);
  if (!isText(action.title) || action.title.trim() === '') report(`${where}: "title" is required`);
  if (action.owner !== undefined && (!isText(action.owner) || action.owner.trim() === '')) report(`${where}: "owner" must be a name`);
  if (action.due !== undefined && action.due !== null && !isDate(action.due)) report(`${where}: "due" must be a date (YYYY-MM-DD) or null`);
  if (action.label !== undefined && action.label !== null && !isText(action.label)) report(`${where}: "label" must be an account label or null`);
}

function checkItem(item, where, seenItems, seenActions, report) {
  if (!isObject(item)) { report(`${where}: must be an object`); return; }
  for (const key of Object.keys(item)) if (!ITEM_FIELDS.has(key)) report(`${where}: unknown field "${key}"`);
  if (!isId(item.id)) report(`${where}: "id" must be a text of 1 to ${MAX_ID_LENGTH} characters`);
  else if (seenItems.has(item.id)) report(`${where}: item id "${item.id}" is used twice`);
  else seenItems.add(item.id);
  if (item.kind !== 'meeting' && item.kind !== 'email') report(`${where}: "kind" must be "meeting" or "email"`);
  if (!isDate(item.date)) report(`${where}: "date" must be a date (YYYY-MM-DD)`);
  for (const key of ['title', 'time', 'summary_md']) if (item[key] !== undefined && !isText(item[key])) report(`${where}: "${key}" must be text`);
  if (item.detail_md !== undefined && item.detail_md !== null && !isText(item.detail_md)) report(`${where}: "detail_md" must be text or null`);
  for (const key of ['participants', 'decisions', 'labels']) if (item[key] !== undefined && !isTextList(item[key])) report(`${where}: "${key}" must be a list of texts`);
  if (item.message_count !== undefined && (!Number.isInteger(item.message_count) || item.message_count < 0)) report(`${where}: "message_count" must be a whole number`);
  if (item.actions === undefined) return;
  if (!Array.isArray(item.actions)) { report(`${where}: "actions" must be a list`); return; }
  item.actions.forEach((action, index) => checkAction(action, `${where}, action ${index + 1}`, seenActions, report));
}

function validate(items) {
  const problems = [];
  const seenItems = new Set();
  const seenActions = new Set();
  items.forEach((item, index) => {
    const name = isObject(item) && isText(item.id) && item.id ? `item ${index + 1} (${item.id})` : `item ${index + 1}`;
    checkItem(item, name, seenItems, seenActions, problem => problems.push(problem));
  });
  return problems;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const unknown = args.filter(arg => arg.startsWith('--') && arg !== '--dry-run');
const files = args.filter(arg => !arg.startsWith('--'));
if (unknown.length || files.length !== 1) {
  console.error(USAGE);
  process.exit(1);
}

let items;
try {
  items = JSON.parse(readFileSync(files[0], 'utf8').replace(/^\uFEFF/, ''));
} catch (error) {
  console.error(`Could not read ${files[0]}: ${error.message}`);
  process.exit(1);
}
if (!Array.isArray(items)) {
  console.error('The file must hold a JSON list of items. See docs/recipes/build-a-digest-step.md.');
  process.exit(1);
}

// The whole file is checked first, so a typo in the last item writes nothing.
const problems = validate(items);
if (problems.length) {
  console.error(`${problems.length} problem(s) in ${files[0]}, nothing was written:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const actionCount = items.reduce((total, item) => total + (item.actions?.length ?? 0), 0);
if (dryRun) {
  console.log(`${items.length} item(s) and ${actionCount} action(s) are valid. Nothing was written.`);
  process.exit(0);
}

loadEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(url, key, { auth: { persistSession: false } });

// One transaction per item: a failed item is reported and the rest still go in.
let failed = 0;
for (const { actions = [], ...item } of items) {
  const { data, error } = await supabase.rpc('publish_communication', { p_item: item, p_actions: actions });
  if (error) {
    failed += 1;
    console.error(`  FAILED  ${item.id}: ${error.message}`);
  } else {
    console.log(`  ok      ${item.id}: ${data} action(s) written`);
  }
}

console.log(`${items.length - failed} of ${items.length} item(s) imported.`);
if (items.some(item => item.kind === 'email')) {
  console.log('New or changed emails stay hidden from the client role until an admin shows them on the Communication page.');
}
process.exit(failed ? 1 : 0);
