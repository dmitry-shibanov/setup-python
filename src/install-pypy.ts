import * as path from 'path';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as semver from 'semver';

const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';

interface IPyPyDownloads {
  filename: string;
  arch: string;
  platform: string;
  download_url: string;
}

interface IPyPyToolRelease {
  pypy_version: string;
  python_version: string;
  stable: boolean;
  latest_pypy: boolean;
  files: IPyPyDownloads[];
}

export async function installPyPy(
  pypyVersion: string,
  pythonVersion: string,
  architecture: string
) {
  let installDir;

  const releases = await getPyPyReleases();
  const release = await findRelease(
    releases,
    pythonVersion,
    pypyVersion,
    architecture
  );

  let archiveName = release?.filename.replace(/.zip|.tar.bz2/g, '');
  let downloadUrl = `${release?.download_url}`;

  core.info(`Download from "${downloadUrl}"`);
  const pypyPath = await tc.downloadTool(downloadUrl);
  core.info('Extract downloaded archive');

  if (IS_WINDOWS) {
    installDir = await tc.extractZip(pypyPath);
  } else {
    installDir = await tc.extractTar(pypyPath, undefined, 'x');
  }
  core.info(`install dir is ${installDir}`);
  const toolDir = path.join(installDir, archiveName!);
  const cacheDir = await tc.cacheDir(toolDir, 'PyPy', pythonVersion);

  return cacheDir;
}

async function getPyPyReleases() {
  const jsonContent = await tc.downloadTool(
    'https://downloads.python.org/pypy/versions.json'
  );
  const releases: IPyPyToolRelease[] = JSON.parse(
    fs.readFileSync(jsonContent).toString()
  );

  return releases;
}

function findRelease(
  releases: IPyPyToolRelease[],
  pythonVersion: string,
  pypyVersion: string,
  architecture: string
) {
  const filterReleases = releases.filter(
    item =>
      semver.satisfies(item.python_version, pythonVersion) &&
      semver.satisfies(item.pypy_version, pypyVersion)
  );

  // should we sort it ?
  const sortedReleases = filterReleases.sort((a, b) => {
    let result = semver.compare(a.pypy_version, b.pypy_version);
    if (result !== 0) {
      return result;
    } else {
      return semver.compare(a.pypy_version, b.pypy_version);
    }
  });

  for (let item of sortedReleases) {
    if (
      semver.satisfies(item.python_version, pythonVersion) &&
      semver.satisfies(item.pypy_version, pypyVersion)
    ) {
      return item.files.find(
        item => item.arch === architecture && item.platform === process.platform
      );
    }
  }

  return null;
}
