import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { renderLine, renderError } from '@ap/tui';

const AP_DIR = join(homedir(), '.ap');
const PACKAGES_DIR = join(AP_DIR, 'packages');
const MANIFEST_PATH = join(AP_DIR, 'packages.json');

interface PackageManifest {
  installed: Record<string, {
    source: string;     // npm:<name> or git:<url>
    version: string;
    installedAt: string;
    path: string;
  }>;
}

async function loadManifest(): Promise<PackageManifest> {
  if (!existsSync(MANIFEST_PATH)) {
    return { installed: {} };
  }
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf-8'));
}

async function saveManifest(manifest: PackageManifest): Promise<void> {
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

/**
 * ap install <source>
 *
 * Sources:
 *   npm:<package-name>          Install from npm
 *   git:<url>                   Clone from git
 *   <github-user>/<repo>        Shorthand for GitHub
 */
export async function installPackage(source: string): Promise<void> {
  if (!source) {
    renderError('Usage: ap install <npm:package | git:url | user/repo>');
    return;
  }

  await mkdir(PACKAGES_DIR, { recursive: true });
  const manifest = await loadManifest();

  let resolvedSource = source;
  let name = source;
  let installPath: string;

  if (source.startsWith('npm:')) {
    // npm install
    name = source.slice(4);
    installPath = join(PACKAGES_DIR, name);

    renderLine(chalk.dim(`Installing ${name} from npm...`));
    try {
      await mkdir(installPath, { recursive: true });
      execSync(`npm pack ${name} --pack-destination "${installPath}"`, {
        cwd: installPath,
        stdio: 'pipe',
      });
      // Extract the tarball
      const tarballs = execSync(`ls "${installPath}"/*.tgz`, { encoding: 'utf-8' }).trim().split('\n');
      if (tarballs[0]) {
        execSync(`tar -xzf "${tarballs[0]}" -C "${installPath}" --strip-components=1`, { stdio: 'pipe' });
        execSync(`rm "${tarballs[0]}"`, { stdio: 'pipe' });
      }
    } catch (err) {
      renderError(`Failed to install ${name}: ${(err as Error).message}`);
      return;
    }
  } else if (source.startsWith('git:')) {
    // git clone
    const url = source.slice(4);
    name = url.split('/').pop()?.replace('.git', '') || source;
    installPath = join(PACKAGES_DIR, name);

    renderLine(chalk.dim(`Cloning ${url}...`));
    try {
      if (existsSync(installPath)) {
        execSync(`cd "${installPath}" && git pull`, { stdio: 'pipe' });
      } else {
        execSync(`git clone "${url}" "${installPath}"`, { stdio: 'pipe' });
      }
    } catch (err) {
      renderError(`Failed to clone: ${(err as Error).message}`);
      return;
    }
  } else if (source.includes('/') && !source.includes(':')) {
    // GitHub shorthand: user/repo
    const url = `https://github.com/${source}.git`;
    name = source.split('/')[1] || source;
    installPath = join(PACKAGES_DIR, name);

    renderLine(chalk.dim(`Cloning ${source} from GitHub...`));
    try {
      if (existsSync(installPath)) {
        execSync(`cd "${installPath}" && git pull`, { stdio: 'pipe' });
      } else {
        execSync(`git clone "${url}" "${installPath}"`, { stdio: 'pipe' });
      }
      resolvedSource = `git:${url}`;
    } catch (err) {
      renderError(`Failed to clone: ${(err as Error).message}`);
      return;
    }
  } else {
    renderError(`Unknown source format: ${source}. Use npm:name, git:url, or user/repo`);
    return;
  }

  // Copy extensions and skills to the right places
  const extDir = join(installPath, 'extensions');
  const skillDir = join(installPath, 'skills');

  if (existsSync(extDir)) {
    const target = join(AP_DIR, 'extensions');
    await mkdir(target, { recursive: true });
    execSync(`cp -r "${extDir}"/* "${target}/" 2>/dev/null || true`, { stdio: 'pipe' });
    renderLine(chalk.green(`  Extensions installed`));
  }

  if (existsSync(skillDir)) {
    const target = join(AP_DIR, 'skills');
    await mkdir(target, { recursive: true });
    execSync(`cp -r "${skillDir}"/* "${target}/" 2>/dev/null || true`, { stdio: 'pipe' });
    renderLine(chalk.green(`  Skills installed`));
  }

  // Update manifest
  manifest.installed[name] = {
    source: resolvedSource,
    version: '0.0.0',
    installedAt: new Date().toISOString(),
    path: installPath,
  };
  await saveManifest(manifest);

  renderLine(chalk.green(`\nInstalled: ${name}`));
}

export async function listPackages(): Promise<void> {
  const manifest = await loadManifest();
  const packages = Object.entries(manifest.installed);

  if (packages.length === 0) {
    renderLine(chalk.dim('No packages installed. Use `ap install <source>` to add packages.'));
    return;
  }

  renderLine(chalk.bold('\nInstalled Packages\n'));
  for (const [name, info] of packages) {
    renderLine(`  ${chalk.white(name)} ${chalk.dim(info.source)} ${chalk.dim(info.installedAt.split('T')[0])}`);
  }
  renderLine('');
}

export async function removePackage(name: string): Promise<void> {
  if (!name) {
    renderError('Usage: ap remove <package-name>');
    return;
  }

  const manifest = await loadManifest();
  const pkg = manifest.installed[name];

  if (!pkg) {
    renderError(`Package not found: ${name}`);
    return;
  }

  // Remove package directory
  if (existsSync(pkg.path)) {
    await rm(pkg.path, { recursive: true, force: true });
  }

  delete manifest.installed[name];
  await saveManifest(manifest);

  renderLine(chalk.green(`Removed: ${name}`));
}
