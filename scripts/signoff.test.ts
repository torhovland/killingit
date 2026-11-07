import { describe, expect, it } from "bun:test";
import type { Commit } from "./signoff";
import {
  OWNER_EMAILS,
  needsSignoff as needsSignoffCommit,
  parseGitLog,
  signedOffEmails,
  unsignedCommits,
} from "./signoff";

const OWNER = "55164+torhovland@users.noreply.github.com";

function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    hash: "a".repeat(40),
    authorEmail: "someone@example.com",
    parentCount: 1,
    message: "Change something\n",
    ...overrides,
  };
}

function needsSignoff(subject: Commit): boolean {
  return needsSignoffCommit(subject, OWNER_EMAILS);
}

describe("parseGitLog", () => {
  it("reads hash, author, parents, and body", () => {
    const output =
      "abc\u001fsomeone@example.com\u001fparent1 parent2\u001fSubject\u001e" +
      "def\u001fother@example.com\u001f\u001fRoot commit with no parent\u001e";
    expect(parseGitLog(output)).toEqual([
      {
        hash: "abc",
        authorEmail: "someone@example.com",
        parentCount: 2,
        message: "Subject",
      },
      {
        hash: "def",
        authorEmail: "other@example.com",
        parentCount: 0,
        message: "Root commit with no parent",
      },
    ]);
  });

  it("returns nothing for an empty range", () => {
    expect(parseGitLog("")).toEqual([]);
  });
});

describe("signedOffEmails", () => {
  it("reads every sign-off trailer, lowercased", () => {
    const message = [
      "Subject",
      "",
      "Body",
      "",
      "Signed-off-by: Someone <SomeOne@Example.com>",
      "Co-authored-by: Other <other@example.com>",
      "Signed-off-by: Second <second@example.com>",
    ].join("\n");
    expect(signedOffEmails(message)).toEqual([
      "someone@example.com",
      "second@example.com",
    ]);
  });

  it("ignores a sign-off that is not a trailer", () => {
    expect(
      signedOffEmails("Signed-off-by: Someone <a@b.c> in prose only"),
    ).toEqual([]);
  });
});

describe("needsSignoff", () => {
  it("requires a sign-off from a contributor", () => {
    expect(needsSignoff(commit())).toBe(true);
  });

  it("accepts a matching sign-off, ignoring email case", () => {
    expect(
      needsSignoff(
        commit({
          authorEmail: "Someone@Example.com",
          message: "Subject\n\nSigned-off-by: Someone <someone@example.com>",
        }),
      ),
    ).toBe(false);
  });

  it("does not accept a sign-off from another address", () => {
    expect(
      needsSignoff(
        commit({
          message: "Subject\n\nSigned-off-by: Other <other@example.com>",
        }),
      ),
    ).toBe(true);
  });

  it("exempts the copyright holder", () => {
    expect(needsSignoff(commit({ authorEmail: OWNER }))).toBe(false);
  });

  it("exempts merge commits", () => {
    expect(needsSignoff(commit({ parentCount: 2 }))).toBe(false);
  });

  it("applies an extra exemption from the environment", () => {
    expect(
      needsSignoffCommit(commit({ authorEmail: "bot@example.com" }), [
        ...OWNER_EMAILS,
        "bot@example.com",
      ]),
    ).toBe(false);
  });
});

describe("unsignedCommits", () => {
  it("keeps only the commits that still need a sign-off", () => {
    const unsigned = unsignedCommits(
      [
        commit({ hash: "1", authorEmail: OWNER }),
        commit({ hash: "2" }),
        commit({
          hash: "3",
          message: "Signed off\n\nSigned-off-by: S <someone@example.com>",
        }),
        commit({ hash: "4", parentCount: 2 }),
      ],
      OWNER_EMAILS,
    );
    expect(unsigned.map((entry) => entry.hash)).toEqual(["2"]);
  });
});
