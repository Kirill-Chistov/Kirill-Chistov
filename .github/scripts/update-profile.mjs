import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const OWNER = process.env.PROFILE_OWNER || "Kirill-Chistov";
const README_PATH = process.env.PROFILE_README || "README.md";

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim()
    .replace(/[.!?]+$/, "");
}

function lowerFirst(value) {
  return value ? value[0].toLocaleLowerCase() + value.slice(1) : value;
}

export function isProjectRepository(repository, owner = OWNER) {
  const fullName = String(repository.full_name || "").toLowerCase();
  const name = String(repository.name || "");
  const description = cleanText(repository.description);

  if (String(repository.owner?.login || "").toLowerCase() !== owner.toLowerCase()) return false;
  if (fullName === `${owner}/${owner}`.toLowerCase()) return false;
  if (repository.private || repository.fork || repository.archived || repository.disabled) return false;
  if (!repository.pushed_at || Number(repository.size || 0) < 1) return false;
  if (description.length < 12) return false;
  if (/(-public|-downloads|-releases)$/i.test(name)) return false;
  if (/^(public )?(downloads?|release notes?)( for|$)/i.test(description)) return false;

  return true;
}

export function projectFromRepository(repository) {
  const homepage = String(repository.homepage || "").trim();
  const url = /^https?:\/\//i.test(homepage) ? homepage : repository.html_url;

  return {
    name: cleanText(repository.name),
    url,
    repositoryUrl: repository.html_url,
    description: cleanText(repository.description),
    createdAt: repository.created_at,
  };
}

function isAlreadyListed(readme, project) {
  const normalized = readme.toLowerCase();
  return normalized.includes(String(project.repositoryUrl).toLowerCase())
    || normalized.includes(`[${project.name.toLowerCase()}](`)
    || normalized.includes(`/${project.name.toLowerCase()})`)
    || normalized.includes(`/${project.name.toLowerCase()}|`);
}

function insertCurrentlyBuilding(readme, project) {
  const heading = "### Currently building";
  const headingIndex = readme.indexOf(heading);
  if (headingIndex < 0) throw new Error(`Missing README section: ${heading}`);

  const sectionStart = headingIndex + heading.length;
  const nextHeading = readme.indexOf("\n### ", sectionStart);
  const sectionEnd = nextHeading < 0 ? readme.length : nextHeading;
  const section = readme.slice(sectionStart, sectionEnd);
  const line = `- [${project.name}](${project.url}) — ${lowerFirst(project.description)}`;
  const placeholder = "- More apps, websites, and experiments are on the way";

  if (section.includes(placeholder)) {
    return readme.slice(0, sectionStart)
      + section.replace(placeholder, `${line}\n${placeholder}`)
      + readme.slice(sectionEnd);
  }

  return readme.slice(0, sectionEnd).replace(/\s*$/, "") + `\n${line}\n` + readme.slice(sectionEnd);
}

function insertProjectTableRow(readme, project) {
  const heading = "### Projects";
  const headingIndex = readme.indexOf(heading);
  if (headingIndex < 0) throw new Error(`Missing README section: ${heading}`);

  const sectionStart = headingIndex + heading.length;
  const nextHeading = readme.indexOf("\n### ", sectionStart);
  const sectionEnd = nextHeading < 0 ? readme.length : nextHeading;
  const section = readme.slice(sectionStart, sectionEnd);
  const tableRows = [...section.matchAll(/^\|.*\|$/gm)];
  if (tableRows.length < 2) throw new Error("Projects table is missing or malformed");

  const lastRow = tableRows.at(-1);
  const insertAt = sectionStart + lastRow.index + lastRow[0].length;
  const row = `\n| [${project.name}](${project.url}) | ${project.description} |`;
  return readme.slice(0, insertAt) + row + readme.slice(insertAt);
}

export function updateReadme(readme, projects) {
  let updated = readme;
  const added = [];

  for (const project of [...projects].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    if (isAlreadyListed(updated, project)) continue;
    updated = insertCurrentlyBuilding(updated, project);
    updated = insertProjectTableRow(updated, project);
    added.push(project);
  }

  return { readme: updated, added };
}

async function fetchOwnedRepositories(owner) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "profile-project-updater",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const response = await fetch(
    `https://api.github.com/users/${encodeURIComponent(owner)}/repos?type=owner&sort=created&direction=asc&per_page=100`,
    { headers },
  );
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function writeSummary(message) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`, "utf8");
  }
}

async function main() {
  const readme = await readFile(README_PATH, "utf8");
  const repositories = await fetchOwnedRepositories(OWNER);
  const projects = repositories
    .filter((repository) => isProjectRepository(repository, OWNER))
    .map(projectFromRepository);
  const result = updateReadme(readme, projects);

  if (result.added.length === 0) {
    const message = "No profile update needed: no unlisted qualifying public projects were found.";
    console.log(message);
    await writeSummary(`## Profile updater\n\n${message}`);
    return;
  }

  await writeFile(README_PATH, result.readme, "utf8");
  const names = result.added.map((project) => project.name).join(", ");
  console.log(`Added to profile README: ${names}`);
  await writeSummary(`## Profile updater\n\nAdded to README: ${names}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
