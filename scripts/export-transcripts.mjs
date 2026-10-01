#!/usr/bin/env node
// Export the raw Claude Code and Codex session transcripts for this repo, its worktrees and its
// no-mistakes gate runs into prompt-history/transcripts/, scrubbed, then cross-check PROMPTS.md
// against the prompts found in them. Reports mismatches; never edits PROMPTS.md.
//
//   node scripts/export-transcripts.mjs            export, scrub, verify, cross-check
//   node scripts/export-transcripts.mjs --check    cross-check and verify only, write nothing
//
// Options: --since <ISO>   ignore sessions that started before this (default: first commit)
//          --terms <file>  extra literal terms to redact, one per line (default:
//                          scripts/scrub-terms.local.txt, git-ignored by the *.local.* rule, so
//                          the owner's private terms never enter the repo)
//
// Selection (every inclusion reason is written to INDEX.md):
//   Claude Code  ~/.claude/projects/<encoded path>/ whose path is this checkout or a sibling
//                worktree named cf-billing-copilot-*, plus <session>/subagents/*.jsonl.
//   Gate runs    ~/.claude/projects/-<home>--no-mistakes-worktrees-<repoId>-<runId>/. The path
//                carries no repo name, so a run is included only when ~/.no-mistakes/repos/
//                <repoId>.git has this repo's origin URL, its first record falls after --since,
//                and its content names this repo (time and content match).
//   Codex        ~/.codex/sessions/**/rollout-*.jsonl whose session cwd is one of the paths above
//                or a no-mistakes worktree of this repo, or that started after --since and
//                mention this repo by name (for example a review run from a scratch directory).
//
// Scrubbing: harness context that is not a prompt (system prompts, skill and tool listings, MCP
// instructions, account and org ids, the owner's global agent rules, sandbox roots outside the
// repo, encrypted reasoning, inline images) is replaced by an "<omitted: ...>" marker; then home
// paths become "~", emails "<email>", and secrets and tokens "<redacted:kind>" in every string.
// After writing, the output is scanned again and the script exits 1 if anything is left.
// SCRUB_DEBUG=1 prints a sample of each leftover match (it lands in the calling session's own
// transcript, so use it only on a dry run with --check).

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

const REPO_NAME = "cf-billing-copilot";
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const OUT = join(ROOT, "prompt-history", "transcripts");
const HOME = homedir();
const USER = userInfo().username;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const CHECK_ONLY = flag("--check");
const git = (...a) =>
  execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
const SINCE = new Date(
  option("--since", git("log", "--reverse", "--format=%cI").split("\n")[0])
);
const TERMS_FILE = option(
  "--terms",
  join(ROOT, "scripts", "scrub-terms.local.txt")
);
const TERMS = existsSync(TERMS_FILE)
  ? readFileSync(TERMS_FILE, "utf8")
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t && !t.startsWith("#"))
  : [];

// ---------------------------------------------------------------- selection

const encode = (p) => p.replace(/[^A-Za-z0-9]/g, "-");
const repoOrigin = (gitDir) => {
  try {
    return execFileSync(
      "git",
      ["--git-dir", gitDir, "config", "--get", "remote.origin.url"],
      { encoding: "utf8" }
    ).trim();
  } catch {
    return "";
  }
};
const ORIGIN =
  repoOrigin(join(ROOT, ".git")) || git("remote", "get-url", "origin");
const sameRepo = (url) =>
  url.replace(/\.git$/, "").toLowerCase() ===
  ORIGIN.replace(/\.git$/, "").toLowerCase();

const NM = join(HOME, ".no-mistakes");
const gateRepoIds = existsSync(join(NM, "repos"))
  ? readdirSync(join(NM, "repos"))
      .filter((d) => d.endsWith(".git"))
      .map((d) => d.slice(0, -4))
      .filter((id) => sameRepo(repoOrigin(join(NM, "repos", `${id}.git`))))
  : [];

const projectsDir = join(HOME, "projects");
const repoPathRe = new RegExp(
  `^${escapeRe(projectsDir)}/(wt/)?${REPO_NAME}(-[A-Za-z0-9_-]+)?(/|$)`
);
const gatePathRe = new RegExp(
  `^${escapeRe(join(NM, "worktrees"))}/(${gateRepoIds.join("|") || "^$"})/`
);
const repoMention = new RegExp(
  `${REPO_NAME}|BillingAgent|CreditRequestWorkflow`
);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function lines(file) {
  return readFileSync(file, "utf8").split("\n").filter(Boolean);
}
function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
function firstTimestamp(file) {
  for (const l of lines(file)) {
    const t = parse(l)?.timestamp ?? parse(l)?.payload?.timestamp;
    if (t) return new Date(t);
  }
  return new Date(statSync(file).mtimeMs);
}
function lastTimestamp(file) {
  const all = lines(file);
  for (let i = all.length - 1; i >= 0; i--) {
    const t = parse(all[i])?.timestamp;
    if (t) return new Date(t);
  }
  return new Date(statSync(file).mtimeMs);
}
function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

function laneOf(path) {
  const m = path.match(new RegExp(`${REPO_NAME}-([A-Za-z0-9_-]+)`));
  return m ? m[1] : "main";
}

function selectSessions() {
  const sessions = [];
  const claudeRoot = join(HOME, ".claude", "projects");
  const encodedRepo = new RegExp(
    `^${escapeRe(encode(projectsDir))}-(wt-)?${REPO_NAME}(-[A-Za-z0-9_-]+)?$`
  );
  const gateDir = new RegExp(
    `^${escapeRe(encode(NM))}-worktrees-([0-9a-f]{12})-([0-9A-Z]{26})$`
  );
  for (const d of existsSync(claudeRoot) ? readdirSync(claudeRoot) : []) {
    const dir = join(claudeRoot, d);
    const top = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(dir, f));
    const withSubagents = (f) => [
      { file: f, subagent: false },
      ...walk(join(dir, basename(f, ".jsonl"), "subagents"), (p) =>
        p.endsWith(".jsonl")
      ).map((p) => ({ file: p, subagent: true }))
    ];
    if (encodedRepo.test(d)) {
      const lane = d.match(/-(wt-)?cf-billing-copilot-?(.*)$/)[2] || "main";
      for (const f of top)
        for (const s of withSubagents(f))
          sessions.push({
            ...s,
            harness: "claude",
            lane,
            reason: `Claude project dir for ${lane === "main" ? "the main checkout" : `worktree ${REPO_NAME}-${lane}`}`
          });
      continue;
    }
    const g = d.match(gateDir);
    if (!g) continue;
    const [, repoId, runId] = g;
    if (!gateRepoIds.includes(repoId)) continue;
    for (const f of top) {
      const started = firstTimestamp(f);
      const text = readFileSync(f, "utf8");
      if (started < SINCE || !repoMention.test(text)) continue;
      for (const s of withSubagents(f))
        sessions.push({
          ...s,
          harness: "claude",
          lane: `gate-${runId}`,
          reason: `no-mistakes gate run ${runId}: repo ${repoId} has origin ${ORIGIN}, started ${started.toISOString()} (after ${SINCE.toISOString()}), content names this repo`
        });
    }
  }
  const codexRoot = join(HOME, ".codex", "sessions");
  for (const f of walk(codexRoot, (p) => /rollout-.*\.jsonl$/.test(p))) {
    const meta = parse(lines(f)[0] ?? "")?.payload ?? {};
    const cwd = meta.cwd ?? "";
    const started = new Date(meta.timestamp ?? firstTimestamp(f));
    if (started < SINCE) continue;
    const sub =
      typeof meta.source === "object" || meta.thread_source === "subagent";
    let reason = null;
    let lane = null;
    if (repoPathRe.test(cwd)) {
      lane = laneOf(cwd);
      reason = `Codex session cwd is ${REPO_NAME}${lane === "main" ? "" : `-${lane}`}`;
    } else if (gatePathRe.test(cwd)) {
      lane = `gate-${basename(cwd)}`;
      reason = `Codex session cwd is a no-mistakes worktree of this repo`;
    } else if (repoMention.test(readFileSync(f, "utf8"))) {
      lane = "other";
      reason = `Codex session started ${started.toISOString()} outside the repo (cwd ${scrubPath(cwd)}) and its content names this repo`;
    }
    if (reason)
      sessions.push({ file: f, subagent: sub, harness: "codex", lane, reason });
  }
  for (const s of sessions) {
    s.started = firstTimestamp(s.file);
    s.ended = lastTimestamp(s.file);
  }
  return sessions.sort((a, b) => a.started - b.started);
}

// ---------------------------------------------------------------- scrubbing

// Tool output is sometimes truncated mid-path ("/home/ann..."), so a home path is also matched by
// the first five characters of the user name.
const homePrefix =
  "/?" +
  escapeRe(dirname(HOME).slice(1)) +
  "/" +
  escapeRe(USER.slice(0, 5)) +
  "[^\\s/\"'`\\\\]*";
const encodedHomePrefix =
  escapeRe(encode(dirname(HOME))) +
  "-" +
  escapeRe(encode(USER.slice(0, 5))) +
  "[A-Za-z0-9]*";
function scrubPath(s) {
  return s
    .split(HOME)
    .join("~")
    .split(encode(HOME))
    .join("-HOME-")
    .replace(new RegExp(homePrefix, "g"), "~")
    .replace(new RegExp(encodedHomePrefix, "g"), "-HOME")
    .replace(/\/mnt\/[a-z]\/[^\s"'`<>|\\]*/g, "<local-path>")
    .replace(/[A-Za-z]:\\\\?Users\\\\?[^\\\s"']+/g, "<local-path>");
}

const SECRET_PATTERNS = [
  [
    "private-key",
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
  ],
  ["anthropic-key", /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openai-key", /\bsk-[A-Za-z0-9_-]{20,}/g],
  [
    "github-token",
    /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g
  ],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["aws-key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["bearer", /(Bearer\s+)(?!<redacted)[A-Za-z0-9_\-.~+/]{16,}/gi],
  [
    "approver-token",
    /((?:approverToken|token)\\?["']?\s*[:=]\s*\\?["']?)[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g
  ],
  [
    "assignment",
    /((?:API_TOKEN|API_KEY|SECRET|PASSWORD|ACCOUNT_ID|AUTH_TOKEN|TOK)\s*=\s*\\?["']?)(?!\$|<redacted)[A-Za-z0-9_\-.~+/]{8,}/g
  ],
  // A standalone 43-character base64url string with upper, lower and digits is a 32-byte random
  // token in this repo (the approver token shape, CreateSandboxResponse).
  [
    "random-token",
    /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]{0,42}[A-Z])(?=[A-Za-z0-9_-]{0,42}[a-z])(?=[A-Za-z0-9_-]{0,42}[0-9])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g
  ]
];
const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

let globalRules = [];
for (const f of [
  join(HOME, ".codex", "AGENTS.md"),
  join(HOME, ".agents", "AGENTS.md")
])
  if (existsSync(f)) globalRules.push(readFileSync(f, "utf8").trim());
globalRules = globalRules.filter((r) => r.length > 40);

function scrubString(s) {
  for (const rule of globalRules)
    if (s.includes(rule))
      s = s.split(rule).join("<omitted: owner's global agent rules>");
  s = scrubPath(s);
  for (const [kind, re] of SECRET_PATTERNS)
    s = s.replace(re, (...m) =>
      typeof m[1] === "string" && m.length > 3 && kind !== "github-token"
        ? `${m[1]}<redacted:${kind}>`
        : `<redacted:${kind}>`
    );
  s = s.replace(EMAIL, "<email>");
  for (const t of TERMS)
    if (s.includes(t)) s = s.split(t).join("<redacted:personal>");
  return s;
}

function deep(v) {
  if (typeof v === "string") return scrubString(v);
  if (Array.isArray(v)) return v.map(deep);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[scrubString(k)] = deep(x);
    return o;
  }
  return v;
}

const omitted = (what) => `<omitted: ${what}>`;
const CLAUDE_OMIT_ATTACHMENTS = new Map([
  ["prompt_snapshot", "harness system prompt snapshot"],
  ["skill_listing", "harness skill listing"],
  ["deferred_tools_delta", "harness tool listing"],
  ["deferred_tools_record", "harness tool listing"],
  ["mcp_instructions_delta", "MCP server instructions"],
  ["agent_listing_delta", "harness agent listing"],
  ["session_context", "account context (email, git status)"],
  ["credential_org", "account organization id"]
]);

function stripImages(v) {
  if (Array.isArray(v)) return v.map(stripImages);
  if (!v || typeof v !== "object") return v;
  if (v.type === "image" && v.source?.data)
    return {
      ...v,
      source: {
        ...v.source,
        data: omitted(`image, ${v.source.data.length} base64 chars`)
      }
    };
  if (
    v.type === "input_image" &&
    typeof v.image_url === "string" &&
    v.image_url.startsWith("data:")
  )
    return { ...v, image_url: omitted(`image, ${v.image_url.length} chars`) };
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = stripImages(x);
  return o;
}

function scrubClaude(d) {
  if (
    d.type === "attachment" &&
    CLAUDE_OMIT_ATTACHMENTS.has(d.attachment?.type)
  )
    return {
      ...d,
      attachment: {
        type: d.attachment.type,
        content: omitted(CLAUDE_OMIT_ATTACHMENTS.get(d.attachment.type))
      },
      ...(d.rendered
        ? { rendered: omitted("rendered copy of the omitted attachment") }
        : {})
    };
  if (d.type === "attachment" && d.attachment?.type === "instructions")
    d = {
      ...d,
      attachment: {
        ...d.attachment,
        files: (d.attachment.files ?? []).map((f) =>
          f.type === "User" || !String(f.path ?? "").startsWith(projectsDir)
            ? { ...f, content: omitted("owner's global instructions") }
            : f
        )
      }
    };
  return stripImages(d);
}

const isHarnessDeveloperText = (t) =>
  /^<(skills_instructions|permissions instructions|apps_instructions|plugins_instructions|collaboration_mode|personality_spec)/.test(
    t.trim()
  ) || t.includes("<skills_instructions>");

function scrubCodex(d) {
  const p = d.payload;
  if (!p || typeof p !== "object") return d;
  if (d.type === "session_meta") {
    const {
      base_instructions,
      creator_user_id,
      creator_account_id,
      runtime_workspace_roots,
      ...rest
    } = p;
    return {
      ...d,
      payload: { ...rest, base_instructions: omitted("Codex system prompt") }
    };
  }
  if (d.type === "turn_context") {
    const keep = (r) =>
      repoPathRe.test(r) || gatePathRe.test(r) || r.startsWith("/tmp");
    const q = { ...p };
    if (Array.isArray(q.workspace_roots))
      q.workspace_roots = q.workspace_roots.filter(keep);
    if (q.sandbox_policy?.writable_roots)
      q.sandbox_policy = {
        ...q.sandbox_policy,
        writable_roots: q.sandbox_policy.writable_roots.filter(keep)
      };
    for (const k of [
      "user_instructions",
      "developer_instructions",
      "base_instructions"
    ])
      if (typeof q[k] === "string") q[k] = omitted("harness instructions");
    return { ...d, payload: q };
  }
  if (
    d.type === "response_item" &&
    p.type === "reasoning" &&
    p.encrypted_content
  )
    return {
      ...d,
      payload: { ...p, encrypted_content: omitted("encrypted reasoning") }
    };
  if (
    d.type === "response_item" &&
    p.type === "message" &&
    p.role === "developer"
  )
    return {
      ...d,
      payload: {
        ...p,
        content: (p.content ?? []).map((c) =>
          typeof c.text === "string" && isHarnessDeveloperText(c.text)
            ? { ...c, text: omitted("harness developer context") }
            : c
        )
      }
    };
  return stripImages(d);
}

// ---------------------------------------------------------------- prompts for the cross-check

const SKIP_PROMPT =
  /^(<task-notification>|<agent-message |<command-name>|<local-command|<bash-|\[Request interrupted|Caveat: The messages below|<system-reminder>|# AGENTS\.md instructions|<environment_context>|<user_instructions>|<turn_aborted>|<subagent_notification>)/;
const stripReminders = (t) =>
  t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();

function promptsOf(session, records) {
  const out = [];
  const add = (text, at) => {
    const t = stripReminders(String(text ?? ""));
    if (t && !SKIP_PROMPT.test(t)) out.push({ text: t, at });
  };
  for (const d of records) {
    if (session.harness === "claude") {
      if (
        d.type === "user" &&
        !d.isMeta &&
        !d.isCompactSummary &&
        !d.toolUseResult
      ) {
        const c = d.message?.content;
        if (typeof c === "string") add(c, d.timestamp);
        else if (Array.isArray(c) && !c.some((x) => x.type === "tool_result"))
          add(
            c
              .filter((x) => x.type === "text")
              .map((x) => x.text)
              .join("\n"),
            d.timestamp
          );
      }
      if (d.type === "attachment" && d.attachment?.type === "queued_command")
        add(d.attachment.prompt, d.timestamp);
    } else {
      const p = d.payload ?? {};
      if (d.type === "event_msg" && p.type === "user_message")
        add(p.message, d.timestamp);
      if (
        d.type === "event_msg" &&
        p.type === "item_completed" &&
        p.item?.type === "UserMessage"
      )
        add(
          (p.item.content ?? []).map((c) => c.text ?? "").join("\n"),
          d.timestamp
        );
    }
  }
  const seen = new Set();
  return out.filter((p) => {
    const k = norm(p.text);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

// PROMPTS.md entries are identified by their "Source:" file under prompt-history/prompts/ (entry
// formats differ between lanes, so fenced blocks alone miss some). An entry is matched when a
// transcript prompt contains the start of its file, the file contains the start of the prompt, or
// the prompt names the file (a kickoff such as "follow prompt-history/prompts/06-release.md").
function promptsMdEntries() {
  const md = readFileSync(join(ROOT, "PROMPTS.md"), "utf8");
  const bySource = new Map();
  let heading = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^## (.+)$/);
    if (h) heading = h[1];
    const src = line.match(
      /^-?\s*Source: (prompt-history\/prompts\/[\w.-]+\.md)/
    );
    if (src && !bySource.has(src[1])) {
      const file = join(ROOT, src[1]);
      const text = existsSync(file) ? readFileSync(file, "utf8") : "";
      bySource.set(src[1], {
        heading,
        source: src[1],
        n: norm(scrubString(text)),
        hits: []
      });
    }
  }
  return { md: norm(scrubString(md)), entries: [...bySource.values()] };
}

// no-mistakes wraps each generated gate prompt in a fixed preamble; such prompts are reported by
// run id rather than by text.
const GATE_PREAMBLE = /^Workspace boundary \(important\):/;

function crossCheck(sessions) {
  const { md, entries } = promptsMdEntries();
  const unmatched = [];
  const gate = [];
  for (const s of sessions) {
    if (s.subagent) continue;
    for (const p of s.prompts) {
      const n = norm(p.text);
      const head = n.slice(0, 200);
      const hit = entries.filter(
        (e) =>
          e.n &&
          (e.n.includes(head) ||
            n.includes(e.n.slice(0, 200)) ||
            n.includes(e.source) ||
            n.includes(basename(e.source)))
      );
      hit.forEach((e) => e.hits.push(s.id));
      if (GATE_PREAMBLE.test(n)) {
        const run = s.lane.replace(/^gate-/, "");
        gate.push({
          session: s.id,
          at: p.at,
          run,
          logged: md.includes(run),
          length: n.length
        });
      } else if (!hit.length && !md.includes(head)) {
        unmatched.push({ session: s.id, at: p.at, text: p.text });
      }
    }
  }
  return { entries, unmatched, gate };
}

// ---------------------------------------------------------------- verification scan

function leftovers(serialized) {
  // Scan the text as a reader sees it: JSON escapes such as \n would otherwise glue a letter
  // onto the next word.
  const text = serialized.replace(/\\[nrt"\\/]/g, " ");
  const found = [];
  if (text.includes(HOME))
    found.push(
      `home path${process.env.SCRUB_DEBUG ? ` [${text.slice(Math.max(0, text.indexOf(HOME) - 80), text.indexOf(HOME) + 60)}]` : ""}`
    );
  if (text.includes(encode(HOME))) found.push("encoded home path");
  if (new RegExp(homePrefix).test(text)) found.push("partial home path");
  const emails = text.match(EMAIL);
  if (emails) found.push(`email x${emails.length}`);
  for (const [kind, re] of SECRET_PATTERNS) {
    const m = text.match(new RegExp(re.source, re.flags));
    const real = (m ?? []).filter((x) => !x.includes("<redacted"));
    if (real.length)
      found.push(
        `${kind} x${real.length}${process.env.SCRUB_DEBUG ? ` [${real.slice(0, 2).join(" , ")}]` : ""}`
      );
  }
  for (const t of TERMS)
    if (text.includes(t)) found.push(`personal term "${t.slice(0, 2)}..."`);
  return found;
}

// ---------------------------------------------------------------- main

const sessions = selectSessions();
const stamp = (d) => d.toISOString().slice(0, 16).replace(":", "-");
for (const s of sessions) {
  const id =
    s.harness === "claude"
      ? basename(s.file, ".jsonl").replace(/^agent-/, "")
      : basename(s.file, ".jsonl").replace(/^rollout-[0-9T:-]+-/, "");
  s.id = `${stamp(s.started)}_${s.harness}_${s.lane}${s.subagent ? "_subagent" : ""}_${id.slice(0, 8)}`;
  const raw = lines(s.file).map(parse);
  s.badLines = raw.filter((d) => d === null).length;
  const scrubbed = raw
    .filter(Boolean)
    .map((d) => deep(s.harness === "claude" ? scrubClaude(d) : scrubCodex(d)));
  s.prompts = promptsOf(s, scrubbed);
  s.output = scrubbed.map((d) => JSON.stringify(d)).join("\n") + "\n";
  s.leftovers = leftovers(s.output);
}

const { entries, unmatched, gate } = crossCheck(sessions);
const rel = (p) => relative(ROOT, p);
const fmtBytes = (n) => `${(n / 1024).toFixed(0)} KiB`;

const index = [
  "# Session transcripts",
  "",
  `Raw Claude Code and Codex session transcripts for this repo, exported by \`node scripts/export-transcripts.mjs\` on ${new Date().toISOString()}. One JSONL file per session, in start order, scrubbed as described in the script header: harness context that is not a prompt is replaced by \`<omitted: ...>\` markers, home paths by \`~\`, emails by \`<email>\` and secrets or tokens by \`<redacted:kind>\`. Sessions that started before ${SINCE.toISOString()} (the first commit) are not included.`,
  "",
  "Times are UTC. Cross-check results are in [CROSS-CHECK.md](CROSS-CHECK.md).",
  "",
  "| File | Harness | Lane | Started | Ended | Size | Prompts | Why included |",
  "|---|---|---|---|---|---|---|---|",
  ...sessions.map(
    (s) =>
      `| [${s.id}.jsonl](${s.harness}/${s.id}.jsonl) | ${s.harness}${s.subagent ? " (subagent)" : ""} | ${s.lane} | ${s.started.toISOString().slice(0, 19)} | ${s.ended.toISOString().slice(0, 19)} | ${fmtBytes(s.output.length)} | ${s.subagent ? "n/a" : s.prompts.length} | ${s.reason.replace(/\|/g, "/")} |`
  ),
  ""
].join("\n");

const short = (t, n = 160) => {
  const x = norm(t);
  return x.length > n ? `${x.slice(0, n)}...` : x;
};
const missingFromTranscripts = entries.filter((e) => e.hits.length === 0);
const check = [
  "# PROMPTS.md cross-check",
  "",
  `Generated by \`node scripts/export-transcripts.mjs\` on ${new Date().toISOString()}. Read only: mismatches are reported here, never fixed by editing history. Subagent transcripts are excluded (their prompts are written by another agent, not given to it).`,
  "",
  `- Sessions checked: ${sessions.filter((s) => !s.subagent).length} (plus ${sessions.filter((s) => s.subagent).length} subagent transcripts exported, not checked)`,
  `- Prompts found in transcripts: ${sessions.reduce((n, s) => n + (s.subagent ? 0 : s.prompts.length), 0)}`,
  `- PROMPTS.md entries (by Source file): ${entries.length}, matched in a transcript: ${entries.length - missingFromTranscripts.length}`,
  `- no-mistakes gate prompts (harness-generated): ${gate.length} in ${new Set(gate.map((g) => g.run)).size} runs`,
  "",
  `## In a transcript, not in PROMPTS.md (${unmatched.length})`,
  "",
  "Short replies (under 80 characters) are usually answers to a question the agent asked; they are listed so the owner can decide whether PROMPTS.md should carry them.",
  "",
  ...unmatched.map(
    (u) =>
      `- \`${u.session}\` ${u.at ?? ""} (${norm(u.text).length} chars): ${short(u.text).replace(/\|/g, "/")}`
  ),
  "",
  `## no-mistakes gate prompts (${gate.length})`,
  "",
  "Each gate review or fix step sends Claude a generated prompt inside a fixed workspace-boundary preamble. PROMPTS.md logs the intent supplied to each gate and, where the lane could not read it from the step log, says the generated text was unavailable; the full text is in the transcript named here.",
  "",
  "| Session | At | Run | Run named in PROMPTS.md | Prompt length |",
  "|---|---|---|---|---|",
  ...gate.map(
    (g) =>
      `| \`${g.session}\` | ${g.at ?? ""} | ${g.run} | ${g.logged ? "yes" : "no"} | ${g.length} |`
  ),
  "",
  `## In PROMPTS.md, not found in any exported transcript (${missingFromTranscripts.length})`,
  "",
  ...missingFromTranscripts.map((e) => `- ${e.heading} (${e.source})`),
  ""
].join("\n");

const problems = sessions.filter((s) => s.leftovers.length || s.badLines);
for (const s of sessions)
  console.log(
    `${s.id}  ${fmtBytes(s.output.length)}  prompts=${s.subagent ? "-" : s.prompts.length}${s.badLines ? `  unparsable=${s.badLines}` : ""}${s.leftovers.length ? `  LEFTOVER: ${s.leftovers.join(", ")}` : ""}`
  );
console.log(
  `\n${sessions.length} sessions; ${unmatched.length} transcript prompts not in PROMPTS.md; ${missingFromTranscripts.length} PROMPTS.md blocks not found in a transcript; personal terms file: ${TERMS.length ? `${TERMS.length} terms` : "none"}`
);

if (!CHECK_ONLY) {
  for (const h of ["claude", "codex"])
    rmSync(join(OUT, h), { recursive: true, force: true });
  for (const s of sessions) {
    mkdirSync(join(OUT, s.harness), { recursive: true });
    writeFileSync(join(OUT, s.harness, `${s.id}.jsonl`), s.output);
  }
  writeFileSync(join(OUT, "INDEX.md"), index);
  writeFileSync(join(OUT, "CROSS-CHECK.md"), scrubString(check));
  console.log(`wrote ${rel(OUT)}/`);
  // Verify what is on disk, not what is in memory.
  // INDEX.md and CROSS-CHECK.md name sessions with ids that look like random tokens.
  const scan = (f) =>
    leftovers(readFileSync(f, "utf8")).filter(
      (x) => !(f.endsWith(".md") && x.startsWith("random-token"))
    );
  const bad = walk(OUT, () => true).filter((f) => scan(f).length);
  if (bad.length) {
    console.error(
      `scrub verification failed: ${bad.map((f) => `${rel(f)} (${scan(f).join(", ")})`).join("; ")}`
    );
    process.exit(1);
  }
}
if (problems.length) process.exit(1);
