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

function warmups(count) {
  return Math.max(20, Math.ceil(count / 10));
}

export async function perCall(count, fn) {
  for (let i = 0; i < warmups(count); i++) await fn();
  const values = [];
  for (let i = 0; i < count; i++) {
    const start = process.hrtime.bigint();
    await fn();
    values.push(Number(process.hrtime.bigint() - start) / 1e3);
  }
  return values;
}

export function perCallSync(count, fn) {
  for (let i = 0; i < warmups(count); i++) fn();
  const values = [];
  for (let i = 0; i < count; i++) {
    const start = process.hrtime.bigint();
    fn();
    values.push(Number(process.hrtime.bigint() - start) / 1e3);
  }
  return values;
}
