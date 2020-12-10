import * as path from 'path';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as httpm from '@actions/http-client';
import * as exec from '@actions/exec';
import * as fs from 'fs';

const IS_WINDOWS = process.platform === 'win32';
const PYPY_VERSION_FILE = 'PYPY_VERSION';

interface IPyPyManifestAsset {
  filename: string;
  arch: string;
  platform: string;
  download_url: string;
}

interface IPyPyManifestRelease {
  pypy_version: string;
  python_version: string;
  stable: boolean;
  latest_pypy: boolean;
  files: IPyPyManifestAsset[];
}

export async function installPyPy(
  pypyVersion: semver.Range,
  pythonVersion: semver.Range,
  architecture: string
) {
  let downloadDir;

  const releases = await getAvailablePyPyVersions();
  const releaseData = findRelease(
    releases,
    pythonVersion,
    pypyVersion,
    architecture
  );

  if (!releaseData || !releaseData.foundAsset) {
    throw new Error(
      `The specifyed release with pypy version ${pypyVersion.raw} and python version ${pythonVersion.raw} was not found`
    );
  }

  const {foundAsset, resolvedPythonVersion, resolvedPyPyVersion} = releaseData;
  let archiveName = foundAsset.filename.replace(/.zip|.tar.bz2/g, '');
  let downloadUrl = `${foundAsset.download_url}`;

  core.info(`Download PyPy from "${downloadUrl}"`);
  const pypyPath = await tc.downloadTool(downloadUrl);
  core.info('Extract downloaded archive');

  if (IS_WINDOWS) {
    downloadDir = await tc.extractZip(pypyPath);
  } else {
    downloadDir = await tc.extractTar(pypyPath, undefined, 'x');
  }

  const toolDir = path.join(downloadDir, archiveName!);
  const installDir = await tc.cacheDir(
    toolDir,
    'PyPy',
    resolvedPythonVersion,
    architecture
  );

  writeExactPyPyVersionFile(installDir, resolvedPyPyVersion);

  const binaryPath = getPyPyBinaryPath(installDir);
  await createSymlinks(binaryPath, resolvedPythonVersion);

  await installPip(binaryPath);

  return {installDir, resolvedPythonVersion, resolvedPyPyVersion};
}

async function getAvailablePyPyVersions() {
  const url = 'https://downloads.python.org/pypy/versions.json';
  const http: httpm.HttpClient = new httpm.HttpClient('tool-cache');

  const response = await http.getJson<IPyPyManifestRelease[]>(url);
  if (!response.result) {
    throw new Error(
      `Unable to retrieve the list of available versions from '${url}'`
    );
  }

  return response.result;
}

/** create Symlinks for downloaded PyPy
 *  It should be executed only for downloaded versions in runtime, because
 *  toolcache versions have this setup.
 */
// input-pypy.ts

function createSymlink(sourcePath: string, targetPath: string) {
  if (fs.existsSync(targetPath)) {
    return;
  }
  fs.symlinkSync(sourcePath, targetPath);
}

async function createSymlinks(pypyBinaryPath: string, pythonVersion: string) {
  const version = semver.coerce(pythonVersion)!;
  const pythonBinaryPostfix = semver.major(version);
  const pypyBinaryPostfix = pythonBinaryPostfix === 2 ? '' : '3';

  let binaryExtension = IS_WINDOWS ? '.exe' : '';
  const pythonLocation = path.join(pypyBinaryPath, 'python');
  const pypyLocation = path.join(pypyBinaryPath, 'pypy');

  createSymlink(
    `${pypyLocation}${pypyBinaryPostfix}${binaryExtension}`, //pypy3 or pypy
    `${pythonLocation}${pythonBinaryPostfix}${binaryExtension}` // python3 or python
  );
  // To-Do
  createSymlink(
    `${pypyLocation}${pypyBinaryPostfix}${binaryExtension}`, //pypy3 or pypy
    `${pypyLocation}${binaryExtension}` // pypy
  );
  createSymlink(
    `${pythonLocation}${pythonBinaryPostfix}${binaryExtension}`, // python3 or python
    `${pythonLocation}${binaryExtension}` // python
  );

  await exec.exec(
    `chmod +x ${pythonLocation}${binaryExtension} ${pythonLocation}${pythonBinaryPostfix}${binaryExtension}`
  );
}

async function installPip(pythonLocation: string) {
  await exec.exec(`${pythonLocation}/python -m ensurepip`);
  await exec.exec(
    `${pythonLocation}/python -m pip install --ignore-installed pip`
  );
  if (IS_WINDOWS) {
    const binPath = path.join(pythonLocation, 'bin');
    const scriptPath = path.join(pythonLocation, 'Scripts');
    fs.symlinkSync(scriptPath, binPath);
  }
}

function findRelease(
  releases: IPyPyManifestRelease[],
  pythonVersion: semver.Range,
  pypyVersion: semver.Range,
  architecture: string
) {
  const filterReleases = releases.filter(
    item =>
      semver.satisfies(item.python_version, pythonVersion) &&
      semver.satisfies(item.pypy_version, pypyVersion) &&
      item.files.some(
        file => file.arch === architecture && file.platform === process.platform
      )
  );

  if (filterReleases.length === 0) {
    return null;
  }

  // double check coerce
  const sortedReleases = filterReleases.sort((previous, current) => {
    return (
      semver.compare(
        semver.coerce(current.pypy_version)!,
        semver.coerce(previous.pypy_version)!
      ) ||
      semver.compare(
        semver.coerce(current.python_version)!,
        semver.coerce(previous.python_version)!
      )
    );
  });

  const foundRelease = sortedReleases[0];
  const foundAsset = foundRelease.files.find(
    item => item.arch === architecture && item.platform === process.platform
  );

  return {
    foundAsset,
    resolvedPythonVersion: foundRelease.python_version,
    resolvedPyPyVersion: foundRelease.pypy_version
  };
}

// helper functions

/** Get PyPy binary location from the tool of installation directory
 *  - On Linux and macOS, the Python interpreter is in 'bin'.
 *  - On Windows, it is in the installation root.
 */
export function getPyPyBinaryPath(installDir: string) {
  const _binDir = path.join(installDir, 'bin');
  return IS_WINDOWS ? installDir : _binDir;
}

export function readExactPyPyVersion(installDir: string) {
  let pypyVersion = '';
  let fileVersion = path.join(installDir, PYPY_VERSION_FILE);
  if (fs.existsSync(fileVersion)) {
    // PYPY_VERSION file contains version of PyPy. File was added because
    // stable PyPy versions can have beta or alpha prerelease even if we donwload
    // through official stable link. PYPY_VERSION create in time of image generation
    // and hold version
    pypyVersion = fs.readFileSync(fileVersion).toString();
    core.debug(`Version from ${PYPY_VERSION_FILE} file is ${pypyVersion}`);
  }

  return pypyVersion;
}

function writeExactPyPyVersionFile(
  installDir: string,
  resolvedPyPyVersion: string
) {
  const pypyFilePath = path.join(installDir, PYPY_VERSION_FILE);
  fs.writeFileSync(pypyFilePath, resolvedPyPyVersion);
}
