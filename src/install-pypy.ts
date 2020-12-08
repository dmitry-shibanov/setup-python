import * as path from 'path';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as semver from 'semver';
import * as httpm from '@actions/http-client';

const IS_WINDOWS = process.platform === 'win32';

interface IPyPyManifestFile {
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
  files: IPyPyManifestFile[];
}

export async function installPyPy(
  pypyVersion: semver.Range,
  pythonVersion: semver.Range,
  architecture: string
) {
  let downloadDir;

  const releases = await getAvailablePyPyVersions();
  const releaseData = await findRelease(
    releases,
    pythonVersion,
    pypyVersion,
    architecture
  );

  if (!releaseData || !releaseData.release) {
    throw new Error(
      `The specifyed release with pypy version ${pypyVersion.raw} and python version ${pythonVersion.raw} was not found`
    );
  }

  const {release, python_version, pypy_version} = releaseData;
  let archiveName = release.filename.replace(/.zip|.tar.bz2/g, '');
  let downloadUrl = `${release.download_url}`;

  core.info(`Download PyPy from "${downloadUrl}"`);
  const pypyPath = await tc.downloadTool(downloadUrl);
  core.info(`Download python ${python_version} and PyPy ${pypy_version}`);
  core.info('Extract downloaded archive');

  if (IS_WINDOWS) {
    downloadDir = await tc.extractZip(pypyPath);
  } else {
    downloadDir = await tc.extractTar(pypyPath, undefined, 'x');
  }

  core.debug(`Extracted archives to ${downloadDir}`);
  core.debug(`Archive name is ${archiveName}`);

  const toolDir = path.join(downloadDir, archiveName!);
  const installDir = await tc.cacheDir(toolDir, 'PyPy', python_version);

  return {installDir, python_version, pypy_version};
}

async function getAvailablePyPyVersions() {
  const url = 'https://downloads.python.org/pypy/versions.json';
  const jsonPath = await tc.downloadTool(url);

  const http: httpm.HttpClient = new httpm.HttpClient('tool-cache');
  const headers = {};

  const response = await http.getJson<any>(url, headers); // fix type from any
  if (!response.result) {
    throw new Error('no data was found');
  }

  const releases: IPyPyManifestRelease[] = JSON.parse(response.result);

  return releases;
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
      item.files.find(
        file => file.arch === architecture && file.platform === process.platform
      )
  );

  if (filterReleases.length > 0) {
    throw new Error('no releases were found');
  }

  const sortedReleases = filterReleases.sort((previous, current) => {
    let result = semver.compare(
      semver.coerce(current.pypy_version)!,
      semver.coerce(previous.pypy_version)!
    );

    if (result === 0) {
      return semver.compare(
        semver.coerce(current.pypy_version)!,
        semver.coerce(previous.python_version)!
      );
    }

    return result;
  });

  const release = sortedReleases[0].files.find(
    item => item.arch === architecture && item.platform === process.platform
  );

  return {
    release,
    python_version: sortedReleases[0].python_version,
    pypy_version: sortedReleases[0].pypy_version
  };
}
