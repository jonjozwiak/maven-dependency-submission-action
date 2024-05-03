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

    // Add children to their parents for easier processing
    const treeJsonWithChildren = mapChildrenToParents(treeJsonWithDependabot);

    //core.info(`Tree with Dependabot Alerts and Children:`)
    //core.info(`${JSON.stringify(treeJsonWithChildren, null, 2)}`);

    // Identify update plan for direct dependencies and their children
    const updatePlan = await identifyUpdatePlan(treeJsonWithChildren);
    //core.info(`Update Plan:`)
    //core.info(`${JSON.stringify(updatePlan, null, 2)}`);

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

function mapChildrenToParents(dependencyTree: any[]): any[] {
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

    //console.log(`Loop count: ${loopCount}`);

    if (loopCount > 10) {
      console.log('Exceeded 10 iterations building dependency tree, exiting loop.');
      break;
    }

    for (const parentKey in childrenMap) {
      //console.log(`Parent key: ${parentKey}`);

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

            //console.log(`Child exists: ${childExists}`);

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

  //console.log('childrenMap: ', childrenMap);

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

async function identifyUpdatePlan(dependencyTree: any[]): Promise<any[]> {
  const plan: any[] = [];

  for (const pkg of dependencyTree) {
    const alerts: any[] = [];

    // If it is a direct dependency we can address alerts on it
    if (pkg.relationship === 'direct') {

      // If the package has alerts, add to the alerts array
      if (pkg.alerts.length > 0) {
        alerts.push({
          ...pkg,
          depth: 0
        });
      }

      // Check if the package has children with alerts
      for (const child of pkg.children) {
        if (child.alerts.length > 0) {
          // If the child has alerts, add to the alerts array
          alerts.push(child);
              // Check if the parent package is already in the alerts array
              const parentInAlerts = alerts.some(alert => alert.name === pkg.name);

              // If the parent package is not in the alerts array, add it
              if (!parentInAlerts) {
                alerts.push(pkg);
              }
        }
      }

      // If there are alerts, we need to build update plan for the direct dependency
      if (alerts.length > 0) {
        // Sort alerts by depth in descending order
        alerts.sort((a, b) => b.depth - a.depth);

        // print each alerts namespace, name, version, and depth
        for (const alert of alerts) {
          console.log(`Alert: ${alert.namespace}:${alert.name}:${alert.version} at depth ${alert.depth}`);
        }

        // Group alerts by depth
        const alertsByDepth = alerts.reduce((groups, alert) => {
          if (!groups[alert.depth]) {
            groups[alert.depth] = [];
          }
          groups[alert.depth].push(alert);
          return groups;
        }, {});

        // Get the depths in descending order
        const depths = Object.keys(alertsByDepth).sort((a, b) => Number(b) - Number(a));

        // Iterate over each depth
        for (const depth of depths) {
          const alertsAtDepth = alertsByDepth[depth];

          //core.info(`Processing alerts at depth ${depth}: ${JSON.stringify(alertsAtDepth)}`);
          core.info(`Processing alerts at depth ${depth}`);

          // Iterate over each alert at this depth
          for (const alert of alertsAtDepth) {
            // If the alert is the package itself, we can update the package
            console.info(`Processing package: ${alert.namespace}:${alert.name}:${alert.version}`);
            if (alert.depth === 0) {
              // TODO - Step 2 - Have this compare the child_patched_version (if it exists) to patched_version (and use the newer of the two)
              console.info(`  - Depth 0 update: ${pkg.namespace}:${pkg.name}:${pkg.version}` + (pkg.patched_version ? ` -- To Version: ${pkg.patched_version}` : ''));
            } else {
              // If the alert is a child, we need to identify the update for the parent first
              // Eventually this gets to the direct dependency we can actually update taking into account
              // version needs for the transitive dependencies
              console.info(`  - Child to update: ${alert.namespace}:${alert.name}:${alert.version} -- To Version: ${alert.patched_version}`);
              console.info(`  - Parent to update: ${alert.parent.namespace}:${alert.parent.name}:${alert.parent.version}` + (alert.parent.patched_version ? ` -- To Version: ${alert.parent.patched_version}` : ''));
              console.info(`  - Direct Dependency to update: ${pkg.namespace}:${pkg.name}:${pkg.version}` + (pkg.patched_version ? ` -- To Version: ${pkg.patched_version}` : ''));

              // We have now found the child and it's immediate parent as well as direct dependency we can update
              // Next, we need to reach out to maven to find which alert.parent.version includes our alert.patched_version
              // Once we idenify that we should compare alert.parent.patched_version to the version we found
              // We should set child_patched_version on the parent to the version we found
              // If there is not a patched version we should identify this by setting pkg.unpatched_child[] = alert

              // TODO - Write this function as mentioned above...
              //getMavenParentUpdate(alert);
              const parentDependencies = await getDependenciesForMavenPackage(alert.parent.namespace, alert.parent.name, alert.parent.version);
              console.log('Parent dependencies: ', parentDependencies);

              // Find the dependency that matches the child
              if (parentDependencies) {
                const childDependency = parentDependencies.find(dep => dep.groupId === alert.namespace && dep.artifactId === alert.name);
                console.log('Child dependency: ', childDependency);
              }
            }
          }
        }

        // Capture alerts to results
        plan.push(alerts);
      }
    }
  }

  console.log('Alert Update plan: ', plan);
  return plan;
}

// TODO - Update url to be able to pull from local maven repository as defined in pom.xml for the project
// TODO - Add retries and expontential backoff
// TODO - Add error handling
async function getParentDependencyVersions(groupId: string, artifactId: string, version: string) {
  const url = `https://repo.maven.apache.org/maven2/${groupId.replace(/\./g, '/')}/${artifactId}/${version}/${artifactId}-${version}.pom`;

  try {
    const response = await axios.get(url);
    const result = await xml2js.parseStringPromise(response.data);

    // Extract properties from the POM file
    const properties = result.project.properties ? result.project.properties[0] : {};

    let parentDependencyVersions = {};
    if (result.project.parent) {
      const parentGroupId = result.project.parent[0].groupId[0];
      const parentArtifactId = result.project.parent[0].artifactId[0];
      const parentVersion = result.project.parent[0].version[0];

      // Recursively get dependency versions from the parent POM
      parentDependencyVersions = await getParentDependencyVersions(parentGroupId, parentArtifactId, parentVersion);
    }

    // Extract the dependency versions from the <dependencyManagement> section
    if (result.project.dependencyManagement) {
      for (const dep of result.project.dependencyManagement[0].dependencies[0].dependency) {
        const key = `${dep.groupId[0]}:${dep.artifactId[0]}`;
        let version = dep.version[0];

        // Replace version variable with actual value from properties
        const versionVariableMatch = version.match(/\$\{(.+)\}/);
        if (versionVariableMatch) {
          const versionVariable = versionVariableMatch[1];
          if (properties[versionVariable]) {
            version = properties[versionVariable][0];
          }
        }

        parentDependencyVersions[key] = version;
      }
    }

    return parentDependencyVersions;
  } catch (error) {
    console.error(`Failed to fetch Maven POM file: ${error}`);
    return {};
  }
}

async function getDependenciesForMavenPackage(packageNamespace: string, packageName: string, version: string) {
  const url = `https://repo.maven.apache.org/maven2/${packageNamespace.replace(/\./g, '/')}/${packageName}/${version}/${packageName}-${version}.pom`;

  try {
    const response = await axios.get(url);
    const result = await xml2js.parseStringPromise(response.data);

    let parentDependencyVersions = {};
    let parentVersion = null;
    if (result.project.parent) {
      const parentGroupId = result.project.parent[0].groupId[0];
      const parentArtifactId = result.project.parent[0].artifactId[0];
      parentVersion = result.project.parent[0].version[0];

      // Get dependency versions from the parent POM
      if (parentVersion) {
        parentDependencyVersions = await getParentDependencyVersions(parentGroupId, parentArtifactId, parentVersion);
      }
    }

    // Extract the dependencies
    const dependencies = result.project.dependencies[0].dependency.map((dep: any) => {
      const key = `${dep.groupId[0]}:${dep.artifactId[0]}`;
      const version = dep.version ? (dep.version[0] === '${project.version}' ? parentVersion : dep.version[0]) : parentDependencyVersions[key];
      return {
        groupId: dep.groupId[0],
        artifactId: dep.artifactId[0],
        version: version,
      };
    });

    return dependencies;
  } catch (error) {
    console.error(`Failed to fetch Maven POM file: ${error}`);
    return null;
  }
}
/*
async function getDependenciesForMavenPackage(packageNamespace: string, packageName: string, version: string) {
  const url = `https://repo.maven.apache.org/maven2/${packageNamespace.replace(/\./g, '/')}/${packageName}/${version}/${packageName}-${version}.pom`;

  try {
    const response = await axios.get(url);
    console.log('Maven POM response: ', response);

    const result = await xml2js.parseStringPromise(response.data);
    console.log('Maven POM result: ', JSON.stringify(result, null, 2));

    const parentVersion = result.project.parent[0].version[0];

    // Extract the dependencies

    const dependencies = result.project.dependencies[0].dependency.map((dep: any) => ({
      groupId: dep.groupId[0],
      artifactId: dep.artifactId[0],
      version: dep.version ? (dep.version[0] === '${project.version}' ? parentVersion : dep.version[0]) : null,  // Some dependencies might not have a version
    }));

    console.log('Dependencies: ', dependencies);

    return dependencies;
  } catch (error) {
    console.error(`Failed to fetch Maven POM file: ${error}`);
    return null;
  }
}

*/



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