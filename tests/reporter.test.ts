import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AgenticReporter from '../src/reporter';
import * as fs from 'fs';
import * as path from 'path';
import { PassThrough } from 'stream';

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(),
    readSync: vi.fn(),
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  return undefined as never;
});

describe('AgenticReporter', () => {
  let outputStream: PassThrough;
  let reporter: AgenticReporter;

  beforeEach(() => {
    outputStream = new PassThrough();
    reporter = new AgenticReporter({ outputStream, enableDetailedReport: true });
    mockExit.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockTest = {
    title: 'should fail',
    titlePath: () => ['tests', 'example.spec.ts', 'should fail'],
    location: { file: 'tests/example.spec.ts', line: 10 },
    parent: {
      project: () => ({ name: 'chromium' }),
    },
  };

  const mockResult = {
    status: 'failed',
    duration: 100,
    retry: 0,
    error: {
      message: 'Test failed',
      stack: 'Error: Test failed\n    at tests/example.spec.ts:10:5',
    },
    stdout: ['console log 1\n', 'console log 2\n'],
    stderr: ['console error 1\n'],
    attachments: [],
  };

  it('writes detailed report file on failure', () => {
    // Setup
    const config = {
      workers: 1,
      projects: [{ name: 'chromium' }],
      outputDir: 'test-results-mock',
    } as any;

    reporter.onBegin(config, { allTests: () => [mockTest] } as any);
    reporter.onTestEnd(mockTest as any, mockResult as any);

    // Verify file write
    const expectedFileName = 'tests_example_spec_ts_should_fail-details.xml';
    const expectedPath = path.join('test-results-mock', expectedFileName);

    expect(fs.mkdirSync).toHaveBeenCalledWith('test-results-mock', { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(expectedPath, expect.stringContaining('<failure'));

    // Verify file content has full logs
    const callArgs = vi.mocked(fs.writeFileSync).mock.calls[0];
    const fileContent = callArgs[1] as string;
    expect(fileContent).toContain('console log 1');
    expect(fileContent).toContain('console log 2');
    expect(fileContent).toContain('console error 1');
  });

  it('includes details file link in standard output', async () => {
    const config = {
        workers: 1,
        projects: [{ name: 'chromium' }],
        outputDir: 'test-results-mock',
      } as any;

    reporter.onBegin(config, { allTests: () => [mockTest] } as any);
    reporter.onTestEnd(mockTest as any, mockResult as any);

    const output = await streamToString(outputStream);
    const expectedFileName = 'tests_example_spec_ts_should_fail-details.xml';
    const expectedPath = path.join('test-results-mock', expectedFileName);

    expect(output).toContain(`<details_file>${expectedPath}</details_file>`);
    expect(output).toContain(`**Full Details:** ${expectedPath}`);
  });

  it('does not write file if enableDetailedReport is false', () => {
    reporter = new AgenticReporter({ outputStream, enableDetailedReport: false });
    const config = {
        workers: 1,
        projects: [{ name: 'chromium' }],
        outputDir: 'test-results-mock',
      } as any;

    reporter.onBegin(config, { allTests: () => [mockTest] } as any);
    reporter.onTestEnd(mockTest as any, mockResult as any);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('exits immediately when max failures exceeded (default behavior)', () => {
    reporter = new AgenticReporter({
      outputStream,
      maxFailures: 1,
    });
    const config = { workers: 1, projects: [] } as any;

    reporter.onBegin(config, { allTests: () => [] } as any);

    // First failure
    reporter.onTestEnd(mockTest as any, mockResult as any);
    expect(mockExit).not.toHaveBeenCalled();

    // Second failure - should trigger exit
    reporter.onTestEnd(mockTest as any, mockResult as any);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('does not exit by default (maxFailures is false/Infinity)', () => {
    // Default options
    reporter = new AgenticReporter({
      outputStream,
    });
    const config = { workers: 1, projects: [] } as any;

    reporter.onBegin(config, { allTests: () => [] } as any);

    // 10 failures
    for (let i = 0; i < 10; i++) {
        reporter.onTestEnd(mockTest as any, mockResult as any);
    }

    expect(mockExit).not.toHaveBeenCalled();
  });

  it('does not exit if maxFailures is explicitly false', () => {
    reporter = new AgenticReporter({
      outputStream,
      maxFailures: false,
    });
    const config = { workers: 1, projects: [] } as any;

    reporter.onBegin(config, { allTests: () => [] } as any);

    // 10 failures
    for (let i = 0; i < 10; i++) {
        reporter.onTestEnd(mockTest as any, mockResult as any);
    }

    expect(mockExit).not.toHaveBeenCalled();
  });

  it('deletes existing failure report when test passes', () => {
    reporter = new AgenticReporter({ outputStream, enableDetailedReport: true });
    const config = {
        workers: 1,
        projects: [{ name: 'chromium' }],
        outputDir: 'test-results-mock',
      } as any;

    // Mock file existence
    vi.mocked(fs.existsSync).mockReturnValue(true);

    reporter.onBegin(config, { allTests: () => [] } as any);

    // Passing test
    const passedResult = { ...mockResult, status: 'passed' };
    reporter.onTestEnd(mockTest as any, passedResult as any);

    const expectedFileName = 'tests_example_spec_ts_should_fail-details.xml';
    const expectedPath = path.join('test-results-mock', expectedFileName);

    expect(fs.unlinkSync).toHaveBeenCalledWith(expectedPath);
  });

  it('warns about previous reports but continues', async () => {
    reporter = new AgenticReporter({
      outputStream,
      checkPreviousReports: true
    });
    const config = {
        workers: 1,
        projects: [{ name: 'chromium' }],
        outputDir: 'test-results-mock',
      } as any;

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
        'test-details.xml',
    ] as any);

    reporter.onBegin(config, { allTests: () => [] } as any);

    const output = await streamToString(outputStream);

    expect(output).toContain('<agentic-warning type="previous_failures">');
    expect(output).toContain('test-details.xml');

    // Should NOT exit and NOT ask for input
    expect(mockExit).not.toHaveBeenCalled();
    expect(fs.readSync).not.toHaveBeenCalled();
  });

  it('uses custom reproduce command if provided', async () => {
    reporter = new AgenticReporter({
      outputStream,
      getReproduceCommand: (data) => `custom run ${data.file}:${data.line} --p=${data.project}`,
    });
    const config = {
      workers: 1,
      projects: [{ name: 'chromium' }],
      outputDir: 'test-results-mock',
    } as any;

    reporter.onBegin(config, { allTests: () => [mockTest] } as any);
    reporter.onTestEnd(mockTest as any, mockResult as any);

    const output = await streamToString(outputStream);

    expect(output).toContain('<reproduce_command>custom run tests/example.spec.ts:10 --p=chromium</reproduce_command>');
  });

  it('correctly resolves project name from test parent', async () => {
    reporter = new AgenticReporter({ outputStream });
    const config = {
      workers: 1,
      projects: [{ name: 'chromium' }, { name: 'firefox' }],
      outputDir: 'test-results-mock',
    } as any;

    const firefoxTest = {
      ...mockTest,
      parent: {
        project: () => ({ name: 'firefox' }),
      },
    };

    reporter.onBegin(config, { allTests: () => [firefoxTest] } as any);
    reporter.onTestEnd(firefoxTest as any, mockResult as any);

    const output = await streamToString(outputStream);

    expect(output).toContain('--project=firefox');
  });
});

function streamToString(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    stream.on('data', (chunk) => {
      data += chunk.toString();
    });
    stream.end();
    stream.on('finish', () => {
        resolve(data);
    })
  });
}
