import fs = require('fs');
import path = require('path');
import * as httpm from '@actions/http-client';
import * as tc from '@actions/tool-cache';
import * as exec from '@actions/exec';
import * as data from './data/pypy.json';

import * as finder from '../src/find-pypy';
import * as installer from '../src/install-pypy';

class SpyHttpClient {
  constructor(private userAgent: string) {}

  getJson = async <T>() => {
    const result = JSON.stringify(data);
    return {
      result: JSON.parse(result) as T
    };
  };
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

process.env['RUNNER_TOOL_CACHE'] = toolDir;
process.env['RUNNER_TEMP'] = tempDir;

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
  let httpmGetJson: jest.SpyInstance;
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

    httpmGetJson = jest.spyOn(httpm, 'HttpClient');
    httpmGetJson.mockImplementation(() => SpyHttpClient);

    spyExec = jest.spyOn(exec, 'exec');
    spyExec.mockImplementation(() => undefined);

    spySymlinkSync = jest.spyOn(fs, 'symlinkSync');
    spySymlinkSync.mockImplementation(() => undefined);

    spyExistsSync = jest.spyOn(fs, 'existsSync');
    spyExistsSync.mockImplementation(() => true);
  });

  afterEach(() => {
    jest.resetAllMocks();
    jest.clearAllMocks();
  });

  it(`installPyPy throws an error because release was not found`, () => {
    expect(installer.installPyPy('7.3.3', '3.6.17', 'x64')).toThrowError(
      `PyPy version 7.3.3 (3.6.17) with arch x64 not found`
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
    expect(finder.findPyPyVersion('pypy3.7-7.3.x', architecture)).toThrowError(
      `PyPy version 7.3.x (3.7) with arch ${architecture} not found`
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
