/**
 * The copyright holder certifies nothing to itself, so its own commits are
 * exempt. Anything else that wants to land needs a sign-off. Extend the list
 * with `DCO_EXEMPT_AUTHORS` (comma separated) when the owner commits from
 * another address.
 */
export const OWNER_EMAILS: readonly string[] = [
  "55164+torhovland@users.noreply.github.com",
];

/** Records are separated by RS and fields by US, so bodies cannot confuse it. */
export const GIT_LOG_FORMAT = "%H%x1f%ae%x1f%P%x1f%B%x1e";

export interface Commit {
  hash: string;
  authorEmail: string;
  parentCount: number;
  message: string;
}

/** Reads `GIT_LOG_FORMAT` output into commits. */
export function parseGitLog(output: string): Commit[] {
  return output
    .split("\u001e")
    .map((record) => record.trim())
    .filter((record) => record !== "")
    .map((record) => {
      const [hash = "", authorEmail = "", parents = "", message = ""] =
        record.split("\u001f");
      const parentList = parents.trim();
      return {
        hash,
        authorEmail,
        parentCount: parentList === "" ? 0 : parentList.split(/\s+/).length,
        message,
      };
    });
}

/** Emails named by `Signed-off-by:` trailers, lowercased. */
export function signedOffEmails(message: string): string[] {
  const pattern = /^signed-off-by:.*<([^>]+)>\s*$/gim;
  return [...message.matchAll(pattern)].map((match) =>
    (match[1] ?? "").trim().toLowerCase(),
  );
}

/**
 * Whether a commit still needs a sign-off. Merge commits are exempt because
 * they introduce no new contribution of their own, and the owner is exempt
 * because a certification to itself is meaningless.
 */
export function needsSignoff(
  commit: Commit,
  exemptEmails: readonly string[],
): boolean {
  if (commit.parentCount >= 2) {
    return false;
  }
  const author = commit.authorEmail.trim().toLowerCase();
  if (exemptEmails.some((email) => email.trim().toLowerCase() === author)) {
    return false;
  }
  return !signedOffEmails(commit.message).includes(author);
}

/** The commits that are missing their sign-off, in log order. */
export function unsignedCommits(
  commits: readonly Commit[],
  exemptEmails: readonly string[],
): Commit[] {
  return commits.filter((commit) => needsSignoff(commit, exemptEmails));
}
