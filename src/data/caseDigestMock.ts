import type { CaseDigest } from "../lib/caseDigestDocx";

/** Representative data for checking every case-digest section in the renderer. */
export const CASE_DIGEST_MOCK: CaseDigest = {
  case_title: "Stradcom Corp. v. Orpilla",
  petitioner: "Stradcom Corp. and Jose A. Chua",
  respondent: "Joyce Annabelle L. Orpilla",
  topic_subtopic: "1. Toward a Re-Teaching of Labor Law",
  subject: "LAW 113: Labor I",
  ponente: "Tijam, J.",
  gr_no_date: "G.R. No. 206800 | July 2, 2018",
  full_text: "Link to Full Text",
  summary:
    "Orpilla was dismissed after Stradcom lost trust and confidence in her over the handling of a company event, alleged moonlighting, and use of company resources. The Court found a just cause for dismissal but awarded nominal damages because the employer did not comply with the twin-notice requirement.",
  doctrine:
    "An employer may terminate an employee for fraud or willful breach of the trust reposed in the employee under Article 297(c) of the Labor Code, provided the employee holds a position of trust and an act justifies the loss of confidence.",
  provisions:
    "Art. 297, Labor Code of the Philippines\nArticle 297. TERMINATION BY EMPLOYER. - An employer may terminate an employment for any of the following causes:\n- Serious misconduct or willful disobedience;\n- Gross and habitual neglect of duties;\n- Fraud or willful breach of trust;\n- Commission of a crime or offense against the employer; and\n- Other analogous causes.",
  facts: {
    petition: [
      "Orpilla was hired as Stradcom's Human Resources Administration Department Head, a managerial position.",
      "She was instructed to include affiliate employees in the company's Christmas party but attempted to exclude them.",
      "A later review found an inflated catering quote and evidence of moonlighting using company resources.",
      "After HRAD was reorganized, Orpilla filed a complaint for constructive dismissal.",
    ],
    respondent_version: [
      "Orpilla said she was open to a formal investigation and denied that she had resigned.",
      "She was refused entry to work and learned that her final pay had been deposited.",
    ],
    petitioner_version: [
      "Stradcom and Chua said Orpilla had offered to resign and requested leave to consider a settlement.",
      "They were surprised when she filed a constructive-dismissal complaint.",
    ],
  },
  petitioners_arguments: [
    "Orpilla was validly dismissed for just cause based on loss of trust and confidence.",
    "Her managerial role required a high degree of trust.",
    "The loss of trust was supported by disobedience, dishonesty, and unauthorized use of company assets.",
  ],
  respondents_arguments: [
    "The alleged dishonesty and overpricing were fabricated.",
    "Orpilla was constructively dismissed when her department was reorganized.",
    "She was denied procedural due process because no written notices were issued.",
  ],
  procedural_posture: [
    "INITIAL ACTION (filed by Orpilla): Complaint for constructive dismissal and monetary claims.",
    "LA RULING: Ruled for Orpilla and awarded separation pay, backwages, damages, and attorney's fees.",
    "NLRC RULING: Found a valid dismissal for loss of trust and confidence and modified the award.",
    "CA RULING: Reversed the NLRC and reinstated the Labor Arbiter's ruling.",
    "PETITION to the SC: Petition for Review on Certiorari under Rule 45.",
  ],
  issues: [
    {
      issue: "WON Orpilla was validly dismissed on the ground of loss of trust and confidence.",
      ruling: "YES",
      ratio:
        "Orpilla held a managerial position of trust. The evidence of dishonesty, mishandling of the event budget, moonlighting, and unauthorized use of company resources gave Stradcom a reasonable basis for its loss of confidence.",
    },
    {
      issue: "WON Orpilla's right to statutory procedural due process was violated.",
      ruling: "YES",
      ratio:
        "The employer did not provide the two written notices required before termination. Because the dismissal was otherwise valid, the Court awarded nominal damages rather than backwages.",
    },
    {
      issue: "WON Jose A. Chua may be held solidarily liable with Stradcom Corporation.",
      ruling: "NO",
      ratio:
        "There was no proof that Chua acted beyond his authority or with personal ill-will. His acts were official acts performed for Stradcom.",
    },
    {
      issue: "WON Orpilla is entitled to backwages, separation pay, damages, and attorney's fees.",
      ruling: "NO",
      ratio:
        "Backwages and separation pay require a finding of illegal dismissal. Those monetary claims therefore failed because the dismissal was for just cause.",
    },
  ],
  supreme_court_ruling:
    "The petition is GRANTED. The Court of Appeals decision is REVERSED and SET ASIDE, the NLRC decision is REINSTATED as modified, and Stradcom is ordered to pay Orpilla P30,000 in nominal damages.",
  class_notes: [
    "The two requirements for loss of trust and confidence are a position of trust and an act justifying the loss.",
    "A valid dismissal for just cause may still result in nominal damages when procedural due process is not observed.",
  ],
};
