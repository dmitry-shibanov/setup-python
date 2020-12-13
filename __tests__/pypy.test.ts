import fs = require('fs');
import path = require('path');
import httpm, {HttpClient} from '@actions/http-client';
import * as ifm from '@actions/http-client/interfaces';
import * as tc from '@actions/tool-cache';
import * as exec from '@actions/exec';
const manifestData = require('./data/pypy.json');

import * as finder from '../src/find-pypy';
import * as installer from '../src/install-pypy';

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

describe('Test pypyVersionToSemantic', () => {
  it('pypyVersionToSemantic with 7.3.3rc1 to 7.3.3-rc.1', () => {
    expect(installer.pypyVersionToSemantic('7.3.3rc1')).toEqual('7.3.3-rc.1');
  });

  it('pypyVersionToSemantic with 7.3.3 return 7.3.3', () => {
    expect(installer.pypyVersionToSemantic('7.3.3')).toEqual('7.3.3');
  });

  it('pypyVersionToSemantic with 7.3.x to 7.3.x', () => {
    expect(installer.pypyVersionToSemantic('7.3.x')).toEqual('7.3.x');
  });

  it('pypyVersionToSemantic with 7.x to 7.x', () => {
    expect(installer.pypyVersionToSemantic('7.x')).toEqual('7.x');
  });

  it('pypyVersionToSemantic with nightly to nightly', () => {
    expect(installer.pypyVersionToSemantic('nightly')).toEqual('nightly');
  });
});

describe('Test whole workflow', () => {
  let tcFind: jest.SpyInstance = jest.spyOn(tc, 'find');
  tcFind.mockImplementation(() =>
    path.join('PyPy', '3.6.12', process.platform === 'win32' ? 'x86' : 'x64')
  );

  let spyExtractZip: jest.SpyInstance;
  let spyExtractTar: jest.SpyInstance;
  let spyFsReadDir: jest.SpyInstance;
  let spyFsWriteFile: jest.SpyInstance;
  let spyHttpClient: jest.SpyInstance;
  let spyExistsSync: jest.SpyInstance;
  let spyExec: jest.SpyInstance;
  let spySymlinkSync: jest.SpyInstance;

  beforeEach(() => {
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

  it(`installPyPy throws an error because release was not found`, () => {
    expect(
      installer.installPyPy('7.3.3', '3.6.17', architecture)
    ).rejects.toThrowError(
      `PyPy version 3.6.17 (7.3.3) with arch ${architecture} not found`
    );
  });

  it(`installPyPy return installDir, pypyVersion and pythonVersion`, () => {
    expect(installer.installPyPy('7.3.x', '3.6.12', 'x64')).resolves.toEqual({
      installDir: path.join(toolDir, 'PyPy', '3.6.12', architecture),
      resolvedPythonVersion: '3.6.12',
      resolvedPyPyVersion: '7.3.3'
    });
  });

  it(`findPyPyVersion finds from toolcache`, () => {
    expect(
      finder.findPyPyVersion('pypy3.7-7.3.x', architecture)
    ).resolves.toEqual({
      installDir: path.join(toolDir, 'PyPy', '3.6.12', architecture),
      resolvedPythonVersion: '3.6.12',
      resolvedPyPyVersion: '7.3.3'
    });
  });

  it(`findPyPyVersion throws an error that release was not found`, () => {
    expect(
      finder.findPyPyVersion('pypy3.7-7.3.x', architecture)
    ).rejects.toThrowError(
      `PyPy version 3.7 (7.3.x) with arch ${architecture} not found`
    );
  });

  it(`findPyPyVersion downloads PyPy`, () => {
    expect(
      finder.findPyPyVersion('pypy3.7-7.3.x', architecture)
    ).resolves.toEqual({
      installDir: path.join(toolDir, 'PyPy', '3.7.7', architecture),
      resolvedPythonVersion: '3.7.7',
      resolvedPyPyVersion: '7.3.3'
    });
  });

  it(`findPyPyVersion throws an error Invalid comparator`, () => {
    expect(
      finder.findPyPyVersion('pypy3.7-7.3.x', architecture)
    ).rejects.toThrowError(/Invalid comparator: */);
  });
});
