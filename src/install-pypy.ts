import * as path from 'path';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as semver from 'semver';

const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';

interface IPyPyRelease {
  pypy_version: string;
  python_version: string;
  package: string;
}

export async function installPyPy(
  pypyVersion: string,
  pythonVersion: string,
  architecture: string
) {
  const platform = IS_MACOS ? 'osx' : process.platform;
  const pypyUrl = 'https://downloads.python.org/pypy';
  let installDir;

  const releases = await getPyPyReleases();
  const arch = architecture.replace('x', '');
  const release = await findRelease(
    releases!,
    pythonVersion,
    pypyVersion,
    platform
  );

  let archiveName = release?.package.replace(/[.zip|.tar.bz2]/g, '');
  let downloadUrl = `${pypyUrl}/${release?.package}`;

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
  const page = await tc.downloadTool('https://downloads.python.org/pypy/');
  const body = fs.readFileSync(page).toString();
  core.debug(body);
  const matches = body.match(/"pypy*(.*?)\s*[zip|bz2]\"/g);
  const releases: IPyPyRelease[] | undefined = matches?.map(item => {
    const validItem = item.replace(/"/g, '');
    let args = validItem.split('-');
    const pythonVersion = args[0].replace('pypy', '');
    const pypyVersion = semver.clean(args[1]);
    const release: IPyPyRelease = {
      pypy_version: pypyVersion!,
      python_version: pythonVersion,
      package: validItem
    };
    return release;
  });

  return releases;
}

function findRelease(
  releases: IPyPyRelease[],
  pythonVersion: string,
  pypyVersion: string,
  platform: string
) {
  const filterReleases = releases.filter(
    item =>
      item.package.includes(platform) &&
      semver.satisfies(item.python_version, pythonVersion) &&
      semver.satisfies(item.pypy_version, pypyVersion)
  );

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
      return item;
    }
  }

  return null;
}

function validSemverVersion(pythonVersion: string) {
  if (!pythonVersion.includes('.x')) {
    pythonVersion = `${pythonVersion}.x`;
  }

  return pythonVersion;
}
