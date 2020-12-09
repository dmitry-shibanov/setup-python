import * as path from 'path';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as httpm from '@actions/http-client';
import * as exec from '@actions/exec';
import * as fs from 'fs';

const IS_WINDOWS = process.platform === 'win32';

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
  core.info(
    `Download python ${resolvedPythonVersion} and PyPy ${resolvedPyPyVersion}`
  );
  core.info('Extract downloaded archive');

  // TO-DO: double check logs
  if (IS_WINDOWS) {
    downloadDir = await tc.extractZip(pypyPath);
  } else {
    downloadDir = await tc.extractTar(pypyPath, undefined, 'x');
  }

  core.debug(`Extracted archives to ${downloadDir}`);
  core.debug(`Archive name is ${archiveName}`);

  const toolDir = path.join(downloadDir, archiveName!);
  const installDir = await tc.cacheDir(toolDir, 'PyPy', resolvedPythonVersion);

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
export async function createSymlinks(
  pypyBinaryPath: string,
  pythonVersion: string
) {
  const version = semver.coerce(pythonVersion)!;
  const pythonBinaryPostfix = semver.major(version);
  const pypyBinaryPostfix = pythonBinaryPostfix === 2 ? '' : '3';

  let binaryExtension = IS_WINDOWS ? '.exe' : '';
  const pythonLocation = path.join(pypyBinaryPath, 'python');
  const pypyLocation = path.join(pypyBinaryPath, 'pypy');
  fs.symlinkSync(
    `${pypyLocation}${pypyBinaryPostfix}${binaryExtension}`,
    `${pythonLocation}${pythonBinaryPostfix}${binaryExtension}`
  );
  if (pypyBinaryPostfix) {
    fs.symlinkSync(
      `${pypyLocation}${pypyBinaryPostfix}${binaryExtension}`,
      `${pypyLocation}${binaryExtension}`
    );
  }
  fs.symlinkSync(
    `${pythonLocation}${pythonBinaryPostfix}${binaryExtension}`,
    `${pythonLocation}${binaryExtension}`
  );
  await exec.exec(
    `chmod +x ${pythonLocation}${binaryExtension} ${pythonLocation}${pythonBinaryPostfix}${binaryExtension}`
  );

  await installPiP(pypyBinaryPath);
}

async function installPiP(pythonLocation: string) {
  await exec.exec(`${pythonLocation}/python -m ensurepip`);
  await exec.exec(
    `${pythonLocation}/python -m pip install --ignore-installed pip`
  );
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
