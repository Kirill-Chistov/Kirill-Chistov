import assert from "node:assert/strict";
import test from "node:test";

import {
  isProjectRepository,
  projectFromRepository,
  updateReadme,
} from "./update-profile.mjs";

const repository = {
  owner: { login: "Kirill-Chistov" },
  full_name: "Kirill-Chistov/NewThing",
  name: "NewThing",
  description: "A useful new internet experiment.",
  html_url: "https://github.com/Kirill-Chistov/NewThing",
  homepage: "https://newthing.example",
  created_at: "2026-08-07T10:00:00Z",
  pushed_at: "2026-08-07T11:00:00Z",
  size: 42,
  private: false,
  fork: false,
  archived: false,
  disabled: false,
};

const readme = `### Currently building

- [VibeMenu](https://github.com/Kirill-Chistov/VibeMenu) — an existing project
- More apps, websites, and experiments are on the way

### Projects

| Project | What it is |
| --- | --- |
| [VibeMenu](https://github.com/Kirill-Chistov/VibeMenu) | An existing project |

test
`;

test("accepts substantive owned public repositories", () => {
  assert.equal(isProjectRepository(repository), true);
});

test("rejects release-only repositories", () => {
  assert.equal(isProjectRepository({ ...repository, name: "NewThing-Public" }), false);
});

test("adds a new project to both README sections", () => {
  const project = projectFromRepository(repository);
  const result = updateReadme(readme, [project]);

  assert.deepEqual(result.added.map(({ name }) => name), ["NewThing"]);
  assert.match(result.readme, /\[NewThing\]\(https:\/\/newthing\.example\) — a useful new internet experiment/);
  assert.match(result.readme, /\| \[NewThing\]\(https:\/\/newthing\.example\) \| A useful new internet experiment \|/);
  assert.ok(result.readme.indexOf("NewThing") < result.readme.indexOf("More apps"));
  assert.ok(result.readme.indexOf("| [NewThing]") < result.readme.indexOf("test"));
});

test("does not add projects already linked in the README", () => {
  const project = projectFromRepository(repository);
  const once = updateReadme(readme, [project]);
  const twice = updateReadme(once.readme, [project]);

  assert.equal(twice.added.length, 0);
  assert.equal(twice.readme, once.readme);
});
