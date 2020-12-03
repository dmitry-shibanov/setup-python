import * as path from 'path';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';

const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';

export async function installPyPy(
  pypyVersion: string,
  pythonVersion: string,
  architecture: string
) {
  const platform = IS_MACOS ? 'osx' : process.platform;
  const pypyUrl = 'https://downloads.python.org/pypy';
  let downloadUrl;
  let archiveName;
  let installDir;

  if (IS_WINDOWS) {
    archiveName = `pypy${pythonVersion}-v${pypyVersion}-${platform}`;
    downloadUrl = `${pypyUrl}/pypy${pythonVersion}-v${pypyVersion}-${platform}.zip`;
  } else {
    const arch = architecture.replace('x', '');
    archiveName = `pypy${pythonVersion}-v${pypyVersion}-${platform}${arch}`;
    downloadUrl = `${pypyUrl}/pypy${pythonVersion}-v${pypyVersion}-${platform}${arch}.tar.bz2`;
  }

  core.info(`Download from "${downloadUrl}"`);
  const pypyPath = await tc.downloadTool(downloadUrl);
  core.info('Extract downloaded archive');

  if (IS_WINDOWS) {
    installDir = await tc.extractZip(pypyPath);
  } else {
    installDir = await tc.extractTar(pypyPath, undefined, 'x');
  }
  core.info(`install dir is ${installDir}`);
  const toolDir = path.join(installDir, archiveName);
  const cacheDir = await tc.cacheDir(toolDir, 'PyPy', pythonVersion);

  return cacheDir;
}
