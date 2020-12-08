import * as core from '@actions/core';
import * as finder from './find-python';
import * as finderPyPy from './find-pypy';
import * as path from 'path';
import * as os from 'os';

async function run() {
  try {
    let version = core.getInput('python-version');
    const arch: string = core.getInput('architecture') || os.arch();
    if (version.includes('pypy-')) {
      const installed = await finderPyPy.findPyPyVersion(version, arch);
      core.info(
        `Successfully setup PyPy ${installed.pypy_version} with Python (${installed.python_version})`
      );
    } else if (version) {
      const installed = await finder.findPythonVersion(version, arch);
      core.info(`Successfully setup ${installed.impl} (${installed.version})`);
    }
    const matchersPath = path.join(__dirname, '..', '.github');
    core.info(`##[add-matcher]${path.join(matchersPath, 'python.json')}`);
  } catch (err) {
    core.setFailed(err.message);
  }
}

run();
