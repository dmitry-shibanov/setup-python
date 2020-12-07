import * as path from 'path';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as semver from 'semver';

const IS_WINDOWS = process.platform === 'win32';

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
  let downloadDir;

  const releases = await getPyPyReleases();
  const releaseData = await findRelease(
    releases,
    pythonVersion,
    pypyVersion,
    architecture
  );

  if (!releaseData || !releaseData.release) {
    throw new Error(
      `The specifyed release with pypy version ${pypyVersion} and python version ${pythonVersion} was not found`
    );
  }

  const {release, python_version, pypy_version} = releaseData;
  let archiveName = release.filename.replace(/.zip|.tar.bz2/g, '');
  let downloadUrl = `${release.download_url}`;

  core.info(`Download from "${downloadUrl}"`);
  const pypyPath = await tc.downloadTool(downloadUrl);
  core.info('Extract downloaded archive');
  core.info(`Download python ${python_version} and PyPy ${pypy_version}`);

  if (IS_WINDOWS) {
    downloadDir = await tc.extractZip(pypyPath);
  } else {
    downloadDir = await tc.extractTar(pypyPath, undefined, 'x');
  }

  const toolDir = path.join(downloadDir, archiveName!);
  const installDir = await tc.cacheDir(toolDir, 'PyPy', python_version);

  return {installDir, python_version, pypy_version};
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

  for (let item of filterReleases) {
    if (
      semver.satisfies(item.python_version, pythonVersion) &&
      semver.satisfies(item.pypy_version, pypyVersion)
    ) {
      const release = item.files.find(
        item => item.arch === architecture && item.platform === process.platform
      );

      return {
        release,
        python_version: item.python_version,
        pypy_version: item.pypy_version
      };
    }
  }

  return null;
}
