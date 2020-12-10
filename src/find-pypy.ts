import * as path from 'path';
import * as pypyInstall from './install-pypy';
import * as fs from 'fs';

import * as semver from 'semver';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';

const IS_WINDOWS = process.platform === 'win32';

interface IPyPyVersionSpec {
  pypyVersion: semver.Range | string;
  pythonVersion: semver.Range;
}

export async function findPyPyVersion(
  versionSpec: string,
  architecture: string
): Promise<{resolvedPyPyVersion: string; resolvedPythonVersion: string}> {
  let resolvedPyPyVersion = '';
  let resolvedPythonVersion = '';
  let installDir: string | null;

  const pypyVersionSpec = parsePyPyVersion(versionSpec);
  // PyPy only precompiles binaries for x86, but the architecture parameter defaults to x64.
  // On our Windows virtual environments, we only install an x86 version.
  // Fall back to x86.
  if (IS_WINDOWS && architecture === 'x64') {
    architecture = 'x86';
  }

  ({
    installDir,
    resolvedPythonVersion,
    resolvedPyPyVersion
  } = await findPyPyToolCache(
    pypyVersionSpec.pythonVersion,
    pypyVersionSpec.pypyVersion,
    architecture
  ));

  if (!installDir) {
    ({
      installDir,
      resolvedPythonVersion,
      resolvedPyPyVersion
    } = await pypyInstall.installPyPy(
      pypyVersionSpec.pypyVersion,
      pypyVersionSpec.pythonVersion,
      architecture
    ));

    await pypyInstall.createSymlinks(
      getPyPyBinaryPath(installDir),
      resolvedPythonVersion
    );

    await pypyInstall.installPip(getPyPyBinaryPath(installDir));
  }

  const _binDir = path.join(installDir, 'bin');
  const pythonLocation = getPyPyBinaryPath(installDir);
  core.exportVariable('pythonLocation', pythonLocation);
  core.addPath(pythonLocation);
  core.addPath(_binDir);

  return {resolvedPyPyVersion, resolvedPythonVersion};
}

async function findPyPyToolCache(
  pythonVersion: semver.Range,
  pypyVersion: semver.Range | string,
  architecture: string
) {
  let resolvedPyPyVersion = '';
  let resolvedPythonVersion = '';
  let installDir: string | null = tc.find(
    'PyPy',
    pythonVersion.raw,
    architecture
  );
  if (!installDir) {
    return {installDir: null, resolvedPythonVersion, resolvedPyPyVersion};
  }

  resolvedPyPyVersion = await getExactPyPyVersion(installDir);

  const isPyPyVersionSatisfies = semver.satisfies(
    resolvedPyPyVersion,
    pypyVersion
  );
  if (!isPyPyVersionSatisfies) {
    installDir = null;
    resolvedPyPyVersion = '';
  } else {
    resolvedPythonVersion = path.parse(path.parse(installDir).dir).base;
  }

  return {installDir, resolvedPythonVersion, resolvedPyPyVersion};
}

function getExactPyPyVersion(installDir: string) {
  let pypyVersion = '';
  let fileVersion = path.join(installDir, 'PYPY_VERSION');
  if (fs.existsSync(fileVersion)) {
    pypyVersion = fs.readFileSync(fileVersion).toString();
    core.debug(`Version from PYPY_VERSION file is ${pypyVersion}`);
  }

  return pypyVersion;
}

/** Get PyPy binary location from the tool of installation directory
 *  - On Linux and macOS, the Python interpreter is in 'bin'.
 *  - On Windows, it is in the installation root.
 */
function getPyPyBinaryPath(installDir: string) {
  const _binDir = path.join(installDir, 'bin');
  return IS_WINDOWS ? installDir : _binDir;
}

function parsePyPyVersion(versionSpec: string): IPyPyVersionSpec {
  const versions = versionSpec.split('-');
  // check that versions[1] and versions[2]
  // pypy-3.7
  // pypy-3.7-vx
  // TO-DO: should we print beatiful error message if versions parts are not semver or just throw exception
  if (versions.length < 2) {
    throw new Error('Please specify valid version Specification for PyPy.');
  }
  const pythonVersion = new semver.Range(versions[1]);
  let pypyVersion: semver.Range | string;
  if (versions.length > 2) {
    pypyVersion =
      versions[2] === 'nightly' ? 'nightly' : new semver.Range(versions[2]);
  } else {
    pypyVersion = new semver.Range('x');
  }

  return {
    pypyVersion: pypyVersion,
    pythonVersion: pythonVersion
  };
}
