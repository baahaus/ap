import chalk from 'chalk';
import { execFile } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { renderLine, renderError } from '@blush/tui';

const execFileAsync = promisify(execFile);
const BLUSH_DIR = join(homedir(), '.blush');
const PACKAGES_DIR = join(BLUSH_DIR, 'packages');
const MANIFEST_PATH = join(BLUSH_DIR, 'packages.json');

interface PackageRecord {
  source: string;
  version: string;
  installedAt: string;
  path: string;
}

interface PackageManifest {
  installed: Record<string, PackageRecord>;
}

function sanitizePackageDirName(name: string): string {
  return name.replace(/[@/:]/g, '__');
}

async function loadManifest(): Promise<PackageManifest> {
  if (!existsSync(MANIFEST_PATH)) {
    return { installed: {} };
  }

  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf-8')) as PackageManifest;
  } catch {
    return { installed: {} };
  }
}

async function saveManifest(manifest: PackageManifest): Promise<void> {
  await mkdir(BLUSH_DIR, { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

async function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options?.cwd,
    encoding: 'utf8',
  });
  return stdout.trim();
}

async function inferInstalledVersion(installPath: string): Promise<string> {
  const packageJsonPath = join(installPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return '0.0.0';
  }

  try {
    const pkg = JSON.parse(await readFile(packageJsonPath, 'utf-8')) as { version?: string };
    return pkg.version?.trim() || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function copyDirectoryContents(sourceDir: string, targetDir: string): Promise<boolean> {
  if (!existsSync(sourceDir)) return false;

  const entries = await readdir(sourceDir);
  if (entries.length === 0) return false;

  await mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    await cp(join(sourceDir, entry), join(targetDir, entry), {
      recursive: true,
      force: true,
    });
  }

  return true;
}

async function installNpmPackage(name: string, installPath: string): Promise<void> {
  await mkdir(installPath, { recursive: true });
  await runCommand('npm', ['pack', name, '--pack-destination', installPath], { cwd: installPath });

  const tarballs = (await readdir(installPath)).filter((entry) => entry.endsWith('.tgz'));
  const tarball = tarballs[0];
  if (!tarball) {
    throw new Error(`npm pack did not produce a tarball for ${name}`);
  }

  const tarballPath = join(installPath, tarball);
  await runCommand('tar', ['-xzf', tarballPath, '-C', installPath, '--strip-components=1']);
  await unlink(tarballPath);
}

async function syncGitPackage(url: string, installPath: string): Promise<void> {
  if (existsSync(installPath)) {
    await runCommand('git', ['-C', installPath, 'pull', '--ff-only']);
    return;
  }

  await runCommand('git', ['clone', url, installPath]);
}

/**
 * blush install <source>
 *
 * Sources:
 *   npm:<package-name>          Install from npm
 *   git:<url>                   Clone from git
 *   <github-user>/<repo>        Shorthand for GitHub
 */
export async function installPackage(source: string): Promise<void> {
  if (!source) {
    renderError('Usage: blush install <npm:package | git:url | user/repo>');
    return;
  }

  await mkdir(PACKAGES_DIR, { recursive: true });
  const manifest = await loadManifest();

  let resolvedSource = source;
  let packageName = source;
  let installPath = '';

  try {
    if (source.startsWith('npm:')) {
      packageName = source.slice(4);
      installPath = join(PACKAGES_DIR, sanitizePackageDirName(packageName));
      renderLine(chalk.dim(`Installing ${packageName} from npm...`));
      await installNpmPackage(packageName, installPath);
    } else if (source.startsWith('git:')) {
      const url = source.slice(4);
      packageName = url.split('/').pop()?.replace(/\.git$/, '') || source;
      installPath = join(PACKAGES_DIR, sanitizePackageDirName(packageName));
      renderLine(chalk.dim(`Cloning ${url}...`));
      await syncGitPackage(url, installPath);
    } else if (source.includes('/') && !source.includes(':')) {
      const url = `https://github.com/${source}.git`;
      packageName = source.split('/')[1] || source;
      installPath = join(PACKAGES_DIR, sanitizePackageDirName(packageName));
      resolvedSource = `git:${url}`;
      renderLine(chalk.dim(`Cloning ${source} from GitHub...`));
      await syncGitPackage(url, installPath);
    } else {
      renderError(`Unknown source format: ${source}. Use npm:name, git:url, or user/repo`);
      return;
    }
  } catch (err) {
    renderError(`Failed to install ${packageName}: ${(err as Error).message}`);
    return;
  }

  const extensionsInstalled = await copyDirectoryContents(
    join(installPath, 'extensions'),
    join(BLUSH_DIR, 'extensions'),
  );
  if (extensionsInstalled) {
    renderLine(chalk.green('  Extensions installed'));
  }

  const skillsInstalled = await copyDirectoryContents(
    join(installPath, 'skills'),
    join(BLUSH_DIR, 'skills'),
  );
  if (skillsInstalled) {
    renderLine(chalk.green('  Skills installed'));
  }

  manifest.installed[packageName] = {
    source: resolvedSource,
    version: await inferInstalledVersion(installPath),
    installedAt: new Date().toISOString(),
    path: installPath,
  };
  await saveManifest(manifest);

  renderLine(chalk.green(`\nInstalled: ${packageName}`));
}

export async function listPackages(): Promise<void> {
  const manifest = await loadManifest();
  const packages = Object.entries(manifest.installed).sort(([a], [b]) => a.localeCompare(b));

  if (packages.length === 0) {
    renderLine(chalk.dim('No packages installed. Use `blush install <source>` to add packages.'));
    return;
  }

  renderLine(chalk.bold('\nInstalled Packages\n'));
  for (const [name, info] of packages) {
    renderLine(`  ${chalk.white(name)} ${chalk.dim(info.version)} ${chalk.dim(info.source)} ${chalk.dim(info.installedAt.split('T')[0])}`);
  }
  renderLine('');
}

export async function removePackage(name: string): Promise<void> {
  if (!name) {
    renderError('Usage: blush remove <package-name>');
    return;
  }

  const manifest = await loadManifest();
  const pkg = manifest.installed[name];

  if (!pkg) {
    renderError(`Package not found: ${name}`);
    return;
  }

  if (existsSync(pkg.path)) {
    await rm(pkg.path, { recursive: true, force: true });
  }

  delete manifest.installed[name];
  await saveManifest(manifest);

  renderLine(chalk.green(`Removed: ${name}`));
}
