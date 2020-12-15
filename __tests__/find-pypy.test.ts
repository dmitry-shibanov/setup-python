import {HttpClient} from '@actions/http-client';
import * as ifm from '@actions/http-client/interfaces';
import * as tc from '@actions/tool-cache';
import * as exec from '@actions/exec';

import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';

import * as finder from '../src/find-pypy';
import * as installer from '../src/install-pypy';
import {IPyPyManifestRelease, IS_WINDOWS} from '../src/utils';

const manifestData = require('./data/pypy.json');

let architecture: string;

if (IS_WINDOWS) {
  architecture = 'x86';
} else {
  architecture = 'x64';
}

const toolDir = path.join(__dirname, 'runner', 'tools');
const tempDir = path.join(__dirname, 'runner', 'temp');

describe('parsePyPyVersion', () => {
  it.each([
    ['pypy-3.6-7.3.3', {pythonVersion: '3.6', pypyVersion: '7.3.3'}],
    ['pypy-3.6-7.3.x', {pythonVersion: '3.6', pypyVersion: '7.3.x'}],
    ['pypy-3.6-7.x', {pythonVersion: '3.6', pypyVersion: '7.x'}],
    ['pypy-3.6', {pythonVersion: '3.6', pypyVersion: 'x'}],
    ['pypy-3.6-nightly', {pythonVersion: '3.6', pypyVersion: 'nightly'}],
    ['pypy-3.6-7.3.3rc1', {pythonVersion: '3.6', pypyVersion: '7.3.3-rc.1'}]
  ])('%s -> %s', (input, expected) => {
    expect(finder.parsePyPyVersion(input)).toEqual(expected);
  });

  it('throw on invalid input', () => {
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

  it('PyPy exists on the path and versions are satisfied', () => {
    expect(finder.findPyPyToolCache('3.6.17', '7.5.4', architecture)).toEqual({
      installDir: pypyPath,
      resolvedPythonVersion: actualPythonVersion,
      resolvedPyPyVersion: actualPyPyVersion
    });
  });

  it('PyPy exists on the path and versions are satisfied with semver', () => {
    expect(finder.findPyPyToolCache('3.6', '7.5.x', architecture)).toEqual({
      installDir: pypyPath,
      resolvedPythonVersion: actualPythonVersion,
      resolvedPyPyVersion: actualPyPyVersion
    });
  });

  it("PyPy exists on the path, but Python version doesn't match", () => {
    expect(finder.findPyPyToolCache('3.7', '7.5.4', architecture)).toEqual({
      installDir: '',
      resolvedPythonVersion: '',
      resolvedPyPyVersion: ''
    });
  });

  it("PyPy exists on the path, but PyPy version doesn't match", () => {
    expect(finder.findPyPyToolCache('3.6', '7.5.1', architecture)).toEqual({
      installDir: null,
      resolvedPythonVersion: '',
      resolvedPyPyVersion: ''
    });
  });
});

describe('findPyPyVersion', () => {
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
      path.join('PyPy', '3.6.12', IS_WINDOWS ? 'x86' : 'x64')
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

  it('found PyPy in toolcache', () => {
    expect(() => finder.findPyPyVersion('pypy3.6-7.3.x', architecture)).toEqual(
      {
        installDir: path.join(toolDir, 'PyPy', '3.6.12', architecture),
        resolvedPythonVersion: '3.6.12',
        resolvedPyPyVersion: '7.3.3'
      }
    );
  });

  it('found and install successfully', () => {
    expect(() => finder.findPyPyVersion('pypy3.7-7.3.x', architecture)).toEqual(
      {
        installDir: path.join(toolDir, 'PyPy', '3.7.7', architecture),
        resolvedPythonVersion: '3.7.7',
        resolvedPyPyVersion: '7.3.3'
      }
    );
  });

  it('throw if release is not found', () => {
    expect(() =>
      finder.findPyPyVersion('pypy3.7-7.3.x', architecture)
    ).toThrowError(
      `PyPy version 3.7 (7.3.x) with arch ${architecture} not found`
    );
  });

  it('throw on invalid input format', () => {
    expect(() =>
      finder.findPyPyVersion('pypy3.7-7.3.x', architecture)
    ).toThrowError(/Invalid comparator: */);
  });
});
