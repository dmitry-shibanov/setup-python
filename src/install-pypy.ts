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
  pypyVersion: string,
  pythonVersion: string,
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
      `PyPy version ${pythonVersion} (${pypyVersion}) with arch ${architecture} not found`
    );
  }

  const {foundAsset, resolvedPythonVersion, resolvedPyPyVersion} = releaseData;
  let downloadUrl = `${foundAsset.download_url}`;

  core.info(`Download PyPy from "${downloadUrl}"`);
  const pypyPath = await tc.downloadTool(downloadUrl);

  core.info('Extract downloaded archive');
  if (IS_WINDOWS) {
    downloadDir = await tc.extractZip(pypyPath);
  } else {
    downloadDir = await tc.extractTar(pypyPath, undefined, 'x');
  }

  // root folder in archive can have unpredictable name so just take the first folder
  // downloadDir is unique folder under TEMP and can't contain any other folders
  const archiveName = fs.readdirSync(downloadDir)[0];

  const toolDir = path.join(downloadDir, archiveName);
  let installDir = toolDir;
  if (!isNightlyKeyword(resolvedPyPyVersion)) {
    installDir = await tc.cacheDir(
      toolDir,
      'PyPy',
      resolvedPythonVersion,
      architecture
    );
  }

  writeExactPyPyVersionFile(installDir, resolvedPyPyVersion);

  const binaryPath = getPyPyBinaryPath(installDir);
  await createPyPySymlink(binaryPath, resolvedPythonVersion);
  await installPip(binaryPath);

  return {installDir, resolvedPythonVersion, resolvedPyPyVersion};
}

async function getAvailablePyPyVersions() {
  const url = 'https://downloads.python.org/pypy/versions.json';
  const http: httpm.HttpClient = new httpm.HttpClient('tool-cache');

  const response = await http.getJson<IPyPyManifestRelease[]>(url);
  if (!response.result) {
    throw new Error(
      `Unable to retrieve the list of available PyPy versions from '${url}'`
    );
  }

  return response.result;
}

async function createPyPySymlink(
  pypyBinaryPath: string,
  pythonVersion: string
) {
  const version = semver.coerce(pythonVersion)!;
  const pythonBinaryPostfix = semver.major(version);
  const pypyBinaryPostfix = pythonBinaryPostfix === 2 ? '' : '3';

  let binaryExtension = IS_WINDOWS ? '.exe' : '';
  const pythonLocation = path.join(pypyBinaryPath, 'python');
  const pypyLocation = path.join(
    pypyBinaryPath,
    `pypy${pypyBinaryPostfix}${binaryExtension}`
  );
  const pypySimlink = path.join(pypyBinaryPath, `pypy${binaryExtension}`);
  core.info('Create symlinks');
  createSymlink(
    pypyLocation,
    `${pythonLocation}${pythonBinaryPostfix}${binaryExtension}`
  );

  createSymlink(pypyLocation, pypySimlink);
  createSymlink(pypyLocation, `${pythonLocation}${binaryExtension}`);

  await exec.exec(
    `chmod +x ${pythonLocation}${binaryExtension} ${pythonLocation}${pythonBinaryPostfix}${binaryExtension}`
  );
}

async function installPip(pythonLocation: string) {
  core.info('Installing and updating pip');
  await exec.exec(`${pythonLocation}/python -m ensurepip`);
  // TO-DO should we skip updating of pip ?
  await exec.exec(
    `${pythonLocation}/python -m pip install --ignore-installed pip`
  );

  if (IS_WINDOWS) {
    // Create symlink separatelly from createPyPySymlink, because
    // Scripts folder had not existed before installation of pip.
    const binPath = path.join(pythonLocation, 'bin');
    const scriptPath = path.join(pythonLocation, 'Scripts');
    fs.symlinkSync(scriptPath, binPath);
  }
}

export function findRelease(
  releases: IPyPyManifestRelease[],
  pythonVersion: string,
  pypyVersion: string,
  architecture: string
) {
  const filterReleases = releases.filter(item => {
    const isPythonVersionSatisfies = semver.satisfies(
      semver.coerce(item.python_version)!,
      pythonVersion
    );
    const isPyPyNightly =
      isNightlyKeyword(pypyVersion) && isNightlyKeyword(item.pypy_version);
    const isPyPyVersionSatisfies =
      isPyPyNightly ||
      semver.satisfies(pypyVersionToSemantic(item.pypy_version), pypyVersion);
    const isArchExists = item.files.some(
      file => file.arch === architecture && file.platform === process.platform
    );
    return isPythonVersionSatisfies && isPyPyVersionSatisfies && isArchExists;
  });

  if (filterReleases.length === 0) {
    return null;
  }

  const sortedReleases = filterReleases.sort((previous, current) => {
    return (
      semver.compare(
        semver.coerce(pypyVersionToSemantic(current.pypy_version))!,
        semver.coerce(pypyVersionToSemantic(previous.pypy_version))!
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

/**
 * In tool-cache, we put PyPy to '<toolcache_root>/PyPy/<python_version>/x64'
 * There is no easy way to determine what PyPy version is located in specific folder
 * 'pypy --version' is not reliable enough since it is not set properly for preview versions
 * "7.3.3rc1" is marked as '7.3.3' in 'pypy --version'
 * so we put PYPY_VERSION file to PyPy directory when install it to VM and read it when we need to know version
 * PYPY_VERSION contains exact version from 'versions.json'
 */
export function readExactPyPyVersion(installDir: string) {
  let pypyVersion = '';
  let fileVersion = path.join(installDir, PYPY_VERSION_FILE);
  if (fs.existsSync(fileVersion)) {
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

/** Get PyPy binary location from the tool of installation directory
 *  - On Linux and macOS, the Python interpreter is in 'bin'.
 *  - On Windows, it is in the installation root.
 */
export function getPyPyBinaryPath(installDir: string) {
  const _binDir = path.join(installDir, 'bin');
  return IS_WINDOWS ? installDir : _binDir;
}

/** create Symlinks for downloaded PyPy
 *  It should be executed only for downloaded versions in runtime, because
 *  toolcache versions have this setup.
 */
function createSymlink(sourcePath: string, targetPath: string) {
  if (fs.existsSync(targetPath)) {
    return;
  }
  fs.symlinkSync(sourcePath, targetPath);
}

function isNightlyKeyword(pypyVersion: string) {
  return pypyVersion === 'nightly';
}

export function pypyVersionToSemantic(versionSpec: string) {
  const prereleaseVersion = /(\d+\.\d+\.\d+)((?:a|b|rc))(\d*)/g;
  return versionSpec.replace(prereleaseVersion, '$1-$2.$3');
}
