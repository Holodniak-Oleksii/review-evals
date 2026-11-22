import { relativeTo } from './paths';

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface TestCase {
  id: string;
  status: TestStatus;
}

interface JestLikeReport {
  testResults?: Array<{
    name?: string;
    status?: string;
    assertionResults?: Array<{ fullName?: string; title?: string; status?: string }>;
  }>;
}

export function parseTestReport(json: string, dirs: readonly string[]): TestCase[] | undefined {
  let report: JestLikeReport;
  try {
    report = JSON.parse(json) as JestLikeReport;
  } catch {
    return undefined;
  }
  if (!Array.isArray(report.testResults)) return undefined;

  const cases: TestCase[] = [];
  for (const suite of report.testResults) {
    const file = suite.name ? relativeTo(dirs, suite.name) : '?';
    const assertions = suite.assertionResults ?? [];
    for (const assertion of assertions) {
      cases.push({
        id: `${file} > ${assertion.fullName ?? assertion.title ?? '?'}`,
        status: normalizeStatus(assertion.status),
      });
    }
    if (suite.status === 'failed' && !assertions.some((a) => a.status === 'failed')) {
      cases.push({ id: `${file} > (файл тестів)`, status: 'failed' });
    }
  }
  return cases;
}

export interface TestComparison {
  broken: string[];
  fixed: string[];
  passingAfter: number;
  failingBefore: number;
  total: number;
}

export function compareTests(before: TestCase[], after: TestCase[]): TestComparison {
  const statusBefore = new Map(before.map((test) => [test.id, test.status]));
  const statusAfter = new Map(after.map((test) => [test.id, test.status]));

  const broken = after
    .filter((test) => test.status === 'failed' && statusBefore.get(test.id) !== 'failed')
    .map((test) => test.id);
  const fixed = before
    .filter((test) => test.status === 'failed' && statusAfter.get(test.id) === 'passed')
    .map((test) => test.id);

  return {
    broken,
    fixed,
    passingAfter: after.filter((test) => test.status === 'passed').length,
    failingBefore: before.filter((test) => test.status === 'failed').length,
    total: after.length,
  };
}

function normalizeStatus(status: string | undefined): TestStatus {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  return 'skipped';
}
