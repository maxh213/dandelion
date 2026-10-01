import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROUTE_LINES = {
  route: {
    claude: { standard: 'model-alpha-5 high', max: 'model-alpha-5 max' },
    'claude-work': { standard: 'model-alpha-5 high', max: 'model-alpha-5 max' },
    'claude-deepseek': { standard: 'vendor/model-o max', max: 'vendor/model-o max' },
    agy: { standard: 'model-charlie-98-fast high', max: 'model-charlie-9-pro high' },
    kimi: { standard: 'model-dlt/d3 max', max: 'model-dlt/d3 max' },
    grok: { standard: 'model-e9 xhigh', max: 'model-e9 xhigh' },
    cursor: { standard: 'model-fox-1', max: 'model-fox-1' },
    junie: { standard: 'model-golf-3.8.1 high', max: 'model-golf-3.8.1 high' },
    hermes: { standard: 'vndr/model-h9 xhigh', max: 'vndr/model-h9 xhigh' }
  },
  high: { fable: 'model-hi-fable-1 max', cursor: 'model-fox-1', opus: 'model-alpha-5 max', grok: 'model-e9 xhigh', agy: 'model-charlie-98-fast high' }
};

export const BAD_ROUTES = { ...ROUTE_LINES, route: { ...ROUTE_LINES.route, 'claude-wrok': ROUTE_LINES.route.claude } };

export function writeRoutes(dir, content = ROUTE_LINES, name = 'routes.json') {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
  return path;
}

export const fileReader = { read: (path) => readFileSync(path, 'utf8') };

const LINE_OUTPUT = /^\S+( \S+)? \S+$/;

export function routing(domain) {
  const fromFile = typeof domain.openRoutes === 'function';
  const L = ROUTE_LINES;
  const lineOf = (id, rule) => (rule === 'standard' || rule === 'max' ? L.route[id][rule] : L.high[rule]);
  const matches = (actual, id, rule) => (id === 'none' ? actual === 'none' : fromFile ? actual === `${lineOf(id, rule)} ${id}` : LINE_OUTPUT.test(actual) && actual.endsWith(` ${id}`));
  return {
    fromFile,
    routeLine: fromFile ? (usages, now, midnight, ineligible) => domain.routeLine(L, usages, now, midnight, ineligible) : (usages, now, midnight, ineligible) => domain.routeLine(usages, now, midnight, ineligible),
    highRouteLine: fromFile ? (usages, ineligible) => domain.highRouteLine(L, usages, ineligible) : (usages, ineligible) => domain.highRouteLine(usages, ineligible),
    renderRoute: fromFile ? (render, usages, ineligible, request) => render.renderRoute(L, usages, ineligible, request) : (render, usages, ineligible, request) => render.renderRoute(usages, ineligible, request),
    printed: (output) => (fromFile ? output.out.replace(/\n$/, '') : output.line),
    routed: (output) => (fromFile ? output.code === 0 : output.routed),
    expectLine(actual, wanted, what) {
      if (!wanted.some(([id, rule]) => matches(actual, id, rule))) throw new Error(`${what}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}${fromFile ? ' from the fixture routes file' : ''}`);
    }
  };
}
