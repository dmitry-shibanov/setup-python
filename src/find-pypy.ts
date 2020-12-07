import * as path from 'path';
import * as pypyInstall from './install-pypy';

import * as exec from '@actions/exec';
import * as semver from 'semver';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';

const IS_WINDOWS = process.platform === 'win32';

interface InstalledVersion {
  impl: string;
  version: string;
}

interface IPyPyData {
  pypyVersion: string;
  pythonVersion: string;
  pythonRange: string;
}

function prepareVersions(versionSpec: string) {
  const versions = versionSpec.split('-');
  const pypyVersion = semver.clean(versions[1]);
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

export async function findPyPyVersion(
  versionSpec: string,
  architecture: string
): Promise<InstalledVersion> {
  const pypyVersionSpec = prepareVersions(versionSpec);
  const findPyPy = tc.find.bind(
    undefined,
    'PyPy',
    pypyVersionSpec.pythonVersion
  );
  let installDir: string | null = findPyPy(architecture);

  if (!installDir && IS_WINDOWS) {
    // PyPy only precompiles binaries for x86, but the architecture parameter defaults to x64.
    // On our Windows virtual environments, we only install an x86 version.
    // Fall back to x86.
    installDir = findPyPy('x86');
  }

  if (!installDir) {
    installDir = await pypyInstall.installPyPy(
      pypyVersionSpec.pypyVersion,
      pypyVersionSpec.pythonRange,
      architecture
    );
    const pypyData = await prepareEnvironment(
      installDir,
      pypyVersionSpec.pypyVersion,
      pypyVersionSpec.pythonVersion
    );
    await createSymlinks(installDir, pypyVersionSpec.pythonVersion);
    return pypyData;
  }

  // On Linux and macOS, the Python interpreter is in 'bin'.
  // On Windows, it is in the installation root.
  const version = await getCurrentPyPyVersion(
    installDir,
    pypyVersionSpec.pythonRange
  );
  const shouldReInstall = validatePyPyVersions(
    version,
    pypyVersionSpec.pypyVersion
  );

  if (!shouldReInstall) {
    installDir = await pypyInstall.installPyPy(
      pypyVersionSpec.pypyVersion,
      pypyVersionSpec.pythonRange,
      architecture
    );

    const pypyData = await prepareEnvironment(
      installDir,
      pypyVersionSpec.pypyVersion,
      pypyVersionSpec.pythonVersion
    );
    await createSymlinks(installDir, pypyVersionSpec.pythonVersion);

    return pypyData;
  }

  return await prepareEnvironment(
    installDir,
    pypyVersionSpec.pypyVersion,
    pypyVersionSpec.pythonVersion
  );
}

async function getCurrentPyPyVersion(
  installDir: string,
  pythonVersion: string
) {
  const pypyBinary = getPyPyBinary(installDir);
  const major = semver.major(pythonVersion) === 2 ? '' : '3';
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
  return semver.satisfies(currentPyPyVersion, pypyVersion);
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

  const impl = 'pypy' + pypyVersion;
  core.setOutput('python-version', impl);

  return {impl: impl, version: pythonVersion};
}

async function createSymlinks(installDir: string, pythonVersion: string) {
  const pythonLocation = getPyPyBinary(installDir);
  const major = semver.major(pythonVersion) === 2 ? '' : '3';

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
      `ln -s ${pythonLocation}/pypy${major} ${pythonLocation}/python${major}`
    );
    await exec.exec(
      `ln -s ${pythonLocation}/python${major} ${pythonLocation}/python`
    );
    await exec.exec(
      `chmod +x ${pythonLocation}/python ${pythonLocation}/python${major}`
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
