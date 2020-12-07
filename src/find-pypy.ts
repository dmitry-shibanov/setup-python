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
  let python_version;
  const pypyVersionSpec = prepareVersions(versionSpec);
  if (IS_WINDOWS) {
    architecture = 'x86';
  }
  const findPyPy = tc.find.bind(
    undefined,
    'PyPy',
    pypyVersionSpec.pythonVersion
  );
  let installDir: string | null = findPyPy(architecture);

  if (pypyVersionSpec.pypyVersion === 'nightly') {
    installDir = null;
  }

  if (installDir) {
    pypy_version = await getCurrentPyPyVersion(
      installDir,
      pypyVersionSpec.pythonVersion
    );

    const shouldReInstall = validatePyPyVersions(
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

  return await prepareEnvironment(installDir, pypy_version!, python_version);
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

  core.debug(`PyPy Python version is ${versionOutput}`);
  core.debug(`StdError from pypy --version is ${errorOutput}`);

  if (errorOutput) {
    core.error(errorOutput);
    return '';
  }

  const version = versionOutput
    .match(/^\[PyPy (.*)$/gm)![0]
    .split(' ')[1]
    .trim();
  core.info(`Current PyPy version is ${version}`);

  return version;
}

function validatePyPyVersions(currentPyPyVersion: string, pypyVersion: string) {
  return !semver.satisfies(currentPyPyVersion, pypyVersion);
}

async function prepareEnvironment(
  installDir: string,
  pypyVersion: string,
  pythonVersion: string
) {
  core.info(`PyPy install folder is ${installDir}`);

  // On Linux and macOS, the Python interpreter is in 'bin'.
  // On Windows, it is in the installation root.
  const pythonLocation = getPyPyBinary(installDir);
  core.exportVariable('pythonLocation', pythonLocation);
  core.addPath(pythonLocation);

  const impl = 'PyPy ' + pypyVersion;
  core.setOutput('python-version', impl);

  return {python_version: pythonVersion, pypy_version: pypyVersion};
}

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
    await exec.exec(
      `[ -e ${pythonLocation}/python ] || ln -s ${pythonLocation}/python${majorVersion} ${pythonLocation}/python`
    );
    await exec.exec(
      `chmod +x ${pythonLocation}/python ${pythonLocation}/python${majorVersion}`
    );
    await exec.exec(`${pythonLocation}/python -m ensurepip`);
    await exec.exec(
      `${pythonLocation}/python -m pip install --ignore-installed pip`
    );
  }
}

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
