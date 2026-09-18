export const VALUES = 200;

export function emit(target, values, unit) {
  console.log(JSON.stringify({ target, unit, better: 'lower', values }));
}

export function emitOnce(target, value, unit) {
  console.log(JSON.stringify({ target, unit, better: 'lower', value }));
}

export function absent(...targets) {
  for (const target of targets) console.log(JSON.stringify({ target, absent: true }));
}

export async function repeat(count, fn) {
  const values = [];
  for (let i = 0; i < count; i++) values.push(await fn());
  return values;
}

const WARM_MS = 300;

function warmups(count) {
  return Math.max(20, Math.ceil(count / 10));
}

function warm(calls, count, since) {
  return calls >= warmups(count) && performance.now() - since >= WARM_MS;
}

export async function perCall(count, fn) {
  const since = performance.now();
  for (let calls = 0; !warm(calls, count, since); calls++) await fn();
  const values = [];
  for (let i = 0; i < count; i++) {
    const start = process.hrtime.bigint();
    await fn();
    values.push(Number(process.hrtime.bigint() - start) / 1e3);
  }
  return values;
}

export function perCallSync(count, fn) {
  const since = performance.now();
  for (let calls = 0; !warm(calls, count, since); calls++) fn();
  const values = [];
  for (let i = 0; i < count; i++) {
    const start = process.hrtime.bigint();
    fn();
    values.push(Number(process.hrtime.bigint() - start) / 1e3);
  }
  return values;
}

export function bothNames(env) {
  const kept = Object.entries(env).filter(([name]) => !name.startsWith('DANDELION_'));
  const mirrored = kept.filter(([name]) => name.startsWith('ALLOWANCE_')).map(([name, value]) => [`DANDELION_${name.slice('ALLOWANCE_'.length)}`, value]);
  return Object.fromEntries([...kept, ...mirrored]);
}
