import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AgenticReporter from '../src/reporter';
import { sanitizeId } from '../src/formatter';
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
    promises: {
      unlink: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
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

  it('writes detailed report file on failure', async () => {
    // Setup
    const config = {
      workers: 1,
      projects: [{ name: 'chromium' }],
      outputDir: 'test-results-mock',
    } as any;

    reporter.onBegin(config, { allTests: () => [mockTest] } as any);
    reporter.onTestEnd(mockTest as any, mockResult as any);
    await reporter.onEnd({ status: 'failed' } as any);

    // Verify file write
    const expectedFileName = `${sanitizeId(mockTest.titlePath().join('_'))}-details.xml`;
    const expectedPath = path.join('test-results-mock', expectedFileName);

    expect(fs.promises.mkdir).toHaveBeenCalledWith('test-results-mock', { recursive: true });
    expect(fs.promises.writeFile).toHaveBeenCalledWith(expectedPath, expect.stringContaining('<failure'));

    // Verify file content has full logs
    const callArgs = vi.mocked(fs.promises.writeFile).mock.calls[0];
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
    const expectedFileName = `${sanitizeId(mockTest.titlePath().join('_'))}-details.xml`;
    const expectedPath = path.join('test-results-mock', expectedFileName);

    expect(output).toContain(`<details_file>${expectedPath}</details_file>`);
    expect(output).toContain(`**Full Details:** ${expectedPath}`);
  });

  it('does not write file if enableDetailedReport is false', async () => {
    reporter = new AgenticReporter({ outputStream, enableDetailedReport: false });
    const config = {
        workers: 1,
        projects: [{ name: 'chromium' }],
        outputDir: 'test-results-mock',
      } as any;

    reporter.onBegin(config, { allTests: () => [mockTest] } as any);
    reporter.onTestEnd(mockTest as any, mockResult as any);
    await reporter.onEnd({ status: 'failed' } as any);

    expect(fs.promises.writeFile).not.toHaveBeenCalled();
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

  it('deletes existing failure report when test passes', async () => {
    reporter = new AgenticReporter({ outputStream, enableDetailedReport: true });
    const config = {
      workers: 1,
      projects: [{ name: 'chromium' }],
      outputDir: 'test-results-mock',
    } as any;

    const expectedFileName = `${sanitizeId(mockTest.titlePath().join('_'))}-details.xml`;
    const expectedPath = path.join('test-results-mock', expectedFileName);

    // Mock file existence in readdirSync during onBegin
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([expectedFileName] as any);

    reporter.onBegin(config, { allTests: () => [] } as any);

    // Passing test
    const passedResult = { ...mockResult, status: 'passed' };
    reporter.onTestEnd(mockTest as any, passedResult as any);

    await reporter.onEnd({ status: 'passed' } as any);

    expect(fs.promises.unlink).toHaveBeenCalledWith(expectedPath);
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
