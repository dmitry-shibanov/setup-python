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

  ({installDir, resolvedPythonVersion, resolvedPyPyVersion} = findPyPyToolCache(
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
  }

  const _binDir = path.join(installDir, 'bin');
  const pythonLocation = pypyInstall.getPyPyBinaryPath(installDir);
  core.exportVariable('pythonLocation', pythonLocation);
  core.addPath(pythonLocation);
  core.addPath(_binDir);

  return {resolvedPyPyVersion, resolvedPythonVersion};
}

function findPyPyToolCache(
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

  if (installDir) {
    // 'tc.find' finds tool based on Python version but we also need to check
    // whether PyPy version satisfies requested version.
    resolvedPythonVersion = getPyPyVersionFromPath(installDir);
    resolvedPyPyVersion = pypyInstall.readExactPyPyVersion(installDir);

    const isPyPyVersionSatisfies = semver.satisfies(
      resolvedPyPyVersion,
      pypyVersion
    );
    if (!isPyPyVersionSatisfies) {
      installDir = null;
      resolvedPyPyVersion = '';
    }
  }

  if (!installDir) {
    const version = pypyInstall.getPyPySemverVersion(pypyVersion);
    core.info(
      `PyPy version ${pythonVersion.raw} (${version}) was not found in the local cache`
    );
  }

  return {installDir, resolvedPythonVersion, resolvedPyPyVersion};
}

function parsePyPyVersion(versionSpec: string): IPyPyVersionSpec {
  const versions = versionSpec.split('-');

  if (versions.length < 2) {
    throw new Error(
      "Invalid 'version' property for PyPy. PyPy version should be specified as 'pypy-<python-version>'. See readme for more examples."
    );
  }
  const pythonVersion = new semver.Range(versions[1]);
  let pypyVersion: semver.Range | string;
  if (versions.length > 2) {
    pypyVersion =
      versions[2] === 'nightly'
        ? 'nightly'
        : new semver.Range(pypyInstall.pypyVersionToSemantic(versions[2]));
  } else {
    pypyVersion = new semver.Range('x');
  }

  return {
    pypyVersion: pypyVersion,
    pythonVersion: pythonVersion
  };
}

function getPyPyVersionFromPath(installDir: string) {
  return path.basename(path.dirname(installDir));
}
