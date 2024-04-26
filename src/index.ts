import * as fs from 'fs';
import * as core from '@actions/core';
import { Snapshot, submitSnapshot} from '@github/dependency-submission-toolkit';
import { SnapshotConfig, generateSnapshot } from './snapshot-generator';

import { Package } from '@github/dependency-submission-toolkit'; // Adjust this import if needed

//import { Octokit } from "@octokit/rest"; // REST API client to pull Dependabot Alerts
// TODO- Remove     "@octokit/rest": "^20.1.0", from package.json

import * as github from '@actions/github'
import type { Context } from '@actions/github/lib/context.js' // Adjust this import if needed...

// Imports for Maven Package Calls and semantic versioning
import axios from 'axios';
import * as xml2js from 'xml2js';
import * as semver from 'semver';

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
    let treeJson: { package_url: any; name: any; namespace: any; type: any; version: any; relationship: any; scope: any; parent: string | null; }[] = [];

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
          //tree += buildTree(snapshot, manifestName, pkg, 0);
          const result = buildTree(snapshot, manifestName, pkg, 0);
          if (result) {
            tree += result.tree;
            treeJson.push(...result.packageJson);
          }
        }
      }
    }
    core.debug(`Dependency Tree:`)
    core.debug(`${tree}`);

    core.debug(`Dependency Tree JSON:`)
    core.debug(JSON.stringify(treeJson, null, 2));

    // Process Dependabot Alerts
    const repo = github.context.repo;
    // Built in Actions token doesn't have ability to get Dependabot alerts
    // const githubToken = core.getInput('token') || (await core.getIDToken())

    // Get GITHUB_TOKEN from environment variable.  Otherwise pull actions token...
    const githubToken = process.env.GITHUB_TOKEN || core.getInput('token') || (await core.getIDToken())

    // TODO - Add some error handling to ensure token has necessary access?

    core.info(`Owner: ${repo.owner}, Repo: ${repo.repo}, Token: ${githubToken}`)
    const dependabotAlerts = await listDependabotAlerts(repo, githubToken)

    //console.log(dependabotAlerts)

    core.debug(`Dependabot Alerts:`)
    core.debug(`${JSON.stringify(dependabotAlerts, null, 2)}`);

    // Associate Dependabot Alerts with the dependency tree
    const treeJsonWithDependabot = associateAlerts(treeJson, dependabotAlerts || []);
    //core.info(`Tree with Dependabot Alerts:`)
    //core.info(`${JSON.stringify(treeJsonWithDependabot, null, 2)}`);

    // Identify direct dependency updates for remediate indirect dependencies
    const treeJsonWithIndirectUpdates = identifyIndirectUpdates(treeJsonWithDependabot);

    //core.info(`Tree with Dependabot Alerts and Children:`)
    //core.info(`${JSON.stringify(treeJsonWithDependabot, null, 2)}`);

    // Testing - Print out pull requests
    const pullRequests = await listPullRequests(repo, githubToken)
    //console.log(pullRequests)

    // Testing - print out issues
    const issues = await listIssues(repo, githubToken)
    //console.log(issues)

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
//function buildTree(snapshot: any, manifestName, pkg, indent: number): string {
function buildTree(snapshot: any, manifestName, pkg, indent: number, parent: string | null = null) {
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

  //let packageJsonArray = [];
  let packageJsonArray: { package_url: any; name: any; namespace: any; type: any; version: any; relationship: any; scope: any; parent: string | null; }[] = [];

  let packageJson = {
    package_url: pkg.depPackage.packageURL,
    name: pkg.depPackage.packageURL.name,
    namespace: pkg.depPackage.packageURL.namespace,
    type: pkg.depPackage.packageURL.type,
    version: pkg.depPackage.packageURL.version,
    relationship: pkg.relationship,
    scope: pkg.scope,
    parent: parent
  };

  //console.log(packageJson);

  packageJsonArray.push(packageJson);

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
    //tree += buildTree(snapshot, manifestName, snapshot.manifests[manifestName].resolved[myDep], indent + 2, pkg.depPackage.packageURL);
    const result = buildTree(snapshot, manifestName, snapshot.manifests[manifestName].resolved[myDep], indent + 2, pkg.depPackage.packageURL);
    if (result) {
      tree += result.tree;
      //packageJsonArray = packageJsonArray.concat(result.packageJson);
      //console.log("result: ", result.packageJson);
      packageJsonArray.push(...result.packageJson);
    }
  }
  //}
  //return tree;
  //return { tree, packageJson };
  return { tree, packageJson: packageJsonArray };
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

    //console.log(alerts);

    return alerts.data;
  } catch (error: any) {
    console.error(`Failed to fetch Dependabot alerts: ${error}`);
    console.error(`Failed to fetch Dependabot alerts: ${error.message}`);
    return null;
  }
}

function associateAlerts(dependencyTree: any[], alerts: any[]): any[] {
  const associatedPackages: any[] = [];

  for (const pkg of dependencyTree) {
    pkg.alerts = [];
    pkg.patched_version = '0.0.0'; // Initialize to a low version

    // TODO - Filter out closed / dismissed alerts
    for (const alert of alerts) {
      if (alert.dependency.package.name === `${pkg.package_url.namespace}:${pkg.package_url.name}`) {
        pkg.alerts.push(alert);

        // If the first_patched_version is higher than the current patched_version, update it
        if ( alert.security_vulnerability.first_patched_version ) {
          if (alert.security_vulnerability.first_patched_version.identifier) {
            if (semver.valid(alert.security_vulnerability.first_patched_version.identifier) && semver.valid(pkg.patched_version)) {
              if (semver.gt(alert.security_vulnerability.first_patched_version.identifier, pkg.patched_version)) {
                pkg.patched_version = alert.security_vulnerability.first_patched_version.identifier;
              }
            } else {
              // Fallback to numerical comparison
              let alertVersion = parseFloat(alert.security_vulnerability.first_patched_version.identifier);
              let pkgVersion = parseFloat(pkg.patched_version);
              if (!isNaN(alertVersion) && !isNaN(pkgVersion) && alertVersion > pkgVersion) {
                pkg.patched_version = alert.security_vulnerability.first_patched_version.identifier;
              }
            }
          } else {
            console.log('No identifier for first_patched_version: ', alert.security_vulnerability.first_patched_version)
          }
        } else {
          pkg.patched_version = 'none';
        }
      }
    }

    if (pkg.patched_version === '0.0.0') {
      delete pkg.patched_version;
    }
    associatedPackages.push(pkg);
  }

  return associatedPackages;
}

function identifyIndirectUpdates(dependencyTree: any[]): any[] {
  const childrenMap: { [key: string]: any[] } = {};

  // Map first level of children to their parents
  for (const pkg of dependencyTree) {
    if (pkg.parent === null) {
      const packageKey = `${pkg.type}:${pkg.namespace}:${pkg.name}:${pkg.version}`;
      if (!childrenMap[packageKey]) {
        childrenMap[packageKey] = [];
      }
    } else {
      const parentKey = `${pkg.parent.type}:${pkg.parent.namespace}:${pkg.parent.name}:${pkg.parent.version}`;
      if (!childrenMap[parentKey]) {
        childrenMap[parentKey] = [];
      }
      pkg.depth = 1;
      childrenMap[parentKey].push(pkg);
    }
  }

  // Interate through childrenMap to build the full tree (any depth of children)
  let hasChildren = true;
  let loopCount = 0;
  while (hasChildren) {
    hasChildren = false;
    loopCount++;

    console.log(`Loop count: ${loopCount}`);

    if (loopCount > 5) {
      console.log('Exceeded 5 iterations building dependency tree, exiting loop.');
      break;
    }

    for (const parentKey in childrenMap) {
      console.log(`Parent key: ${parentKey}`);

      // For each child of a parent, check if it has children
      for (const child of childrenMap[parentKey]) {
        const childKey = `${child.type}:${child.namespace}:${child.name}:${child.version}`;
        //console.log(`Child key: ${childKey}, Child depth: ${child.depth}`);

        if (childrenMap[childKey]) {
          // Check if each child already exists in childrenMap[parentKey]
          for (const child2 of childrenMap[childKey]) {
            const child2NoDepth = { ...child2 };
            delete child2NoDepth.depth;

            const childExists = childrenMap[parentKey].some((existingChild: any) => {
              const existingChildNoDepth = { ...existingChild };
              delete existingChildNoDepth.depth;

              return JSON.stringify(existingChildNoDepth) === JSON.stringify(child2NoDepth);
            });

            //const childExists = childrenMap[parentKey].some((existingChild: any) => {
            //  const existingChildKey = `${existingChild.type}:${existingChild.namespace}:${existingChild.name}:${existingChild.version}`;
            //  console.log(`Existing Child key: ${existingChildKey}, Child key: ${childKey}`);
            //  return existingChildKey === childKey;
            //});

            console.log(`Child exists: ${childExists}`);

            // If child does not exist in childrenMap[parentKey], add it
            if (!childExists) {
              childrenMap[parentKey].push({
                ...child2,
                depth: child2.depth + 1
              });
              hasChildren = true;
            }
          }
        }
      }
    }
  }

  console.log('childrenMap: ', childrenMap);

  // Add children to parent packages
  const result: any[] = [];

  for (const pkg of dependencyTree) {
    // If childrenMap[pkg] exists, add it as a child field
    const packageKey = `${pkg.type}:${pkg.namespace}:${pkg.name}:${pkg.version}`;
    if (childrenMap[packageKey]) {
      pkg.children = childrenMap[packageKey];
    }
    result.push(pkg);
  }

  return result;
}


//TODO - Update this to allow for a specific version?
// TODO - Update this to allow a different package manager
//TODO - Update this to get a specific version? Or just use the latest?
/* async function getLatestVersionMaven(packageNamespace: string, packageName: string, maxRetries = 3) {
  const url = `https://repo.maven.apache.org/maven2/${packageNamespace.replace(/\./g, '/')}/${packageName}/maven-metadata.xml`;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url);
      const result = await xml2js.parseStringPromise(response.data);
      const latestVersion = result.metadata.versioning[0].latest[0];

      return latestVersion;
    } catch (error) {
      console.error(`Attempt ${i + 1} failed to fetch Maven metadata: ${error}`);
      if (i < maxRetries - 1) {
        // Wait for 1 second before the next attempt
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        return null;
      }
    }
  }
}

async function getLatestMinorVersionMaven(packageNamespace: string, packageName: string, maxRetries = 3) {
  const url = `https://repo.maven.apache.org/maven2/${packageNamespace.replace(/\./g, '/')}/${packageName}/maven-metadata.xml`;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url);
      const result = await xml2js.parseStringPromise(response.data);
      const versions = result.metadata.versioning[0].versions[0].version;

      // Get the latest version
      const latestVersion = semver.maxSatisfying(versions, '*');

      // Filter out the versions that have the same major version as the latest version
      const sameMajorVersions = versions.filter(version => semver.major(version) === semver.major(latestVersion));

      // Get the latest minor version
      const latestMinorVersion = semver.maxSatisfying(sameMajorVersions, `${semver.major(latestVersion)}.*`);

      return latestMinorVersion;
    } catch (error) {
      console.error(`Attempt ${i + 1} failed to fetch Maven metadata: ${error}`);
      if (i < maxRetries - 1) {
        // Wait for 1 second before the next attempt
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        return null;
      }
    }
  }
}
*/
// TODO - Add a check if the new version also is vulnerable...


// Create a function to list pull requests
async function listPullRequests(repo: any, token: string) {
  const octokit = github.getOctokit(token);

  try {
    const pulls = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
      owner: repo.owner,
      repo: repo.repo,
      accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28'
    });

    //console.log(pulls);

    return pulls.data;
  } catch (error: any) {
    console.error(`Failed to fetch pull requests: ${error}`);
    console.error(`Failed to fetch pull requests: ${error.message}`);
    return null;
  }
}

// Create a function to list issues
async function listIssues(repo: any, token: string) {
  const octokit = github.getOctokit(token);

  try {
    const issues = await octokit.request('GET /repos/{owner}/{repo}/issues', {
      owner: repo.owner,
      repo: repo.repo,
      accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28'
    });

    //console.log(issues);

    return issues.data;
  } catch (error: any) {
    console.error(`Failed to fetch issues: ${error}`);
    console.error(`Failed to fetch issues: ${error.message}`);
    return null;
  }
}

// Create a function to raise a pull request
async function raisePullRequest(repo: any, token: string, title: string, body: string, head: string, base: string) {
  const octokit = github.getOctokit(token);

  try {
    const pr = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
      owner: repo.owner,
      repo: repo.repo,
      title: title,
      body: body,
      head: head,
      base: base,
      accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28'
    });

    //console.log(pr);

    return pr.data;
  } catch (error: any) {
    console.error(`Failed to raise pull request: ${error}`);
    console.error(`Failed to raise pull request: ${error.message}`);
    return null;
  }
}

// Create a function to raise an issue
async function raiseIssue(repo: any, token: string, title: string, body: string) {
  const octokit = github.getOctokit(token);

  try {
    const issue = await octokit.request('POST /repos/{owner}/{repo}/issues', {
      owner: repo.owner,
      repo: repo.repo,
      title: title,
      body: body,
      accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28'
    });

    //console.log(issue);

    return issue.data;
  } catch (error: any) {
    console.error(`Failed to raise issue: ${error}`);
    console.error(`Failed to raise issue: ${error.message}`);
    return null;
  }
}

run();