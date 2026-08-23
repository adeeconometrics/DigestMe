import type { CaseDigest } from "../lib/caseDigestDocx";

/**
 * Representative data for checking every case-digest section in the renderer.
 * The parties, docket number, and events are invented for testing — no real
 * case is reproduced here.
 */
export const CASE_DIGEST_MOCK: CaseDigest = {
  case_title: "Villanueva v. Bayside Port Workers Cooperative",
  petitioner: "Ramon Villanueva, Jr.",
  respondent: "Bayside Port Workers Cooperative (BPWC)",
  topic_subtopic: "3. Cooperative Law — Membership Discipline and Due Process",
  subject: "LAW 115: Cooperative and Agrarian Law",
  ponente: "Agcaoili, J.",
  gr_no_date: "G.R. No. 269420 | March 12, 2024",
  full_text: "Link to Full Text",
  summary:
    "Villanueva, a member-employee of BPWC, was expelled by the cooperative's disciplinary committee after a snapped crane sling delayed a cargo unloading shift. The Court held the expulsion void for failure to comply with the notice-and-hearing requirements of the Cooperative Code, but allowed the cooperative to recommence discipline with proper process.",
  doctrine:
    "Membership in a cooperative is a property right. Expulsion is valid only after the member is given written notice of the charge and a reasonable opportunity to be heard, as required by Article 35 of the Cooperative Code; failure to observe these requirements renders the expulsion void.",
  provisions:
    "Art. 35, Cooperative Code of the Philippines (RA 9520)\nArticle 35. EXPULSION AND WITHDRAWAL OF MEMBERS. - A member may be expelled only for grounds provided by law or the bylaws, and only after prior written notice and a hearing.\n- Expulsion requires a deliberate act of the members or an authorized committee;\n- Written notice of the charge and a hearing must precede any expulsion;\n- The decision may be appealed to the general assembly or the mediation-arbitration system.",
  facts: {
    petition: [
      "Villanueva had been a crane operator and member of BPWC for eleven years.",
      "During a night shift, the crane's sling snapped while hoisting a container, delaying unloading by four hours.",
      "The disciplinary committee met two days later and expelled Villanueva without a written charge or a hearing.",
      "He learned of the expulsion from a notice pinned to the cooperative's bulletin board.",
    ],
    respondent_version: [
      "BPWC said the expulsion followed a documented incident report and that Villanueva had been warned about equipment care.",
      "It claimed the bulletin-board notice, together with a group briefing, satisfied its internal rules.",
    ],
    petitioner_version: [
      "Villanueva said he was never given a written charge and that the briefing was not a hearing.",
      "He lost his livelihood and was barred from applying for membership for two years.",
    ],
  },
  petitioners_arguments: [
    "Expulsion without a written charge and hearing violates Article 35 of the Cooperative Code.",
    "Membership carries a property right that cannot be taken away without due process.",
    "A bulletin-board notice does not give a member a reasonable opportunity to defend himself.",
  ],
  respondents_arguments: [
    "The Cooperative Code leaves the details of disciplinary procedure to the cooperative's bylaws.",
    "The committee's decision was an internal management matter that the courts and the CDA should respect.",
    "Villanueva's negligence was admitted in the incident report, so a hearing would have changed nothing.",
  ],
  procedural_posture: [
    "INITIAL ACTION (filed by Villanueva): Petition for reinstatement and damages before the CDA Mediation-Arbitration Unit.",
    "CDA MA RULING: Ruled for Villanueva and ordered reinstatement with backwages.",
    "CDA BOARD RULING: Reversed, sustaining the expulsion.",
    "CA RULING: Affirmed the CDA Board.",
    "PETITION to the SC: Petition for Review on Certiorari under Rule 45.",
  ],
  issues: [
    {
      issue: "WON Villanueva's expulsion from BPWC is void for failure to comply with the notice-and-hearing requirement.",
      ruling: "YES",
      ratio:
        "Article 35 of the Cooperative Code conditions expulsion on prior written notice and a genuine opportunity to be heard. The bulletin-board notice and the group briefing did not satisfy these requirements, so the expulsion was void.",
    },
    {
      issue: "WON the disciplinary committee's finding of negligence is valid despite the procedural defect.",
      ruling: "NO",
      ratio:
        "The finding was made without the petitioner's participation. A finding reached without a hearing cannot stand, although the cooperative may reopen discipline with proper process.",
    },
    {
      issue: "WON Villanueva is entitled to reinstatement and backwages.",
      ruling: "YES",
      ratio:
        "Because the expulsion was void, he remained a member in contemplation of law. Reinstatement and backwages follow from the void act, without prejudice to a validly conducted disciplinary proceeding.",
    },
    {
      issue: "WON the CDA Board correctly declined jurisdiction over the expulsion.",
      ruling: "NO",
      ratio:
        "The mediation-arbitration system has jurisdiction over disputes among members and between a member and the cooperative; the Board erred in treating the expulsion as a purely internal act beyond review.",
    },
  ],
  supreme_court_ruling:
    "The petition is GRANTED. The Court of Appeals decision is REVERSED and SET ASIDE, the CDA Board ruling is NULLIFIED, and the Mediation-Arbitration Unit's ruling is REINSTATED. BPWC is ordered to reinstate Villanueva and to pay backwages, without prejudice to a disciplinary proceeding conducted with proper notice and hearing.",
  class_notes: [
    "Membership in a cooperative is a property interest protected by due process; expulsion requires written notice and a hearing under Article 35, RA 9520.",
    "A void expulsion leaves the member in the cooperative in contemplation of law, so reinstatement and backwages follow as of course.",
  ],
};
