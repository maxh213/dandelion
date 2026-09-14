import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandRunnerResult } from './cli.ts';
import { probeCodex, type CodexIo, type RpcChild } from './codex.ts';

const NOW = '2026-09-13T10:00:00Z';
const CHATGPT: CommandRunnerResult = { stdout: '', stderr: 'Logged in using ChatGPT\n' };
const API_KEY_LINE = 'Logged in using an API key - sk-proj-***n5zQA';
const HAPPY_LIMITS = {
  limitId: 'codex',
  planType: 'plus',
  primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1789302600 },
  secondary: { usedPercent: 86, windowDurationMins: 10080, resetsAt: 1789552800 }
};
const IDENTITY = { id: 'codex', displayName: 'codex', planLabel: 'codex', fetchedAt: NOW };

type FakeChild = RpcChild & { sent: string[]; stops: number };

function answerLines(limits: unknown): string[] {
  return [
    JSON.stringify({ id: 1, result: { userAgent: 'fixture' } }),
    JSON.stringify({ method: 'remoteControl/status/changed', params: { status: 'disabled' } }),
    JSON.stringify({ id: 2, result: { rateLimits: limits }, rateLimitsByLimitId: null })
  ];
}

function fakeChild(lines: AsyncIterable<string>): FakeChild {
  const child: FakeChild = {
    lines,
    sent: [],
    stops: 0,
    send: (message) => {
      child.sent.push(message);
    },
    stop: async () => {
      child.stops += 1;
    }
  };
  return child;
}

async function* listOf(lines: string[]): AsyncIterable<string> {
  yield* lines;
}

function hangingChild(): FakeChild {
  let finish: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const ended: IteratorResult<string> = { done: true, value: undefined };
  const child = fakeChild({ [Symbol.asyncIterator]: () => ({ next: () => stopped.then(() => ended) }) });
  child.stop = async () => {
    child.stops += 1;
    finish();
  };
  return child;
}

function ioWith(login: CommandRunnerResult, child: FakeChild = fakeChild(listOf(answerLines(HAPPY_LIMITS)))) {
  const runs: [string, string[], number][] = [];
  const spawns: [string, string[]][] = [];
  const io: CodexIo = {
    runner: {
      run: async (command, args, timeoutMs) => {
        runs.push([command, args, timeoutMs]);
        return login;
      }
    },
    spawner: {
      spawn: (command, args) => {
        spawns.push([command, args]);
        return child;
      }
    }
  };
  return { io, runs, spawns, child };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('probeCodex login', () => {
  it('reads the rate limits from codex app-server in ChatGPT mode', async () => {
    const { io, runs, spawns, child } = ioWith(CHATGPT);
    const usage = await probeCodex(io, NOW);
    expect(runs).toEqual([['codex', ['login', 'status'], 15000]]);
    expect(spawns).toEqual([['codex', ['app-server']]]);
    expect(child.sent).toEqual([
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"dandelion","title":null,"version":"0.1.0"}}}',
      '{"jsonrpc":"2.0","method":"initialized"}',
      '{"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read","params":{}}'
    ]);
    expect(usage).toStrictEqual({
      ...IDENTITY,
      windows: [
        { label: '5h', usedPct: 42, resetsAt: '2026-09-13T12:30:00.000Z' },
        { label: 'weekly', usedPct: 86, resetsAt: '2026-09-16T10:00:00.000Z' }
      ],
      status: 'ok'
    });
    expect(child.stops).toBe(1);
  });

  it.each<[string, CommandRunnerResult]>([
    ['stderr', { stdout: '', stderr: `${API_KEY_LINE}\n` }],
    ['stdout', { stdout: `${API_KEY_LINE}\n`, stderr: '' }],
    ['stderr after a stdout banner without a newline', { stdout: 'banner', stderr: API_KEY_LINE }],
    ['stdout after another line', { stdout: `WARNING: something\n${API_KEY_LINE}\n`, stderr: 'ChatGPT' }]
  ])('is an ok API-key panel with a note and no app-server when the key line is on %s', async (_case, login) => {
    const { io, spawns } = ioWith(login);
    expect(await probeCodex(io, NOW)).toStrictEqual({ ...IDENTITY, windows: [], status: 'ok', note: 'api-key billing · no usage windows' });
    expect(spawns).toEqual([]);
  });

  it.each<[string, CommandRunnerResult, string]>([
    ['codex is missing', { stdout: '', stderr: '', failure: 'missing' }, 'codex CLI not found in PATH'],
    ['login status hangs', { stdout: '', stderr: '', failure: 'timeout' }, 'Command timed out after 15s'],
    ['not logged in exits 1', { stdout: '', stderr: 'Not logged in', failure: 'exit' }, 'codex is not logged in'],
    ['a ChatGPT line exits 1', { stdout: '', stderr: 'Logged in using ChatGPT', failure: 'exit' }, 'codex is not logged in'],
    ['an API-key line exits 1', { stdout: '', stderr: API_KEY_LINE, failure: 'exit' }, 'codex is not logged in'],
    ['unknown text exits 0', { stdout: 'hello', stderr: '' }, 'codex is not logged in'],
    ['an API-key line mid-line exits 0', { stdout: `note: ${API_KEY_LINE}`, stderr: '' }, 'codex is not logged in']
  ])('is unavailable without starting app-server when %s', async (_case, login, reason) => {
    const { io, spawns } = ioWith(login);
    expect(await probeCodex(io, NOW)).toStrictEqual({ ...IDENTITY, windows: [], status: 'unavailable', reason });
    expect(spawns).toEqual([]);
  });
});

describe('probeCodex rate limits', () => {
  it.each<[unknown, unknown[]]>([
    [{ primary: { usedPercent: 33.5, windowDurationMins: 300 }, secondary: null }, [{ label: '5h', usedPct: 34 }]],
    [{ primary: null, secondary: { usedPercent: 130, windowDurationMins: 10080, resetsAt: 'soon' } }, [{ label: 'weekly', usedPct: 130 }]],
    [{ primary: { usedPercent: 0, windowDurationMins: 1440, resetsAt: null } }, [{ label: '1d', usedPct: 0 }]],
    [{ primary: { usedPercent: 10, windowDurationMins: 90 }, secondary: { usedPercent: 'x' } }, [{ label: '90m', usedPct: 10 }]],
    [{ primary: { usedPercent: 10 }, secondary: { usedPercent: -1, windowDurationMins: 300 } }, [{ label: 'primary', usedPct: 10 }]],
    [{ secondary: { usedPercent: 5, windowDurationMins: 0 } }, [{ label: 'secondary', usedPct: 5 }]],
    [{ primary: { usedPercent: 5, windowDurationMins: 2.5 }, secondary: { usedPercent: 6, windowDurationMins: '300' } }, [{ label: 'primary', usedPct: 5 }, { label: 'secondary', usedPct: 6 }]],
    [{ primary: { usedPercent: 5, windowDurationMins: 60 }, secondary: { usedPercent: 6, windowDurationMins: 20160 } }, [{ label: '1h', usedPct: 5 }, { label: '14d', usedPct: 6 }]],
    [{ primary: { usedPercent: 5, windowDurationMins: -60 }, secondary: { usedPercent: Infinity } }, [{ label: 'primary', usedPct: 5 }]],
    [{ primary: { usedPercent: 5, windowDurationMins: 1, resetsAt: 1e20 } }, [{ label: '1m', usedPct: 5 }]],
    [{ primary: { usedPercent: 5, resetsAt: 0 } }, [{ label: 'primary', usedPct: 5, resetsAt: '1970-01-01T00:00:00.000Z' }]]
  ])('maps rate limits %j', async (limits, windows) => {
    const { io } = ioWith(CHATGPT, fakeChild(listOf(answerLines(limits))));
    expect(await probeCodex(io, NOW)).toStrictEqual({ ...IDENTITY, windows, status: 'ok' });
  });

  it('ignores non-JSON lines, notifications and other ids before the answer', async () => {
    const lines = [
      'not json',
      JSON.stringify({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 } } } }),
      JSON.stringify({ id: '2', result: { rateLimits: { primary: { usedPercent: 98 } } } }),
      'null',
      ...answerLines(HAPPY_LIMITS),
      JSON.stringify({ id: 2, result: { rateLimits: { primary: { usedPercent: 97 } } } })
    ];
    const usage = await probeCodex(ioWith(CHATGPT, fakeChild(listOf(lines))).io, NOW);
    expect(usage.windows.map((window) => window.usedPct)).toEqual([42, 86]);
  });

  it('reads the answer even when a null error field is present', async () => {
    const lines = [JSON.stringify({ id: 2, error: null, result: { rateLimits: { primary: { usedPercent: 1 } } } })];
    expect(await probeCodex(ioWith(CHATGPT, fakeChild(listOf(lines))).io, NOW)).toMatchObject({ status: 'ok' });
  });

  it.each<[string, string[], string]>([
    ['a JSON-RPC error', ['{"error":{"code":-32600,"message":"chatgpt authentication required to read rate limits"},"id":2}'], 'chatgpt authentication required to read rate limits'],
    ['a JSON-RPC error without a message', ['{"error":{"code":-32600},"id":2}'], 'codex app-server error'],
    ['a JSON-RPC error with an empty message', ['{"error":{"code":-32600,"message":""},"id":2}'], 'codex app-server error'],
    ['an exit without output', [], 'codex app-server exited without answering'],
    ['an exit after only notifications', answerLines(HAPPY_LIMITS).slice(0, 2), 'codex app-server exited without answering'],
    ['null windows', ['{"id":2,"result":{"rateLimits":{"primary":null,"secondary":null}}}'], 'Could not parse rate limits from response'],
    ['a null result', ['{"id":2,"result":null}'], 'Could not parse rate limits from response']
  ])('is an error and stops the child on %s', async (_case, lines, reason) => {
    const { io, child } = ioWith(CHATGPT, fakeChild(listOf(lines)));
    expect(await probeCodex(io, NOW)).toStrictEqual({ ...IDENTITY, windows: [], status: 'error', reason });
    expect(child.stops).toBe(1);
  });

  it('is an error and stops the child when talking to app-server throws', async () => {
    const child = fakeChild(listOf([]));
    child.send = () => {
      throw new Error('EPIPE');
    };
    expect(await probeCodex(ioWith(CHATGPT, child).io, NOW)).toMatchObject({ status: 'error', reason: 'codex app-server failed' });
    expect(child.stops).toBe(1);
  });

  it('gives up after 30s without an answer to id 2 and stops the child', async () => {
    vi.useFakeTimers();
    const child = hangingChild();
    let settled = false;
    const probe = probeCodex(ioWith(CHATGPT, child).io, NOW).then((usage) => {
      settled = true;
      return usage;
    });
    await vi.advanceTimersByTimeAsync(29999);
    expect(settled).toBe(false);
    expect(child.stops).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await probe).toStrictEqual({ ...IDENTITY, windows: [], status: 'error', reason: 'codex app-server did not answer within 30s' });
    expect(child.stops).toBe(1);
  });

  it('clears its 30s timer once the answer arrives', async () => {
    vi.useFakeTimers();
    await probeCodex(ioWith(CHATGPT).io, NOW);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for the child to stop before resolving', async () => {
    let stopped = false;
    const child = fakeChild(listOf(answerLines(HAPPY_LIMITS)));
    child.stop = () => new Promise((resolve) => setTimeout(() => { stopped = true; resolve(); }, 5));
    await probeCodex(ioWith(CHATGPT, child).io, NOW);
    expect(stopped).toBe(true);
  });
});
