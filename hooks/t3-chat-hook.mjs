// Optional Claude Code SessionStart hook: when a T3 Code chat that belongs to Marketing mode starts, give it extra
// context (edit CONTEXT below, or set T3M_CONTEXT_FILE to a Markdown file). Coding chats and non-T3 sessions get nothing.
// Asks the companion server (server/t3-modes.mjs chatMode); if it's down, does nothing. Never blocks a session.
// Register it in ~/.claude/settings.json under hooks.SessionStart with: node "<repo>/hooks/t3-chat-hook.mjs"
import fs from 'node:fs';

const MARK = 'Marketing mode chat';
const CONTEXT = process.env.T3M_CONTEXT_FILE && fs.existsSync(process.env.T3M_CONTEXT_FILE)
  ? `## ${MARK}\n${fs.readFileSync(process.env.T3M_CONTEXT_FILE, 'utf8')}`
  : `## ${MARK}
This chat was started in Marketing mode. Focus on marketing work (posts, campaigns, copy, outreach) rather than code.`;

async function main() {
  if (process.env.CLAUDE_CODE_ENTRYPOINT !== 'sdk-ts') return; // T3 runs chats through the TypeScript SDK
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { session_id: session, cwd, source, transcript_path: transcript } = JSON.parse(input || '{}');
  // A resumed chat already has this note in its history, unless it predates the hook.
  if (source === 'resume' && transcript && fs.existsSync(transcript) && fs.readFileSync(transcript, 'utf8').includes(MARK)) return;
  const q = new URLSearchParams({ session: session || '', cwd: cwd || '' });
  const r = await fetch(`http://127.0.0.1:4780/api/t3/chat-mode?${q}`, { signal: AbortSignal.timeout(1500) });
  const { mode } = r.ok ? await r.json() : {};
  if (mode !== 'marketing') return;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: CONTEXT } });
}

// Exit only once the output is flushed (Windows pipes write asynchronously).
main().catch(() => '').then((out) => (out ? process.stdout.write(out, () => process.exit(0)) : process.exit(0)));
