import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { execFileMock, renderLineMock, renderErrorMock } = vi.hoisted(() => {
  const execMock = vi.fn() as Mock;
  execMock[Symbol.for('nodejs.util.promisify.custom')] = execMock;
  return {
    execFileMock: execMock,
    renderLineMock: vi.fn(),
    renderErrorMock: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('@blushagent/tui', () => ({
  renderLine: renderLineMock,
  renderError: renderErrorMock,
}));

const originalHome = process.env.HOME;
let tempHome = '';

async function importPackagesModule() {
  vi.resetModules();
  process.env.HOME = tempHome;
  return import('./commands/packages.js');
}

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'blush-cli-packages-'));
  execFileMock.mockReset();
  renderLineMock.mockReset();
  renderErrorMock.mockReset();
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
    tempHome = '';
  }
});

describe('package commands', () => {
  it('installs npm packages, copies skills/extensions, and records version metadata', async () => {
    execFileMock.mockImplementation(async (command: string, args: string[]) => {
      if (command === 'npm' && args[0] === 'pack') {
        const packDestination = args[3];
        await writeFile(join(packDestination, 'blush-kit-1.2.3.tgz'), 'tarball', 'utf8');
        return { stdout: 'blush-kit-1.2.3.tgz', stderr: '' };
      }

      if (command === 'tar' && args[0] === '-xzf') {
        const installPath = args[3];
        await writeFile(
          join(installPath, 'package.json'),
          JSON.stringify({ name: '@scope/blush-kit', version: '1.2.3' }, null, 2),
          'utf8',
        );
        await mkdir(join(installPath, 'skills'), { recursive: true });
        await mkdir(join(installPath, 'extensions'), { recursive: true });
        await writeFile(join(installPath, 'skills', 'kit.md'), '# skill\n', 'utf8');
        await writeFile(join(installPath, 'extensions', 'kit.js'), 'export default {};\n', 'utf8');
        return { stdout: '', stderr: '' };
      }

      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    });

    const { installPackage } = await importPackagesModule();
    await installPackage('npm:@scope/blush-kit');

    const manifest = JSON.parse(
      await readFile(join(tempHome, '.blush', 'packages.json'), 'utf8'),
    ) as {
      installed: Record<string, { version: string; source: string; path: string }>;
    };

    expect(renderErrorMock).not.toHaveBeenCalled();
    expect(renderLineMock.mock.calls.flat().join('\n')).toContain('Extensions installed');
    expect(renderLineMock.mock.calls.flat().join('\n')).toContain('Skills installed');
    expect(manifest.installed['@scope/blush-kit']?.version).toBe('1.2.3');
    expect(manifest.installed['@scope/blush-kit']?.source).toBe('npm:@scope/blush-kit');
    expect(manifest.installed['@scope/blush-kit']?.path).toContain('__scope__blush-kit');
    expect(existsSync(join(tempHome, '.blush', 'skills', 'kit.md'))).toBe(true);
    expect(existsSync(join(tempHome, '.blush', 'extensions', 'kit.js'))).toBe(true);
  });

  it('lists packages in sorted order with version metadata', async () => {
    await mkdir(join(tempHome, '.blush'), { recursive: true });
    await writeFile(
      join(tempHome, '.blush', 'packages.json'),
      JSON.stringify({
        installed: {
          zebra: {
            source: 'git:https://example.com/zebra.git',
            version: '2.0.0',
            installedAt: '2026-04-03T12:00:00.000Z',
            path: '/tmp/zebra',
          },
          alpha: {
            source: 'npm:alpha',
            version: '1.0.0',
            installedAt: '2026-04-02T12:00:00.000Z',
            path: '/tmp/alpha',
          },
        },
      }, null, 2),
      'utf8',
    );

    const { listPackages } = await importPackagesModule();
    await listPackages();

    const output = renderLineMock.mock.calls.flat().join('\n');
    expect(output.indexOf('alpha')).toBeLessThan(output.indexOf('zebra'));
    expect(output).toContain('1.0.0');
    expect(output).toContain('2.0.0');
  });

  it('removes an installed package and updates the manifest', async () => {
    const packagePath = join(tempHome, '.blush', 'packages', 'demo');
    await mkdir(packagePath, { recursive: true });
    await mkdir(join(tempHome, '.blush'), { recursive: true });
    await writeFile(
      join(tempHome, '.blush', 'packages.json'),
      JSON.stringify({
        installed: {
          demo: {
            source: 'npm:demo',
            version: '1.0.0',
            installedAt: '2026-04-03T12:00:00.000Z',
            path: packagePath,
          },
        },
      }, null, 2),
      'utf8',
    );

    const { removePackage } = await importPackagesModule();
    await removePackage('demo');

    const manifest = JSON.parse(
      await readFile(join(tempHome, '.blush', 'packages.json'), 'utf8'),
    ) as { installed: Record<string, unknown> };

    expect(manifest.installed.demo).toBeUndefined();
    expect(existsSync(packagePath)).toBe(false);
    expect(renderLineMock.mock.calls.flat().join('\n')).toContain('Removed: demo');
  });
});
