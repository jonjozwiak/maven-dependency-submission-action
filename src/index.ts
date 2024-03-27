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
    // TODO - Remove hardcoded manifest name

    for (const packageUrl in snapshot.manifests['bookstore-v3'].resolved) {
      const pkg = snapshot.manifests['bookstore-v3'].resolved[packageUrl];
      core.debug(`Out of buildTree - ${packageUrl}`)
      core.debug(`Out Package - ${JSON.stringify(pkg, null, 2)}`)
      //core.debug(`Out Package URL - ${pkg.package_url}`)
      core.debug(`Out Relationiship - ${pkg.relationship}`)
      core.debug(`Out Scope - ${pkg.scope}`)
      //core.debug(`Out Dependencies - ${pkg.dependencies}`)
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
  core.debug(`Package in buildTree - ${JSON.stringify(pkg, null, 2)}`)
  console.log(`Package URL before check: ${pkg.package_url}`);
  console.log(pkg);
  console.log(pkg.package_url);

  console.log(`DepPackage Package URL before check: ${pkg.depPackage.packageURL}`);
  console.log(`DepPackge Dependencies before check: ${pkg.depPackage.dependencies}`);
  //core.debug(`Available packages: ${Object.keys(snapshot.manifests['bookstore-v3'].resolved)}`);
  if (!pkg) {
    core.debug(`Package not found ${packageUrl}`)
    return '';
  }
  if (!pkg.package_url) {
    core.debug(`Package URL not found ${packageUrl} - ${pkg.package_url}`)
    return '';
  }
  let tree = ' '.repeat(indent) + packageUrl + ' (' + pkg.depPackage.packageURL.name + ', ' + pkg.depPackage.packageURL.namespace + ', ' + pkg.depPackage.packageURL.type + ', ' + pkg.depPackage.packageURL.version + ', ' + pkg.relationship + ', ' + pkg.scope + ')\n';
  core.debug(`Dependencies ${pkg.dependencies}`)
  //if (Array.isArray(pkg.dependencies)) {
  for (const dependencyUrl of pkg.depPackage.dependencies) {
    console.log(dependencyUrl);
    tree += buildTree(snapshot, dependencyUrl, indent + 2);
  }
  //}
  return tree;
}


run();