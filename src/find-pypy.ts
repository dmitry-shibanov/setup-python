import * as path from 'path';
import * as pypyInstall from './install-pypy';

import * as exec from '@actions/exec';
import * as semver from 'semver';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';

const IS_WINDOWS = process.platform === 'win32';

interface InstalledVersion {
  python_version: string;
  pypy_version: string;
}

interface IPyPyData {
  pypyVersion: string;
  pythonVersion: string;
  pythonRange: string;
}

export async function findPyPyVersion(
  versionSpec: string,
  architecture: string
): Promise<InstalledVersion> {
  let pypy_version: string;
  let python_version: string;

  const pypyVersionSpec = prepareVersions(versionSpec);
  if (IS_WINDOWS) {
    architecture = 'x86';
  }

  let installDir: string | null = tc.find(
    'PyPy',
    pypyVersionSpec.pythonVersion,
    architecture
  );

  if (installDir) {
    pypy_version = await getCurrentPyPyVersion(
      installDir,
      pypyVersionSpec.pythonVersion
    );

    const shouldReInstall = isPyPyVersionSatisfies(
      pypy_version,
      pypyVersionSpec.pypyVersion
    );

    if (shouldReInstall) {
      installDir = null;
    }
  }

  if (!installDir) {
    ({installDir, python_version, pypy_version} = await pypyInstall.installPyPy(
      pypyVersionSpec.pypyVersion,
      pypyVersionSpec.pythonRange,
      architecture
    ));

    await createSymlinks(installDir, python_version);
  }

  python_version = versionFromPath(installDir);

  return await addEnvVariables(installDir, pypy_version!, python_version);
}

async function getCurrentPyPyVersion(
  installDir: string,
  pythonVersion: string
) {
  const pypyBinary = getPyPyBinary(installDir);
  const major = pythonVersion.split('.')[0] === '2' ? '' : '3';
  let versionOutput = '';
  let errorOutput = '';

  await exec.exec(`${pypyBinary}/pypy${major} --version`, [], {
    ignoreReturnCode: true,
    silent: true,
    listeners: {
      stdout: (data: Buffer) => (versionOutput = data.toString()),
      stderr: (data: Buffer) => (errorOutput = data.toString())
    }
  });

  core.debug(`PyPy Python version output is ${versionOutput}`);

  if (errorOutput) {
    core.error(`Error from pypy${major} --version call is ${errorOutput}`);
    return '';
  }

  const pypyVersion = versionOutput
    .match(/^\[PyPy (.*)$/gm)![0]
    .split(' ')[1]
    .trim();
  core.info(`Current PyPy version is ${pypyVersion}`);

  return pypyVersion;
}

function isPyPyVersionSatisfies(
  currentPyPyVersion: string,
  pypyVersion: string
) {
  return !semver.satisfies(currentPyPyVersion, pypyVersion);
}

async function addEnvVariables(
  installDir: string,
  pypyVersion: string,
  pythonVersion: string
) {
  const pythonLocation = getPyPyBinary(installDir);
  core.exportVariable('pythonLocation', pythonLocation);
  core.addPath(pythonLocation);

  return {python_version: pythonVersion, pypy_version: pypyVersion};
}

/** create Symlinks for downloaded PyPy
 *  It should be executed only for downloaded versions in runtime, because
 *  toolcache versions have this setup.
 */
async function createSymlinks(installDir: string, pythonVersion: string) {
  const pythonLocation = getPyPyBinary(installDir);
  const major = pythonVersion.split('.')[0] === '2' ? '' : '3';
  const majorVersion = pythonVersion.split('.')[0];

  if (IS_WINDOWS) {
    await exec.exec(
      `ln -s ${pythonLocation}/pypy${major}.exe ${pythonLocation}/python.exe`
    );
    await exec.exec(`${pythonLocation}/python -m ensurepip`);
    await exec.exec(
      `${pythonLocation}/python -m pip install --ignore-installed pip`
    );
  } else {
    await exec.exec(
      `ln -s ${pythonLocation}/pypy${major} ${pythonLocation}/python${majorVersion}`
    );

    // PyPy nightly builds have python Symlink
    if (!fs.existsSync(`${pythonLocation}/python`)) {
      await exec.exec(
        `ln -s ${pythonLocation}/python${majorVersion} ${pythonLocation}/python`
      );
    }
    await exec.exec(
      `chmod +x ${pythonLocation}/python ${pythonLocation}/python${majorVersion}`
    );
    await exec.exec(`${pythonLocation}/python -m ensurepip`);
    await exec.exec(
      `${pythonLocation}/python -m pip install --ignore-installed pip`
    );
  }
}

/** Get PyPy binary location from the tool of installation directory
 *  - On Linux and macOS, the Python interpreter is in 'bin'.
 *  - On Windows, it is in the installation root.
 */
function getPyPyBinary(installDir: string) {
  const _binDir = path.join(installDir, 'bin');
  return IS_WINDOWS ? installDir : _binDir;
}

function prepareVersions(versionSpec: string) {
  const versions = versionSpec.split('-');
  const pypyVersion = versions[1].replace('v', '');
  let pythonRange;
  let pythonVersion = versions[0].replace('pypy', '');
  if (!pythonVersion.includes('.x') && !semver.valid(pythonVersion)) {
    pythonRange = `${pythonVersion}.x`;
  } else {
    pythonRange = pythonVersion;
  }

  const data: IPyPyData = {
    pypyVersion: pypyVersion!,
    pythonRange: pythonRange,
    pythonVersion: pythonVersion.replace('.x', '')
  };

  return data;
}

/** Extracts python version from install path from hosted tool cache as described in README.md */
function versionFromPath(installDir: string) {
  const parts = installDir.split(path.sep);
  const idx = parts.findIndex(part => part === 'PyPy' || part === 'Python');

  return parts[idx + 1] || '';
}
