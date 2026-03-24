import type { Usage } from './types.js';

// ─── Debug state ──────────────────────────────────────────────────────────────

let _debug = false;
let _suppressAgentPrompt = false; // set by skill to avoid duplicate ⟶ lines
const _cumulative: Usage = { inputTokens: 0, outputTokens: 0 };

/** @internal — suppress agent-level prompt logging when inside a skill. */
export function enterSkillContext(): void  { _suppressAgentPrompt = true; }
/** @internal */
export function exitSkillContext(): void   { _suppressAgentPrompt = false; }

export function setDebug(enabled: boolean): void {
  _debug = enabled;
  if (!enabled) resetTokenUsage();
}

export function isDebug(): boolean {
  return _debug;
}

/**
 * Add a usage snapshot to the session-wide token accumulator.
 * Called automatically after every LLM response.
 */
export function trackUsage(usage: Usage): void {
  _cumulative.inputTokens += usage.inputTokens;
  _cumulative.outputTokens += usage.outputTokens;
}

/** Reset the session-wide token counter. */
export function resetTokenUsage(): void {
  _cumulative.inputTokens = 0;
  _cumulative.outputTokens = 0;
}

/** Return a snapshot of total tokens used since the last reset. */
export function getTokenUsage(): Readonly<Usage> {
  return { ..._cumulative };
}

// ─── ANSI colors (disabled when stderr is not a TTY or NO_COLOR is set) ──────

const tty = Boolean(process.stderr.isTTY) && !process.env['NO_COLOR'];
const esc = (code: string) => (tty ? `\x1b[${code}m` : '');

const R  = esc('0');   // reset
const b  = esc('1');   // bold
const d  = esc('2');   // dim
const BL = esc('34');  // blue
const CY = esc('36');  // cyan
const GR = esc('32');  // green
const YE = esc('33');  // yellow
const RE = esc('31');  // red
const MA = esc('35');  // magenta
const GY = esc('90');  // gray

// ─── Utilities ────────────────────────────────────────────────────────────────

function out(line: string): void {
  process.stderr.write(line + '\n');
}

/** Collapse newlines and truncate long strings for single-line display. */
function trunc(s: string, max = 120): string {
  const flat = s.replace(/\r?\n/g, '↵ ').replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max) + `${GY}…${R}`;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtUsage(usage: Usage): string {
  return `${GY}in=${R}${usage.inputTokens} ${GY}out=${R}${usage.outputTokens} ${GY}total=${R}${usage.inputTokens + usage.outputTokens}`;
}

function fmtCumulative(): string {
  const total = _cumulative.inputTokens + _cumulative.outputTokens;
  return `${d}${GY}session in=${R}${d}${_cumulative.inputTokens} ${GY}out=${R}${d}${_cumulative.outputTokens} ${GY}total=${R}${d}${total}${R}`;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export function agentIteration(model: string, iteration: number, maxIterations: number): void {
  if (!_debug) return;
  out(`${BL}${b}▸ agent${R}  ${d}${model}${R}  ${GY}iteration ${iteration}/${maxIterations}${R}`);
}

export function agentPrompt(prompt: string): void {
  if (!_debug || _suppressAgentPrompt) return;
  out(`  ${CY}⟶${R}  ${trunc(prompt)}`);
}

export function agentToolCall(name: string, input: Record<string, unknown>): void {
  if (!_debug) return;
  out(`    ${YE}⚙${R}  ${b}${name}${R}  ${d}${trunc(JSON.stringify(input))}${R}`);
}

export function agentToolResult(result: string, isError: boolean): void {
  if (!_debug) return;
  const icon = isError ? `${RE}✗${R}` : `${GR}✓${R}`;
  out(`    ${icon}  ${d}${trunc(result)}${R}`);
}

export function agentResponse(
  stopReason: string,
  text: string,
  elapsedMs: number,
  usage: Usage,
): void {
  if (!_debug) return;
  trackUsage(usage);
  out(`  ${MA}⟵${R}  ${d}${stopReason}${R}  ${GY}${fmtMs(elapsedMs)}${R}  ${fmtUsage(usage)}`);
  if (text) out(`     ${d}${trunc(text)}${R}`);
}

export function agentDone(usage: Usage): void {
  if (!_debug) return;
  out(`  ${GR}✓${R}  ${fmtUsage(usage)}  ${d}·${R}  ${fmtCumulative()}`);
  out('');
}

// ─── Skill ────────────────────────────────────────────────────────────────────

export function skillStart(instructions: string): void {
  if (!_debug) return;
  out(`${BL}${b}▸ skill${R}  ${d}${trunc(instructions, 60)}${R}`);
}

export function skillPrompt(prompt: string): void {
  if (!_debug) return;
  out(`  ${CY}⟶${R}  ${trunc(prompt)}`);
}

export function skillDone(structured: unknown, usage: Usage): void {
  if (!_debug) return;
  out(`  ${MA}⟵${R}  ${d}${trunc(JSON.stringify(structured))}${R}`);
  // usage already tracked at agent level; just display
  out(`  ${GR}✓${R}  ${fmtUsage(usage)}  ${d}·${R}  ${fmtCumulative()}`);
  out('');
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export function workflowStageStart(type: 'parallel' | 'serial', stepNames: string[]): void {
  if (!_debug) return;
  const label =
    type === 'parallel'
      ? `${CY}parallel${R}  ${d}[${stepNames.join(', ')}]${R}`
      : `${CY}serial${R}  ${d}${stepNames[0] ?? ''}${R}`;
  out(`${BL}${b}▸ workflow${R}  ${label}`);
}

export function workflowStageDone(elapsedMs: number): void {
  if (!_debug) return;
  out(`  ${GR}✓${R}  ${GY}${fmtMs(elapsedMs)}${R}`);
  out('');
}

// ─── Refine ───────────────────────────────────────────────────────────────────

export function refineIteration(iteration: number, maxIterations: number): void {
  if (!_debug) return;
  out(`${BL}${b}▸ refine${R}  ${GY}iteration ${iteration}/${maxIterations}${R}`);
}

export function refineUntilResult(done: boolean): void {
  if (!_debug) return;
  if (done) {
    out(`  ${GR}✓${R}  ${d}condition met${R}`);
  } else {
    out(`  ${YE}↺${R}  ${d}continuing${R}`);
  }
}

export function refineDone(iterations: number): void {
  if (!_debug) return;
  out(`  ${GR}✓${R}  ${d}completed in ${iterations} iteration(s)${R}`);
  out('');
}
