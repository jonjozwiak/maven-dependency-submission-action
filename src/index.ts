import * as fs from 'fs';
import * as core from '@actions/core';
import { Snapshot, submitSnapshot} from '@github/dependency-submission-toolkit';
import { SnapshotConfig, generateSnapshot } from './snapshot-generator';

import { Package } from '@github/dependency-submission-toolkit'; // Adjust this import if needed

//import { Octokit } from "@octokit/rest"; // REST API client to pull Dependabot Alerts
import * as github from '@actions/github'
import type { Context } from '@actions/github/lib/context.js'

type DependencyRelationship = 'direct' | 'indirect';
type DependencyScope = 'runtime' | 'development';

/*
class Dependency {
  depPackage: Package;
  relationship?: DependencyRelationship;
  scope?: DependencyScope;

  constructor(
    depPackage: Package,
    relationship?: DependencyRelationship,
    scope?: DependencyScope
  ) {
    this.depPackage = depPackage;
    this.relationship = relationship;
    this.scope = scope;
  }

  toJSON(): object {
    return {
      package_url: this.depPackage.packageURL.toString(),
      relationship: this.relationship,
      scope: this.scope,
      dependencies: this.depPackage.packageDependencyIDs
    };
  }
}
*/

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

    for (const manifestName in snapshot.manifests) {
      for (const packageUrl in snapshot.manifests[manifestName].resolved) {
        const pkg = snapshot.manifests[manifestName].resolved[packageUrl];
        //core.debug(`Out of buildTree - ${packageUrl}`)
        //core.debug(`Out Package - ${JSON.stringify(pkg, null, 2)}`)
        //core.debug(`Out Package URL - ${pkg.package_url}`)
        //core.debug(`Out Relationiship - ${pkg.relationship}`)
        //core.debug(`Out Scope - ${pkg.scope}`)
        //core.debug(`Out Dependencies - ${pkg.dependencies}`)
        //for (const dependencyUrl of pkg.depPackage.dependencies) {
        //  console.log(dependencyUrl);
        //  core.debug(`Dependency URL - ${dependencyUrl}`)
        //  core.debug(`Dependency URL stringify - ${JSON.stringify(dependencyUrl, null, 2)}`)
        //  core.debug(`Dependency PackageURL - ${dependencyUrl.packageURL}`)
        //  core.debug(`Dependency PackageURL stringify - ${JSON.stringify(dependencyUrl.packageURL, null, 2)}`)
        //  core.debug(`Dep Qualifiers - ${dependencyUrl.packageURL.qualifiers}`)
        //  core.debug(`Dep Qualifiers stringify - ${JSON.stringify(dependencyUrl.packageURL.qualifiers, null, 2)}`)
        //  //core.debug(`Dep Qualifiers type - ${dependencyUrl.packageURL.qualifiers.type}`)
        //  //core.debug(`Dep Qualifiers type stringify - ${JSON.stringify(dependencyUrl.qualifiers.type, null, 2)}`)
        //}


        if (pkg.relationship === 'direct') {
          //tree += buildTree(snapshot, packageUrl, 0);
          tree += buildTree(snapshot, manifestName, pkg, 0);
        }
      }
    }
    core.info(`Dependency Tree:`)
    core.info(`${tree}`);

    // Process Dependabot Alerts
    const repo = github.context.repo;
    // Built in Actions token doesn't have ability to get Dependabot alerts
    // const githubToken = core.getInput('token') || (await core.getIDToken())

    // Get GITHUB_TOKEN from environment variable.  Otherwise pull actions token...
    const githubToken = process.env.GITHUB_TOKEN || core.getInput('token') || (await core.getIDToken())

    // TODO - Add some error handling to ensure token has necessary access?

    core.info(`Owner: ${repo.owner}, Repo: ${repo.repo}, Token: ${githubToken}`)
    const dependabotAlerts = listDependabotAlerts(repo, githubToken)

    core.info(`Dependabot Alerts:`)
    core.info(`${JSON.stringify(dependabotAlerts, null, 2)}`);

    //await core.summary
    core.summary.addHeading(`Dependencies`);
    //core.summary.addTable([
    //  [{data: 'Package URL', header: true}, {data: 'Name', header: true},  {data: 'Namespace', header: true}, {data: 'Type', header: true}, {data: 'Version', header: true}, {data: 'Relationship', header: true}, {data: 'Scope', header: true}],
    //  ...tree.replace(/ /g, '\u00A0').split('\n').map(row => row.split(',').map(cell => ({data: cell})))
    //])
    core.summary.addTable([
      [{data: 'Package URL', header: true}, {data: 'Name', header: true},  {data: 'Namespace', header: true}, {data: 'Type', header: true}, {data: 'Version', header: true}, {data: 'Relationship', header: true}, {data: 'Scope', header: true}],
      ...tree.replace(/ /g, '\u00A0').split('\n').filter(row => row.trim() !== '').map(row => {
        const cells = row.split(',');
        return cells.map(cell => ({data: cell}));
      })
    ])
    core.summary.write()


    core.startGroup(`Dependency Snapshot`);
    core.info(snapshot.prettyJSON())
    core.endGroup();

    core.info(`Submitting Snapshot...`)
    await submitSnapshot(snapshot);
    core.info(`completed.`)
  }
}

// Note - this should be moved to a separate file
function buildTree(snapshot: any, manifestName, pkg, indent: number): string {
  //console.log(pkg);
  //core.debug(`Building tree for ${pkg.depPackage.packageURL}`)
  //const pkg = snapshot.manifests[manifestName].resolved[packageUrl];
  //core.debug(`Package in buildTree - ${JSON.stringify(pkg, null, 2)}`)
  //console.log(`Package URL before check: ${pkg.package_url}`);

  //console.log(pkg.package_url);

  //console.log(`DepPackage Package URL before check: ${pkg.depPackage.packageURL}`);
  //console.log(`DepPackge Dependencies before check: ${pkg.depPackage.dependencies}`);
  //core.debug(`Available packages: ${Object.keys(snapshot.manifests[manifestName].resolved)}`);
  if (!pkg) {
    core.debug(`Package not found ${pkg}`)
    return '';
  }
  //console.log(pkg);
  core.debug(`Building tree for ${pkg.depPackage.packageURL}`)
  //if (!pkg.package_url) {
  //  core.debug(`Package URL not found ${packageUrl} - ${pkg.package_url}`)
  //  return '';
  //}
  let tree = ' '.repeat(indent) + pkg.depPackage.packageURL + ', ' + pkg.depPackage.packageURL.name + ', ' + pkg.depPackage.packageURL.namespace + ', ' + pkg.depPackage.packageURL.type + ', ' + pkg.depPackage.packageURL.version + ', ' + pkg.relationship + ', ' + pkg.scope + '\n';
  //core.debug(`Dependencies ${pkg.dependencies}`)
  //core.debug(pkg)
  //core.debug(`Dependencies ${JSON.stringify(pkg.depPackage.dependencies, null, 2)}`)
  //if (Array.isArray(pkg.dependencies)) {
  //for (const dependencyUrl of pkg.depPackage) {
  //  core.debug(`pkg.depPackage - ${dependencyUrl}`)
  //  core.debug(`pkg.depPackage stringify - ${JSON.stringify(dependencyUrl, null, 2)}`)
  //  core.debug(`pkg.depPackage.packageURL - ${dependencyUrl.packageURL}`)
  //  core.debug(`pkg.depPackage.packageURL stringify - ${JSON.stringify(dependencyUrl.packageURL, null, 2)}`)
  //}
  for (const dependencyUrl of pkg.depPackage.dependencies) {
    //console.log(dependencyUrl);
    //core.debug(`Dependency URL - ${dependencyUrl}`)
    //core.debug(`Dependency URL stringify - ${JSON.stringify(dependencyUrl, null, 2)}`)
    //core.debug(`Dependency PackageURL - ${dependencyUrl.packageURL}`)
    //core.debug(`Dependency PackageURL tostring - ${dependencyUrl.packageURL.toString()}`)
    //core.debug(`Dependency PackageURL stringify - ${JSON.stringify(dependencyUrl.packageURL, null, 2)}`)
    //core.debug(`Dep Qualifiers - ${dependencyUrl.packageURL.qualifiers}`)
    //core.debug(`Dep Qualifiers stringify - ${JSON.stringify(dependencyUrl.packageURL.qualifiers, null, 2)}`)
    //core.debug(`Dep Qualifiers type - ${dependencyUrl.packageURL.qualifiers.type}`)
    //core.debug(`Dep Qualifiers type stringify - ${JSON.stringify(dependencyUrl.packageURL.qualifiers.type, null, 2)}`)
    const myDep = `pkg:${dependencyUrl.packageURL.type}/${dependencyUrl.packageURL.namespace}/${dependencyUrl.packageURL.name}@${dependencyUrl.packageURL.version}?type=${dependencyUrl.packageURL.qualifiers.type}`
    //core.debug(`My Dep - ${myDep}`)

    //core.debug(`Calling buildtree for dependency ${dependencyUrl.packageURL}`)
    core.debug(`Calling buildtree for dependency ${myDep}`)
    //core.debug(`Note pkg - ${JSON.stringify(pkg)} and dependencyUrl - ${JSON.stringify(dependencyUrl)}`)
    //tree += buildTree(snapshot, dependencyUrl.packageURL, indent + 2);
    tree += buildTree(snapshot, manifestName, snapshot.manifests[manifestName].resolved[myDep], indent + 2);
  }
  //}
  return tree;
}

// TODO - Obviously dependabot alerts are not going to exist before the snapshot is submitted
// I need to split this into a separate action if this is going to be useful... just testing...

// Note - A default token can't access Dependabot Alerts API for the repo.
// https://github.com/orgs/community/discussions/60612
async function listDependabotAlerts(repo: any, token: string) {
  //const octokit = new Octokit({ auth: token });
  const octokit = github.getOctokit(token);

  try {
    const alerts = await octokit.request('GET /repos/{owner}/{repo}/dependabot/alerts', {
      owner: repo.owner,
      repo: repo.repo,
      accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28'
    });

    console.log(alerts);
    
    return alerts.data;
  } catch (error: any) {
    console.error(`Failed to fetch Dependabot alerts: ${error}`);
    console.error(`Failed to fetch Dependabot alerts: ${error.message}`);
    return null;
  }
}

run();