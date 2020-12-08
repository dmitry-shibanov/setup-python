import * as path from 'path';
import * as pypyInstall from './install-pypy';

import * as exec from '@actions/exec';
import * as semver from 'semver';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';

const IS_WINDOWS = process.platform === 'win32';

interface InstalledVersion {
  python_version: string;
  pypy_version: string;
}

interface IPyPyVersionSpec {
  pypyVersion: semver.Range;
  pythonVersion: semver.Range;
}

export async function findPyPyVersion(
  versionSpec: string,
  architecture: string
): Promise<InstalledVersion> {
  let pypy_version = '';
  let python_version = '';

  const pypyVersionSpec = parsePyPyVersion(versionSpec);
  if (IS_WINDOWS) {
    // TO-DO about architecture
    architecture = 'x86';
  }

  let installDir: string | null = tc.find(
    'PyPy',
    pypyVersionSpec.pythonVersion.raw,
    architecture
  );

  if (installDir) {
    pypy_version = await getExactPyPyVersion(installDir);

    const shouldReinstall = isPyPyVersionSatisfies(
      pypy_version,
      pypyVersionSpec.pypyVersion
    );

    if (shouldReinstall) {
      installDir = null;
    }
  }

  if (!installDir) {
    ({installDir, python_version, pypy_version} = await pypyInstall.installPyPy(
      pypyVersionSpec.pypyVersion,
      pypyVersionSpec.pypyVersion,
      architecture
    ));

    await createSymlinks(installDir, python_version);
  }

  addEnvVariables(installDir);

  return {pypy_version, python_version};
}
// To do semver easier
async function getExactPyPyVersion(installDir: string) {
  const pypyBinary = getPyPyBinary(installDir);
  let versionOutput = '';

  await exec.exec(
    `${pypyBinary}/pypy -c "import sys;print('.'.join([str(int) for int in sys.pypy_version_info[0:3]]))"`,
    [],
    {
      ignoreReturnCode: true,
      silent: true,
      listeners: {
        stdout: (data: Buffer) => (versionOutput = data.toString())
      }
    }
  );

  core.debug(`PyPy Python version output is ${versionOutput}`);

  if (!versionOutput) {
    core.debug('Error from pypy --version call is empty');
    return '';
  }

  return versionOutput;
}

function isPyPyVersionSatisfies(
  currentPyPyVersion: string,
  pypyVersion: semver.Range
) {
  return !semver.satisfies(currentPyPyVersion, pypyVersion);
}

// remove function to inline
function addEnvVariables(installDir: string) {
  const pythonLocation = getPyPyBinary(installDir);
  core.exportVariable('pythonLocation', pythonLocation);
  core.addPath(pythonLocation);
}

/** create Symlinks for downloaded PyPy
 *  It should be executed only for downloaded versions in runtime, because
 *  toolcache versions have this setup.
 */
// input-pypy.ts
async function createSymlinks(installDir: string, pythonVersion: string) {
  const pythonLocation = getPyPyBinary(installDir);
  const version = semver.coerce(pythonVersion)!;
  const majorVersion = semver.major(version);
  const major = majorVersion === 2 ? '' : '3';

  let binaryExtension = IS_WINDOWS ? '.exe' : '';

  await exec.exec(
    `ln -sfn ${pythonLocation}/pypy${major}${binaryExtension} ${pythonLocation}/python${majorVersion}${binaryExtension}`
  );
  await exec.exec(
    `ln -sfn ${pythonLocation}/python${majorVersion}${binaryExtension} ${pythonLocation}/python${binaryExtension}`
  );
  await exec.exec(
    `chmod +x ${pythonLocation}/python${binaryExtension} ${pythonLocation}/python${majorVersion}${binaryExtension}`
  );
  await exec.exec(`${pythonLocation}/python -m ensurepip`);
  await exec.exec(
    `${pythonLocation}/python -m pip install --ignore-installed pip`
  );
}

/** Get PyPy binary location from the tool of installation directory
 *  - On Linux and macOS, the Python interpreter is in 'bin'.
 *  - On Windows, it is in the installation root.
 */
function getPyPyBinary(installDir: string) {
  const _binDir = path.join(installDir, 'bin');
  return IS_WINDOWS ? installDir : _binDir;
}

function parsePyPyVersion(versionSpec: string) {
  const versions = versionSpec.split('-');
  const pythonVersion = new semver.Range(versions[1]);
  const pypyVersion = new semver.Range(versions[2]);

  if (!pythonVersion || !pypyVersion) {
    throw new Error('invalid python or pypy version');
  }

  const data: IPyPyVersionSpec = {
    pypyVersion: pypyVersion!,
    pythonVersion: pythonVersion
  };

  return data;
}
