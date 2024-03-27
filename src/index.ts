import * as fs from 'fs';
import * as core from '@actions/core';
import {Snapshot, submitSnapshot} from '@github/dependency-submission-toolkit';
import { SnapshotConfig, generateSnapshot } from './snapshot-generator';

async function run() {
  let snapshot: Snapshot | undefined;

  try {
    const directory = core.getInput('directory', { required: true });
    const mavenConfig = {
      ignoreMavenWrapper: core.getBooleanInput('ignore-maven-wrapper'),
      settingsFile: core.getInput('settings-file'),
      mavenArgs: core.getInput('maven-args') || '',
    }
    const snapshotConfig: SnapshotConfig = {
      includeManifestFile: core.getBooleanInput('snapshot-include-file-name'),
      manifestFile: core.getInput('snapshot-dependency-file-name'),
      sha: core.getInput('snapshot-sha'),
      ref: core.getInput('snapshot-ref'),
    }

    snapshot = await generateSnapshot(directory, mavenConfig, snapshotConfig);
  } catch (err: any) {
    core.error(err);
    core.setFailed(`Failed to generate a dependency snapshot, check logs for more details, ${err}`);
  }

  if (snapshot) {
    // Write snapshot to a file
    fs.writeFileSync('dependencySnapshot.json', JSON.stringify(snapshot));

    // Write dependency tree as output
    let tree = '';
    for (const packageUrl in snapshot.manifests['bookstore-v3'].resolved) {
      const pkg = snapshot.manifests['bookstore-v3'].resolved[packageUrl];
      if (pkg.relationship === 'direct') {
        tree += buildTree(snapshot, packageUrl, 0);
      }
    }

    core.info(tree);

    await core.summary
    core.summary.addHeading(`Dependencies`);


    core.startGroup(`Dependency Snapshot`);
    core.info(snapshot.prettyJSON())
    core.endGroup();

    core.info(`Submitting Snapshot...`)
    await submitSnapshot(snapshot);
    core.info(`completed.`)
  }
}

// Note - this should be moved to a separate file
function buildTree(snapshot: any, packageUrl: string, indent: number): string {
  core.debug(`Building tree for ${packageUrl}`)
  const pkg = snapshot.manifests['bookstore-v3'].resolved[packageUrl];
  if (!pkg) {
    return '';
  }
  let tree = ' '.repeat(indent) + packageUrl + ' (' + pkg.package_url + ', ' + pkg.relationship + ', ' + pkg.scope + ')\n';
  if (Array.isArray(pkg.dependencies)) {
    for (const dependencyUrl of pkg.dependencies) {
      tree += buildTree(snapshot, dependencyUrl, indent + 2);
    }
  }
  return tree;
}


run();