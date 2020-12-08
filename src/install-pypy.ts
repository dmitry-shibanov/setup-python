import * as path from 'path';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';
import * as semver from 'semver';

const IS_WINDOWS = process.platform === 'win32';

interface IPyPyDownload {
  filename: string;
  arch: string;
  platform: string;
  download_url: string;
}

interface IPyPylRelease {
  pypy_version: string;
  python_version: string;
  stable: boolean;
  latest_pypy: boolean;
  files: IPyPyDownload[];
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

  if (pypyVersion === 'nightly') {
    let dirContent = fs.readdirSync(downloadDir);
    let extractArchive = dirContent.filter(function (element) {
      return element.match(/pypy-c*/gi);
    });
    archiveName = extractArchive[0];
  }

  core.debug(`Archive name is ${archiveName}`);

  const toolDir = path.join(downloadDir, archiveName!);
  const installDir = await tc.cacheDir(toolDir, 'PyPy', python_version);

  return {installDir, python_version, pypy_version};
}

async function getPyPyReleases() {
  const jsonPath = await tc.downloadTool(
    'https://downloads.python.org/pypy/versions.json'
  );
  const jsonString = fs.readFileSync(jsonPath).toString();
  const releases: IPyPylRelease[] = JSON.parse(jsonString);

  return releases;
}

function findRelease(
  releases: IPyPylRelease[],
  pythonVersion: string,
  pypyVersion: string,
  architecture: string
) {
  const nightlyBuild = pypyVersion === 'nightly' ? '.0' : '';
  const filterReleases = releases.filter(
    item =>
      semver.satisfies(
        `${item.python_version}${nightlyBuild}`,
        pythonVersion
      ) &&
      (semver.satisfies(item.pypy_version, pypyVersion) ||
        item.pypy_version === 'nightly')
  );

  const release = filterReleases[0].files.find(
    item => item.arch === architecture && item.platform === process.platform
  );

  return {
    release,
    python_version: filterReleases[0].python_version,
    pypy_version: filterReleases[0].pypy_version
  };
}
