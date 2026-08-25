import type { CaseDigest, CaseDigestIssue, CaseDigestIssueInput } from "./caseDigestDocx";

function text(value: string | undefined): string {
  return (value ?? "").trim() || "_Not stated._";
}

function list(items: string[] | undefined): string {
  const values = items ?? [];
  return values.length ? values.map((item) => `- ${text(item)}`).join("\n") : "_Not stated._";
}

function normalizeIssue(issue: CaseDigestIssueInput): CaseDigestIssue {
  if (Array.isArray(issue)) return { ruling: issue[0], ratio: issue[1] };
  return issue;
}

function fullText(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return `[Open the complete decision](${trimmed})`;
  return text(value);
}

/** Render the structured Python digest as predictable GitHub-flavored Markdown. */
export function caseDigestToMarkdown(caseDigest: CaseDigest): string {
  const issueList = caseDigest.issues ?? [];
  const issues = issueList.length
    ? issueList.map((input, index) => {
        const issue = normalizeIssue(input);
        return [
          `### Issue ${index + 1}`,
          issue.issue ? `**Issue:** ${text(issue.issue)}` : "",
          `**Ruling:** ${text(issue.ruling)}`,
          `**Ratio:** ${text(issue.ratio)}`,
        ].filter(Boolean).join("\n\n");
      }).join("\n\n")
    : "_No separate issues were identified._";

  const facts = caseDigest.facts;
  const petitionerVersion = facts?.petitioner_version === undefined
    ? ""
    : `\n\n### Petitioner's version\n\n${list(facts.petitioner_version)}`;
  const respondentVersion = facts?.respondent_version === undefined
    ? ""
    : `\n\n### Respondent's version\n\n${list(facts.respondent_version)}`;

  return [
    `# ${text(caseDigest.case_title)}`,
    `**Petitioner:** ${text(caseDigest.petitioner)}  \n**Respondent:** ${text(caseDigest.respondent)}  \n**Topic:** ${text(caseDigest.topic_subtopic)}  \n**Subject:** ${text(caseDigest.subject)}  \n**Ponente:** ${text(caseDigest.ponente)}  \n**G.R. No. / Date:** ${text(caseDigest.gr_no_date)}  \n**Full text:** ${fullText(caseDigest.full_text)}`,
    "## Summary",
    text(caseDigest.summary),
    "## Doctrine",
    text(caseDigest.doctrine),
    "## Provisions",
    text(caseDigest.provisions),
    "## Facts",
    `### Petition\n\n${list(facts?.petition)}${petitionerVersion}${respondentVersion}`,
    "## Petitioner's Arguments",
    list(caseDigest.petitioners_arguments),
    "## Respondent's Arguments",
    list(caseDigest.respondents_arguments),
    "## Procedural Posture",
    list(caseDigest.procedural_posture),
    "## Issues",
    issues,
    "## Supreme Court Ruling",
    text(caseDigest.supreme_court_ruling),
    "## Class Notes",
    list(caseDigest.class_notes),
  ].join("\n\n");
}
