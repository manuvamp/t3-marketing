// Splits T3 Code's chats into Marketing and Coding (public/t3-toggle.js hides the other mode's rows in T3's left bar).
// A chat belongs to the mode that was on when it was created, whatever folder it's in, and keeps it.
// The toggle reports every mode switch here; a new chat's mode is the one on at its created_at.
// State lives in data/t3-modes.json: { log: [{at, mode}], chats: {threadId: mode} }. T3's database is only read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.T3M_DATA || path.join(import.meta.dirname, 'data');
const T3_DB = process.env.T3_STATE_DB || path.join(os.homedir(), '.t3', 'userdata', 'state.sqlite');
const STATE = path.join(DATA_DIR, 't3-modes.json');
const MODES = new Set(['marketing', 'coding']);
const normDir = (p) => String(p || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

let state = null;
const load = () => (state ??= { log: [], chats: {}, ...readJson(STATE, {}) });
const save = () => writeJsonAtomic(STATE, state);

// The mode that was on at a given time (Coding before the first switch).
function modeAt(at) {
  let mode = 'coding';
  for (const e of load().log) if (e.at <= at) mode = e.mode;
  return mode;
}

// Records a mode switch reported by the toggle in T3.
export function noteMode(mode) {
  if (!MODES.has(mode)) return;
  const s = load();
  if (s.log.at(-1)?.mode === mode) return;
  s.log.push({ at: new Date().toISOString(), mode });
  s.log = s.log.slice(-500);
  save();
}

function openDb() {
  if (!fs.existsSync(T3_DB)) return null;
  const db = new DatabaseSync(T3_DB, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 2000');
  return db;
}

// Gives every chat its mode, fixing it the first time it's seen, so it never moves later.
function assign(threads) {
  const s = load();
  let changed = false;
  for (const t of threads) {
    if (!s.chats[t.thread_id]) { s.chats[t.thread_id] = modeAt(t.created_at); changed = true; }
  }
  if (changed) save();
  return s.chats;
}

let cache = { at: 0, data: null };

// { marketing: [threadId…], coding: [threadId…] }. Cached for 2s.
export function t3Split() {
  if (cache.data && Date.now() - cache.at < 2000) return cache.data;
  const db = openDb();
  if (!db) return { marketing: [], coding: [], error: 'T3 database not found' };
  try {
    const threads = db.prepare('SELECT thread_id, created_at FROM projection_threads WHERE deleted_at IS NULL').all();
    const chats = assign(threads);
    const out = { marketing: [], coding: [] };
    for (const t of threads) out[chats[t.thread_id]].push(t.thread_id);
    cache = { at: Date.now(), data: out };
    return out;
  } finally {
    db.close();
  }
}

// Which mode the T3 chat behind a Claude session is in (for hooks/t3-chat-hook.mjs).
// A resumed chat is found by its Claude session id; a brand-new chat (no session recorded yet) is the newest
// chat of the last 10 minutes started in that folder.
export function chatMode({ session, cwd }) {
  const db = openDb();
  if (!db) return { mode: null };
  try {
    let thread = null;
    if (session) {
      thread = db.prepare(`SELECT t.thread_id, t.created_at FROM provider_session_runtime r JOIN projection_threads t USING (thread_id)
        WHERE r.resume_cursor_json LIKE ? AND t.deleted_at IS NULL`).get(`%"resume":"${session.replace(/[^\w-]/g, '')}"%`);
    }
    if (!thread && cwd) {
      const since = new Date(Date.now() - 10 * 60_000).toISOString();
      const dir = normDir(cwd);
      thread = db.prepare(`SELECT t.thread_id, t.created_at, t.worktree_path, p.workspace_root FROM projection_threads t
        JOIN projection_projects p USING (project_id)
        LEFT JOIN provider_session_runtime r USING (thread_id)
        WHERE t.deleted_at IS NULL AND t.created_at >= ? AND (r.resume_cursor_json IS NULL OR r.resume_cursor_json NOT LIKE '%"resume":%')
        ORDER BY t.created_at DESC`).all(since)
        .find((t) => normDir(t.worktree_path || t.workspace_root) === dir) || null;
    }
    if (!thread) return { mode: null };
    return { mode: assign([thread])[thread.thread_id], thread: thread.thread_id };
  } finally {
    db.close();
  }
}
