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
    readFileSync: vi.fn(),
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
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining('<failure')
    );

    // Verify file content has full logs
    const callArgs = vi
      .mocked(fs.writeFileSync)
      .mock.calls.find(([filePath]) => filePath === expectedPath);
    expect(callArgs).toBeDefined();
    if (!callArgs) return;
    const fileContent = callArgs[1] as string;
    expect(fileContent).toContain('console log 1');
    expect(fileContent).toContain('console log 2');
    expect(fileContent).toContain('console error 1');
  });

  it('writes a run manifest at begin and finalizes it at end', () => {
    const config = createConfig();

    reporter.onBegin(config, createSuite([mockTest]));
    reporter.onEnd({ status: 'failed' } as unknown as Parameters<AgenticReporter['onEnd']>[0]);

    const manifestPath = path.join('test-results-mock', 'agentic-run-manifest.json');
    const manifestWrites = vi
      .mocked(fs.writeFileSync)
      .mock.calls.filter(([filePath]) => filePath === manifestPath)
      .map(([, content]) => JSON.parse(String(content)) as Record<string, unknown>);

    expect(manifestWrites).toHaveLength(2);
    expect(manifestWrites[0]).toMatchObject({
      project: 'chromium',
      status: 'running',
      totalTests: 1,
      workers: 1,
    });
    expect(manifestWrites[0].runId).toEqual(expect.stringMatching(/^agentic-/));
    expect(manifestWrites[1]).toMatchObject({
      runId: manifestWrites[0].runId,
      status: 'failed',
      failed: 0,
      passed: 0,
      skipped: 0,
    });
  });

  it('uses project outputDir and test-results fallback for manifests', () => {
    reporter.onBegin(
      {
        workers: 1,
        projects: [{ name: 'chromium', outputDir: 'project-results' }],
      } as unknown as Parameters<AgenticReporter['onBegin']>[0],
      createSuite([])
    );

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join('project-results', 'agentic-run-manifest.json'),
      expect.any(String)
    );

    vi.clearAllMocks();
    reporter = new AgenticReporter({ outputStream, enableDetailedReport: true });
    reporter.onBegin(
      { workers: 1, projects: [] } as unknown as Parameters<AgenticReporter['onBegin']>[0],
      createSuite([])
    );

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join('test-results', 'agentic-run-manifest.json'),
      expect.any(String)
    );
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

    const detailWrites = vi
      .mocked(fs.writeFileSync)
      .mock.calls.filter(([filePath]) => String(filePath).endsWith('-details.xml'));
    expect(detailWrites).toHaveLength(0);
  });

  it('exits immediately when max failures exceeded if option is enabled', () => {
    reporter = new AgenticReporter({
      outputStream,
      maxFailures: 1,
      exitOnExceedingMaxFailures: true,
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

  it('checks for previous reports and exits if user says no', () => {
    reporter = new AgenticReporter({
      outputStream,
      checkPreviousReports: true,
    });
    const config = {
      workers: 1,
      projects: [{ name: 'chromium' }],
      outputDir: 'test-results-mock',
    } as any;

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['test-details.xml'] as any);

    // Mock user input 'n'
    mockReadInput('n');

    reporter.onBegin(config, { allTests: () => [] } as any);

    expect(fs.readdirSync).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('checks for previous reports and continues if user says yes', () => {
    reporter = new AgenticReporter({
      outputStream,
      checkPreviousReports: true,
    });
    const config = {
      workers: 1,
      projects: [{ name: 'chromium' }],
      outputDir: 'test-results-mock',
    } as any;

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['test-details.xml'] as any);

    // Mock user input 'y'
    mockReadInput('y');

    reporter.onBegin(config, { allTests: () => [] } as any);

    expect(fs.readdirSync).toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('displays structured prompt with failure list', async () => {
    reporter = new AgenticReporter({
      outputStream,
      checkPreviousReports: true,
    });
    const config = {
      workers: 1,
      projects: [{ name: 'chromium' }],
      outputDir: 'test-results-mock',
    } as any;

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      'test-details.xml',
      'my_test_spec_ts_fail-details.xml',
      'special&test-details.xml',
      'other_file.txt',
    ] as any);

    // Mock user input 'n' to exit
    mockReadInput('n');

    reporter.onBegin(config, { allTests: () => [] } as any);

    const output = await streamToString(outputStream);

    expect(output).toContain('<agentic-prompt type="decision">');
    expect(output).toContain('<title>Previous Failure Reports Detected</title>');
    expect(output).toContain('<failures>');
    expect(output).toContain('test-details.xml');
    expect(output).toContain('my_test_spec_ts_fail-details.xml');
    expect(output).toContain('special&amp;test-details.xml');
    expect(output).toContain(
      'Do you want to ignore these failures and run the tests anyway? (y/n)'
    );

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('validates invalid numeric options and falls back to defaults', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    reporter = new AgenticReporter({
      outputStream,
      maxFailures: 0,
      maxStackFrames: 0,
    });

    reporter.onBegin(createConfig(), createSuite([]));

    expect(warnSpy).toHaveBeenCalledWith(
      '[AgenticReporter] maxFailures must be >= 1, using default'
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[AgenticReporter] maxStackFrames must be >= 1, using default'
    );

    warnSpy.mockRestore();
    vi.mocked(fs.writeFileSync).mockReset();
  });

  it('uses process stdout as the default output stream option', () => {
    const defaultReporter = new AgenticReporter();

    expect(defaultReporter).toBeInstanceOf(AgenticReporter);
  });

  it('uses chromium fallback when first project has no name', async () => {
    reporter.onBegin(
      { ...createConfig(), projects: [{ name: '' }] } as unknown as Parameters<
        AgenticReporter['onBegin']
      >[0],
      createSuite([mockTest])
    );
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      mockResult as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    const output = await streamToString(outputStream);

    expect(output).toContain('--project=chromium');
  });

  it('swallows stdout and stderr hook events', async () => {
    reporter.onStdOut('ignored stdout');
    reporter.onStdErr(Buffer.from('ignored stderr'));

    const output = await streamToString(outputStream);

    expect(output).toBe('');
  });

  it('counts skipped tests and emits final summary', async () => {
    reporter.onBegin(createConfig(), createSuite([mockTest]));
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      { ...mockResult, status: 'skipped' } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );
    reporter.onEnd({ status: 'passed' } as unknown as Parameters<AgenticReporter['onEnd']>[0]);

    const output = await streamToString(outputStream);

    expect(output).toContain('skipped="1"');
    expect(output).toContain('<result_summary status="passed"');
  });

  it('emits overflow warning in final summary when failures were suppressed', async () => {
    reporter = new AgenticReporter({ outputStream, maxFailures: 1 });
    reporter.onBegin(createConfig(), createSuite([mockTest]));
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      mockResult as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      mockResult as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );
    reporter.onEnd({ status: 'failed' } as unknown as Parameters<AgenticReporter['onEnd']>[0]);

    const output = await streamToString(outputStream);

    expect(output).toContain('<overflow_warning suppressed="1">');
    expect(output).toContain('failed="2"');
  });

  it('handles missing error objects with unknown fallback context', async () => {
    reporter.onBegin(createConfig(), createSuite([mockTest]));
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      { ...mockResult, error: undefined } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    const output = await streamToString(outputStream);

    expect(output).toContain('<error_summary>Unknown error</error_summary>');
    expect(output).toContain('type="unknown"');
  });

  it('classifies attachment paths and reports whether each path exists', async () => {
    vi.mocked(fs.existsSync).mockImplementation((targetPath) =>
      String(targetPath).endsWith('trace.zip')
    );

    reporter.onBegin(createConfig(), createSuite([mockTest]));
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      {
        ...mockResult,
        attachments: [
          { name: 'trace', path: 'trace.zip' },
          { path: 'screenshot.png' },
          { name: 'error-context', path: 'error-context.md' },
          { name: 'body-only' },
        ],
      } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    const output = await streamToString(outputStream);

    expect(output).toContain('- trace (trace, exists): `trace.zip`');
    expect(output).toContain('- attachment (screenshot, missing): `screenshot.png`');
    expect(output).toContain('- error-context (error-context, missing): `error-context.md`');
    expect(output).not.toContain('body-only');
  });

  it('classifies video snapshot console and generic attachments', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    reporter.onBegin(createConfig(), createSuite([mockTest]));
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      {
        ...mockResult,
        attachments: [
          { name: 'video', path: 'video.webm' },
          { name: 'snapshot', path: 'snapshot.html' },
          { name: 'console', path: 'failure.console.log' },
          { name: 'custom', path: 'artifact.dat' },
        ],
      } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    const output = await streamToString(outputStream);

    expect(output).toContain('- video (video, exists): `video.webm`');
    expect(output).toContain('- snapshot (snapshot-html, exists): `snapshot.html`');
    expect(output).toContain('- console (console-log, exists): `failure.console.log`');
    expect(output).toContain('- custom (attachment, exists): `artifact.dat`');
  });

  it('summarizes failure source and includes project/test metadata', async () => {
    const testWithId = {
      ...mockTest,
      id: 'project-file-test-id',
      titlePath: () => ['root', 'suite', 'should fail'],
    };
    const beforeEachResult = {
      ...mockResult,
      error: {
        message: 'Test timeout of 60000ms exceeded while running "beforeEach" hook.',
        stack: 'Error: timeout\n    at tests/example.spec.ts:10:5',
      },
    };

    reporter.onBegin(createConfig(), createSuite([testWithId]));
    reporter.onTestEnd(
      testWithId as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      beforeEachResult as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    const output = await streamToString(outputStream);

    expect(output).toContain('<project>chromium</project>');
    expect(output).toContain('<test_id>project-file-test-id</test_id>');
    expect(output).toContain('<full_title_path>root › suite › should fail</full_title_path>');
    expect(output).toContain('<failure_source phase="setup"');
    expect(output).toContain('beforeEach hook');
  });

  it('classifies seed and assertion failures by source', async () => {
    reporter.onBegin(createConfig(), createSuite([mockTest]));

    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      {
        ...mockResult,
        error: {
          message: 'Error: Failed to seed duplicate annotations: duplicate timeKey',
          stack: 'Error: Failed to seed duplicate annotations\n    at tests/example.spec.ts:62:22',
        },
      } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      {
        ...mockResult,
        error: {
          message: 'Error: expect(locator).toBeVisible() failed',
          stack: 'Error: expect(locator).toBeVisible() failed\n    at tests/example.spec.ts:216:9',
        },
      } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    const output = await streamToString(outputStream);

    expect(output).toContain('<failure_source phase="data_setup"');
    expect(output).toContain('seed failure');
    expect(output).toContain('<failure_source phase="assertion"');
    expect(output).toContain('assertion failure');
  });

  it('classifies fixture setup runtime and unknown failure sources', async () => {
    reporter.onBegin(createConfig(), createSuite([mockTest]));
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      {
        ...mockResult,
        error: {
          message: 'Fixture "$tags" failed',
          stack: 'Error: fixture failure',
        },
      } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      {
        ...mockResult,
        error: {
          message: 'Application crashed unexpectedly',
          stack: 'Error: app crash',
        },
      } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      {
        ...mockResult,
        error: {
          message: '',
          stack: '',
        },
      } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    const output = await streamToString(outputStream);

    expect(output).toContain('<failure_source phase="setup">setup hook</failure_source>');
    expect(output).toContain('<failure_source phase="runtime">test runtime</failure_source>');
    expect(output).toContain(
      '<failure_source phase="unknown">unknown failure source</failure_source>'
    );
  });

  it('omits attachment output when includeAttachments is false', async () => {
    reporter = new AgenticReporter({ outputStream, includeAttachments: false });
    reporter.onBegin(createConfig(), createSuite([mockTest]));
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      {
        ...mockResult,
        attachments: [{ name: 'trace', path: 'trace.zip' }],
      } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    const output = await streamToString(outputStream);

    expect(output).not.toContain('trace.zip');
  });

  it('warns and still emits failure when detailed report file write fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation((filePath) => {
      if (String(filePath).endsWith('-details.xml')) {
        throw new Error('disk full');
      }
    });

    reporter.onBegin(createConfig(), createSuite([mockTest]));
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      mockResult as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    const output = await streamToString(outputStream);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AgenticReporter] Failed to write detailed report'),
      expect.any(Error)
    );
    expect(output).toContain('<failure');

    warnSpy.mockRestore();
    vi.mocked(fs.writeFileSync).mockReset();
  });

  it('warns and continues when manifest write fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation((filePath) => {
      if (String(filePath).endsWith('agentic-run-manifest.json')) {
        throw new Error('manifest disk full');
      }
    });

    reporter.onBegin(createConfig(), createSuite([]));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AgenticReporter] Failed to write run manifest'),
      expect.any(Error)
    );

    warnSpy.mockRestore();
    vi.mocked(fs.writeFileSync).mockReset();
  });

  it('continues when previous report input cannot be read', async () => {
    reporter = new AgenticReporter({ outputStream, checkPreviousReports: true });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['test-details.xml'] as never);
    vi.mocked(fs.readSync).mockImplementation(() => {
      throw new Error('no stdin');
    });

    reporter.onBegin(createConfig(), createSuite([]));

    const output = await streamToString(outputStream);

    expect(output).toContain('[AgenticReporter] Failed to read input');
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('supports non-interactive previous report warn policy', async () => {
    reporter = new AgenticReporter({
      outputStream,
      checkPreviousReports: true,
      previousReportsPolicy: 'warn',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['test-details.xml'] as never);

    reporter.onBegin(createConfig(), createSuite([]));

    const output = await streamToString(outputStream);

    expect(output).toContain('<agentic-prompt type="warning">');
    expect(output).toContain('<policy>warn</policy>');
    expect(fs.readSync).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('supports non-interactive previous report fail policy', () => {
    reporter = new AgenticReporter({
      outputStream,
      checkPreviousReports: true,
      previousReportsPolicy: 'fail',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['test-details.xml'] as never);

    reporter.onBegin(createConfig(), createSuite([]));

    expect(fs.readSync).not.toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('does not write manifests or stale warnings when detailed reports are disabled', async () => {
    reporter = new AgenticReporter({ outputStream, enableDetailedReport: false });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['old-details.xml'] as never);

    reporter.onBegin(createConfig(), createSuite([mockTest]));
    reporter.onEnd({ status: 'passed' } as unknown as Parameters<AgenticReporter['onEnd']>[0]);

    const output = await streamToString(outputStream);

    expect(output).not.toContain('<stale_artifact_warning');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('does not emit stale warnings when previousReportsPolicy is ignore', async () => {
    reporter = new AgenticReporter({ outputStream, previousReportsPolicy: 'ignore' });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['old-details.xml'] as never);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ runId: 'old&run' }) as never);

    reporter.onBegin(createConfig(), createSuite([]));

    const output = await streamToString(outputStream);

    expect(output).not.toContain('<stale_artifact_warning');
  });

  it('escapes stale warning manifest ids and filenames', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['bad&name-details.xml'] as never);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ runId: 'old&run' }) as never);

    reporter.onBegin(createConfig(), createSuite([]));

    const output = await streamToString(outputStream);

    expect(output).toContain('previous_run_id="old&amp;run"');
    expect(output).toContain('<failure>bad&amp;name-details.xml</failure>');
  });

  it('uses unknown when stale manifest has no run id', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['old-details.xml'] as never);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ status: 'failed' }) as never);

    reporter.onBegin(createConfig(), createSuite([]));

    const output = await streamToString(outputStream);

    expect(output).toContain('previous_run_id="unknown"');
  });

  it('skips stale warning when manifest is missing or no stale detail files exist', async () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (filePath) => String(filePath) === 'test-results-mock'
    );

    reporter.onBegin(createConfig(), createSuite([]));

    let output = await streamToString(outputStream);
    expect(output).not.toContain('<stale_artifact_warning');

    outputStream = new PassThrough();
    reporter = new AgenticReporter({ outputStream, enableDetailedReport: true });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['not-a-detail.txt'] as never);

    reporter.onBegin(createConfig(), createSuite([]));
    output = await streamToString(outputStream);

    expect(output).not.toContain('<stale_artifact_warning');
  });

  it('reports stale artifact inspection failures without throwing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['old-details.xml'] as never);
    vi.mocked(fs.readFileSync).mockReturnValue('not-json' as never);

    reporter.onBegin(createConfig(), createSuite([]));

    const output = await streamToString(outputStream);

    expect(output).toContain('[AgenticReporter] Failed to inspect stale artifacts');
  });

  it('ignores previous reports without prompting when checkPreviousReports uses ignore policy', async () => {
    reporter = new AgenticReporter({
      outputStream,
      checkPreviousReports: true,
      previousReportsPolicy: 'ignore',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['old-details.xml'] as never);

    reporter.onBegin(createConfig(), createSuite([]));

    const output = await streamToString(outputStream);

    expect(output).not.toContain('Previous Failure Reports Detected');
    expect(fs.readSync).not.toHaveBeenCalled();
  });

  it('uses the test project for metadata and reproduce commands when available', async () => {
    const projectTest = {
      ...mockTest,
      parent: {
        project: () => ({ name: 'firefox' }),
      },
    };

    reporter.onBegin(createConfig(), createSuite([projectTest]));
    reporter.onTestEnd(
      projectTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      mockResult as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    const output = await streamToString(outputStream);

    expect(output).toContain('<project>firefox</project>');
    expect(output).toContain('--project=firefox');
  });

  it('does not prompt when previous report directory is missing', async () => {
    reporter = new AgenticReporter({ outputStream, checkPreviousReports: true });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    reporter.onBegin(createConfig(), createSuite([]));

    const output = await streamToString(outputStream);

    expect(output).not.toContain('<agentic-prompt');
  });

  it('does not delete reports when detailed reports are disabled', () => {
    reporter = new AgenticReporter({ outputStream, enableDetailedReport: false });

    reporter.onBegin(createConfig(), createSuite([]));
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      { ...mockResult, status: 'passed' } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('ignores deletion failures for stale detailed reports', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockImplementationOnce(() => {
      throw new Error('locked');
    });

    reporter.onBegin(createConfig(), createSuite([]));
    reporter.onTestEnd(
      mockTest as unknown as Parameters<AgenticReporter['onTestEnd']>[0],
      { ...mockResult, status: 'passed' } as unknown as Parameters<AgenticReporter['onTestEnd']>[1]
    );

    expect(fs.unlinkSync).toHaveBeenCalled();
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
    });
  });
}

function createConfig(): Parameters<AgenticReporter['onBegin']>[0] {
  return {
    workers: 1,
    projects: [{ name: 'chromium' }],
    outputDir: 'test-results-mock',
  } as unknown as Parameters<AgenticReporter['onBegin']>[0];
}

function createSuite(tests: unknown[]): Parameters<AgenticReporter['onBegin']>[1] {
  return {
    allTests: () => tests,
  } as unknown as Parameters<AgenticReporter['onBegin']>[1];
}

function writeMockInput(buffer: NodeJS.ArrayBufferView, value: string): void {
  Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).write(value);
}

function mockReadInput(value: string): void {
  const readSyncMock = vi.mocked(fs.readSync) as unknown as {
    mockImplementation(
      implementation: (
        fd: number,
        buffer: NodeJS.ArrayBufferView,
        offset: number,
        length: number,
        position: fs.ReadPosition | null
      ) => number
    ): void;
  };

  readSyncMock.mockImplementation((_fd, buffer) => {
    writeMockInput(buffer, value);
    return 1;
  });
}
