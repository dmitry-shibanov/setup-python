import {HttpClient} from '@actions/http-client';
import * as ifm from '@actions/http-client/interfaces';
import * as tc from '@actions/tool-cache';
import * as exec from '@actions/exec';
import * as core from '@actions/core';

import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';

import * as finder from '../src/find-pypy';
import * as installer from '../src/install-pypy';
import * as setup from '../src/setup-python';

const manifestData = require('./data/pypy.json');

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

let architecture: string;

if (process.platform === 'win32') {
  architecture = 'x86';
} else {
  architecture = 'x64';
}

const toolDir = path.join(
  __dirname,
  'runner',
  path.join(Math.random().toString(36).substring(7)),
  'tools'
);
const tempDir = path.join(
  __dirname,
  'runner',
  path.join(Math.random().toString(36).substring(7)),
  'temp'
);

describe('pypyVersionToSemantic', () => {
  it('pypyVersionToSemantic get 7.3.3rc1 and return 7.3.3-rc.1', () => {
    expect(installer.pypyVersionToSemantic('7.3.3rc1')).toEqual('7.3.3-rc.1');
  });

  it('pypyVersionToSemantic get 7.3.3 and return 7.3.3', () => {
    expect(installer.pypyVersionToSemantic('7.3.3')).toEqual('7.3.3');
  });

  it('pypyVersionToSemantic get 7.3.x and return 7.3.x', () => {
    expect(installer.pypyVersionToSemantic('7.3.x')).toEqual('7.3.x');
  });

  it('pypyVersionToSemantic get 7.x and return 7.x', () => {
    expect(installer.pypyVersionToSemantic('7.x')).toEqual('7.x');
  });

  it('pypyVersionToSemantic get nightly and return nightly', () => {
    expect(installer.pypyVersionToSemantic('nightly')).toEqual('nightly');
  });
});

describe('parsePyPyVersion', () => {
  it("versionSpec splits 'pypy-3.6-7.3.3'", () => {
    expect(finder.parsePyPyVersion('pypy-3.6-7.3.3')).toEqual({
      pythonVersion: '3.6',
      pypyVersion: '7.3.3'
    });
  });

  it("versionSpec splits 'pypy-3.6-7.3.x'", () => {
    expect(finder.parsePyPyVersion('pypy-3.6-7.3.x')).toEqual({
      pythonVersion: '3.6',
      pypyVersion: '7.3.x'
    });
  });

  it("versionSpec splits 'pypy-3.6-7.x'", () => {
    expect(finder.parsePyPyVersion('pypy-3.6-7.x')).toEqual({
      pythonVersion: '3.6',
      pypyVersion: '7.x'
    });
  });

  it("versionSpec splits 'pypy-3.6'", () => {
    expect(finder.parsePyPyVersion('pypy-3.6')).toEqual({
      pythonVersion: '3.6',
      pypyVersion: 'x'
    });
  });

  it("versionSpec splits 'pypy-3.6-nightly'", () => {
    expect(finder.parsePyPyVersion('pypy-3.6-nightly')).toEqual({
      pythonVersion: '3.6',
      pypyVersion: 'nightly'
    });
  });

  it("versionSpec splits 'pypy-3.6-7.3.3rc1'", () => {
    expect(finder.parsePyPyVersion('pypy-3.6-7.3.3rc1')).toEqual({
      pythonVersion: '3.6',
      pypyVersion: '7.3.3-rc.1'
    });
  });

  it("versionSpec tries to split 'pypy-' and should throw an error", () => {
    expect(() => finder.parsePyPyVersion('pypy-')).toThrowError(
      "Invalid 'version' property for PyPy. PyPy version should be specified as 'pypy-<python-version>'. See readme for more examples."
    );
  });
});

describe('findPyPyToolCache', () => {
  const actualPythonVersion = '3.6.17';
  const actualPyPyVersion = '7.5.4';
  const pypyPath = path.join('PyPy', actualPythonVersion, architecture);
  let tcFind: jest.SpyInstance;
  let spyReadExactPyPyVersion: jest.SpyInstance;

  beforeEach(() => {
    tcFind = jest.spyOn(tc, 'find');
    tcFind.mockImplementation((toolname: string, pythonVersion: string) => {
      const semverVersion = new semver.Range(pythonVersion);
      return semver.satisfies(actualPythonVersion, semverVersion)
        ? pypyPath
        : '';
    });

    spyReadExactPyPyVersion = jest.spyOn(installer, 'readExactPyPyVersion');
    spyReadExactPyPyVersion.mockImplementation(() => actualPyPyVersion);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
    jest.clearAllMocks();
  });

  it('PyPy exists in the path and versions are satisfied', () => {
    expect(finder.findPyPyToolCache('3.6.17', '7.5.4', architecture)).toEqual({
      installDir: pypyPath,
      resolvedPythonVersion: actualPythonVersion,
      resolvedPyPyVersion: actualPyPyVersion
    });
  });

  it('PyPy exists in the path and versions are satisfied with semver', () => {
    expect(finder.findPyPyToolCache('3.6', '7.5.x', architecture)).toEqual({
      installDir: pypyPath,
      resolvedPythonVersion: actualPythonVersion,
      resolvedPyPyVersion: actualPyPyVersion
    });
  });

  it('PyPy exists in the path, but Python version is not equal', () => {
    expect(finder.findPyPyToolCache('3.7', '7.5.4', architecture)).toEqual({
      installDir: '',
      resolvedPythonVersion: '',
      resolvedPyPyVersion: ''
    });
  });

  it('PyPy exists in the path, but PyPy version is not equal', () => {
    expect(finder.findPyPyToolCache('3.6', '7.5.1', architecture)).toEqual({
      installDir: null,
      resolvedPythonVersion: '',
      resolvedPyPyVersion: ''
    });
  });
});

describe('findRelease', () => {
  const result = JSON.stringify(manifestData);
  const releases = JSON.parse(result) as IPyPyManifestRelease[];
  let files: IPyPyManifestAsset;
  const windowsFiles = {
    filename: 'pypy3.6-v7.3.3-win32.zip',
    arch: 'x86',
    platform: 'win32',
    download_url:
      'https://test.download.python.org/pypy/pypy3.6-v7.3.3-win32.zip'
  };

  const linuxFiles = {
    filename: 'pypy3.6-v7.3.3-linux64.tar.bz2',
    arch: 'x64',
    platform: 'linux',
    download_url:
      'https://test.download.python.org/pypy/pypy3.6-v7.3.3-linux64.tar.bz2'
  };

  const darwinFiles = {
    filename: 'pypy3.6-v7.3.3-osx64.tar.bz2',
    arch: 'x64',
    platform: 'darwin',
    download_url:
      'https://test.download.python.org/pypy/pypy3.6-v7.3.3-osx64.tar.bz2'
  };

  if (process.platform === 'win32') {
    files = windowsFiles;
  } else if (process.platform === 'darwin') {
    files = darwinFiles;
  } else {
    files = linuxFiles;
  }

  it('The specifyed python version was found, but PyPy version was not satsifyed', () => {
    const pythonVersion = '3.6';
    const pypyVersion = '7.3.7';
    expect(
      installer.findRelease(releases, pythonVersion, pypyVersion, architecture)
    ).toEqual(null);
  });

  it('The release with python 3.6 and PyPy 7.3.3 was found', () => {
    const pythonVersion = '3.6';
    const pypyVersion = '7.3.3';
    expect(
      installer.findRelease(releases, pythonVersion, pypyVersion, architecture)
    ).toEqual({
      foundAsset: files,
      resolvedPythonVersion: '3.6.12',
      resolvedPyPyVersion: pypyVersion
    });
  });

  it('The release with python 3.6 and PyPy 7.x was found', () => {
    const pythonVersion = '3.6';
    const pypyVersion = '7.x';
    expect(
      installer.findRelease(releases, pythonVersion, pypyVersion, architecture)
    ).toEqual({
      foundAsset: files,
      resolvedPythonVersion: '3.6.12',
      resolvedPyPyVersion: '7.3.3'
    });
  });

  it('The release with python 3.7 and PyPy x was found', () => {
    const pythonVersion = '3.7';
    const pypyVersion = 'x';
    expect(
      installer.findRelease(releases, pythonVersion, pypyVersion, architecture)
    ).toEqual({
      foundAsset: files,
      resolvedPythonVersion: '3.7.7',
      resolvedPyPyVersion: '7.3.3'
    });
  });

  it('The specifyed nightly release was found', () => {
    const pythonVersion = '3.6';
    const pypyVersion = 'nightly';
    const filename =
      process.platform === 'win32' ? 'filename.zip' : 'filename.tar.bz2';
    expect(
      installer.findRelease(releases, pythonVersion, pypyVersion, architecture)
    ).toEqual({
      foundAsset: {
        filename: filename,
        arch: architecture,
        platform: process.platform,
        download_url: `http://nightlyBuilds.org/${filename}`
      },
      resolvedPythonVersion: '3.6',
      resolvedPyPyVersion: pypyVersion
    });
  });
});

describe('Whole workflow', () => {
  let tcFind: jest.SpyInstance;
  let spyExtractZip: jest.SpyInstance;
  let spyExtractTar: jest.SpyInstance;
  let spyFsReadDir: jest.SpyInstance;
  let spyFsWriteFile: jest.SpyInstance;
  let spyHttpClient: jest.SpyInstance;
  let spyExistsSync: jest.SpyInstance;
  let spyExec: jest.SpyInstance;
  let spySymlinkSync: jest.SpyInstance;

  beforeEach(() => {
    tcFind = jest.spyOn(tc, 'find');
    tcFind.mockImplementation(() =>
      path.join('PyPy', '3.6.12', process.platform === 'win32' ? 'x86' : 'x64')
    );

    spyExtractZip = jest.spyOn(tc, 'extractZip');
    spyExtractZip.mockImplementation(() => tempDir);

    spyExtractTar = jest.spyOn(tc, 'extractTar');
    spyExtractTar.mockImplementation(() => tempDir);

    spyFsReadDir = jest.spyOn(fs, 'readdirSync');
    spyFsReadDir.mockImplementation(() => ['PyPyTest']);

    spyFsWriteFile = jest.spyOn(fs, 'writeFileSync');
    spyFsWriteFile.mockImplementation(() => undefined);

    spyHttpClient = jest.spyOn(HttpClient.prototype, 'getJson');
    spyHttpClient.mockImplementation(
      async (): Promise<ifm.ITypedResponse<IPyPyManifestRelease[]>> => {
        const result = JSON.stringify(manifestData);
        return {
          statusCode: 200,
          headers: {},
          result: JSON.parse(result) as IPyPyManifestRelease[]
        };
      }
    );

    spyExec = jest.spyOn(exec, 'exec');
    spyExec.mockImplementation(() => undefined);

    spySymlinkSync = jest.spyOn(fs, 'symlinkSync');
    spySymlinkSync.mockImplementation(() => undefined);

    spyExistsSync = jest.spyOn(fs, 'existsSync');
    spyExistsSync.mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
    jest.clearAllMocks();
  });

  it('installPyPy throws an error because release was not found', () => {
    expect(
      installer.installPyPy('7.3.3', '3.6.17', architecture)
    ).rejects.toThrowError(
      `PyPy version 3.6.17 (7.3.3) with arch ${architecture} not found`
    );
  });

  it('installPyPy returns installDir, pypyVersion and pythonVersion', () => {
    expect(installer.installPyPy('7.3.x', '3.6.12', 'x64')).resolves.toEqual({
      installDir: path.join(toolDir, 'PyPy', '3.6.12', architecture),
      resolvedPythonVersion: '3.6.12',
      resolvedPyPyVersion: '7.3.3'
    });
  });

  it('findPyPyVersion finds PyPy from toolcache', () => {
    expect(
      finder.findPyPyVersion('pypy3.6-7.3.x', architecture)
    ).resolves.toEqual({
      installDir: path.join(toolDir, 'PyPy', '3.6.12', architecture),
      resolvedPythonVersion: '3.6.12',
      resolvedPyPyVersion: '7.3.3'
    });
  });

  it('findPyPyVersion throws an error that release was not found', () => {
    expect(
      finder.findPyPyVersion('pypy3.7-7.3.x', architecture)
    ).rejects.toThrowError(
      `PyPy version 3.7 (7.3.x) with arch ${architecture} not found`
    );
  });

  it('findPyPyVersion downloads PyPy', () => {
    expect(
      finder.findPyPyVersion('pypy3.7-7.3.x', architecture)
    ).resolves.toEqual({
      installDir: path.join(toolDir, 'PyPy', '3.7.7', architecture),
      resolvedPythonVersion: '3.7.7',
      resolvedPyPyVersion: '7.3.3'
    });
  });

  it('findPyPyVersion throws an error Invalid comparator', () => {
    expect(
      finder.findPyPyVersion('pypy3.7-7.3.x', architecture)
    ).rejects.toThrowError(/Invalid comparator: */);
  });
});
