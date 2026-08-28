"""Structured case-digest and commentary-digest output models shared with the renderers."""

from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .document import DocumentReference


def _normalize_missing_fields(
    value: Any,
    *,
    scalar_fields: tuple[str, ...] = (),
    list_fields: tuple[str, ...] = (),
    object_fields: tuple[str, ...] = (),
) -> Any:
    """Fill omitted or null sections without coercing malformed values."""
    if not isinstance(value, Mapping):
        return value

    normalized = dict(value)
    for field_name in scalar_fields:
        if normalized.get(field_name) is None:
            normalized[field_name] = ""
    for field_name in list_fields:
        if normalized.get(field_name) is None:
            normalized[field_name] = []
    for field_name in object_fields:
        if normalized.get(field_name) is None:
            normalized[field_name] = {}
    return normalized


class CaseDigestFacts(BaseModel):
    """Facts grouped according to the case-digest FACTS section.

    Every category is present in the serialized contract. An empty list means
    the source does not support that category.
    """

    model_config = ConfigDict(extra="ignore", strict=True)

    @model_validator(mode="before")
    @classmethod
    def normalize_missing_fields(cls, value: Any) -> Any:
        """Represent unsupported fact categories as empty lists."""
        return _normalize_missing_fields(
            value,
            list_fields=("petition", "petitioner_version", "respondent_version"),
        )

    petition: list[str] = Field(
        description=(
            "A chronological list explaining why the case was initiated and the material events "
            "leading to the petition. "
            "Each item should state one concrete fact grounded in the source document. "
            "Return an empty list if the source does not state petition facts."
        )
    )
    petitioner_version: list[str] = Field(
        description=(
            "The petitioner's account of disputed facts, if the source presents one. "
            "Use concise, separately stated factual points. "
            "Return an empty list if the source does not state this version."
        ),
    )
    respondent_version: list[str] = Field(
        description=(
            "The respondent's account of disputed facts, if the source presents one. "
            "Use concise, separately stated factual points. "
            "Return an empty list if the source does not state this version."
        ),
    )


class CaseDigestIssue(BaseModel):
    """One issue together with the Supreme Court's answer and reasoning.

    Every key is present in the serialized contract. An empty string means the
    source does not state that element separately.
    """

    model_config = ConfigDict(extra="ignore", strict=True)

    @model_validator(mode="before")
    @classmethod
    def normalize_missing_fields(cls, value: Any) -> Any:
        """Represent unsupported issue details as empty strings."""
        return _normalize_missing_fields(value, scalar_fields=("issue", "ruling", "ratio"))

    issue: str = Field(
        description=(
            "The legal question presented, preferably phrased as a focused issue or WON question. "
            "Return an empty string when the source does not identify the issue separately."
        ),
    )
    ruling: str = Field(
        description=(
            "The direct disposition of this issue, such as YES, NO, GRANTED, or DENIED. "
            "Keep the answer concise and faithful to the Court's holding. "
            "Return an empty string only when the source does not state a ruling."
        )
    )
    ratio: str = Field(
        description=(
            "The legal reasoning supporting the ruling on this issue. "
            "Explain the controlling rule and how the Court applied it to the material facts. "
            "Return an empty string only when the source does not state the reasoning."
        )
    )


class CaseDigest(BaseModel):
    """Complete structured output accepted by ``caseDigestDocx.ts``.

    Every section is present in the serialized contract. Empty strings and
    empty lists represent sections unsupported by the source and are rendered
    as ``Not stated`` downstream. Unknown model keys are ignored so they cannot
    reach the renderer.
    """

    model_config = ConfigDict(extra="ignore", strict=True)

    @model_validator(mode="before")
    @classmethod
    def normalize_missing_fields(cls, value: Any) -> Any:
        """Fill unsupported top-level sections without weakening type checks."""
        return _normalize_missing_fields(
            value,
            scalar_fields=(
                "case_title",
                "petitioner",
                "respondent",
                "topic_subtopic",
                "subject",
                "ponente",
                "gr_no_date",
                "full_text",
                "summary",
                "doctrine",
                "provisions",
                "supreme_court_ruling",
            ),
            list_fields=(
                "petitioners_arguments",
                "respondents_arguments",
                "procedural_posture",
                "issues",
                "class_notes",
            ),
            object_fields=("facts",),
        )

    case_title: str = Field(
        description=(
            "The complete official case title, including the parties and the v. separator. "
            "Use the title stated in the source document. "
            "Return an empty string if the source does not state the title."
        )
    )
    petitioner: str = Field(
        description=(
            "The person, entity, or group that brought the petition before the Supreme Court. "
            "Preserve the source's proper name and relevant designation. "
            "Return an empty string if the source does not identify the petitioner."
        )
    )
    respondent: str = Field(
        description=(
            "The person, entity, or group opposing the petition. "
            "Preserve the source's proper name and relevant designation. "
            "Return an empty string if the source does not identify the respondent."
        )
    )
    topic_subtopic: str = Field(
        description=(
            "The legal topic and narrower subtopic that classify the case. "
            "State the classification succinctly, using the source's terminology where available. "
            "Return an empty string if the source does not support a classification."
        )
    )
    subject: str = Field(
        description=(
            "The class, course, or subject area for which the digest is prepared. "
            "Use the source-provided subject or the most specific supported legal subject. "
            "Return an empty string if the source does not state a subject."
        )
    )
    ponente: str = Field(
        description=(
            "The name and designation of the Supreme Court justice who wrote the decision. "
            "Do not infer a ponente when the source does not identify one. "
            "Return an empty string when it is not stated."
        )
    )
    gr_no_date: str = Field(
        description=(
            "The case number and decision date, normally formatted as the G.R. number followed by "
            "a separator and date. "
            "Copy both details from the source document. "
            "Return an empty string if either detail is not stated."
        )
    )
    full_text: str = Field(
        description=(
            "A URL or user-facing reference to the complete decision text. "
            "Use a source-provided link when available rather than inventing one. "
            "Return an empty string if no reference is stated."
        )
    )
    summary: str = Field(
        description=(
            "A concise narrative summary of the material facts, procedural setting, issue, and outcome. "
            "It should let a reader understand the case without reading the full decision. "
            "Return an empty string if the source does not support a summary."
        )
    )
    doctrine: str = Field(
        description=(
            "The general legal rule or principle established or applied by the Court. "
            "State it as a reusable proposition, supported by the decision rather than by speculation. "
            "Return an empty string if no doctrine is stated."
        )
    )
    provisions: str = Field(
        description=(
            "The constitutional provisions, statutes, rules, regulations, or other legal authorities "
            "relevant to the ruling. "
            "Include article or section identifiers and brief text or explanation when the source supplies them. "
            "Return an empty string if no relevant provision is stated."
        )
    )
    facts: CaseDigestFacts = Field(
        description=(
            "The material factual narrative, including the petitioner's version and any opposing "
            "versions stated in the source. "
            "Organize it into concrete points suitable for the digest's FACTS section. "
            "Always return all three fact lists, using empty lists for unsupported categories."
        )
    )
    petitioners_arguments: list[str] = Field(
        description=(
            "The petitioner's principal legal and factual arguments. "
            "Each list item should express one distinct argument grounded in the petition or the decision. "
            "Return an empty list if the source does not state these arguments."
        )
    )
    respondents_arguments: list[str] = Field(
        description=(
            "The respondent's principal legal and factual arguments. "
            "Each list item should express one distinct argument grounded in the response or the decision. "
            "Return an empty list if the source does not state these arguments."
        )
    )
    procedural_posture: list[str] = Field(
        description=(
            "The material procedural steps and rulings from the initial action through the Supreme Court. "
            "List them in chronological order and identify the deciding body for each step. "
            "Return an empty list if the source does not establish the procedural sequence."
        )
    )
    issues: list[CaseDigestIssue] = Field(
        description=(
            "The significant legal issues resolved by the Supreme Court, each with its ruling and ratio. "
            "Include a separate item for each independently answered issue. "
            "Return an empty list when the source does not identify separate issues."
        )
    )
    supreme_court_ruling: str = Field(
        description=(
            "The Supreme Court's final disposition and operative orders. "
            "State whether the petition or appeal was granted or denied and identify the judgment or relief ordered. "
            "Return an empty string if the final disposition is not stated."
        )
    )
    class_notes: list[str] = Field(
        description=(
            "Short study notes highlighting the most useful takeaways from the case. "
            "Each item should be a distinct, source-grounded rule, connection, or exam-relevant observation. "
            "Return an empty list if no study notes are supported."
        )
    )


class ChatAnswer(BaseModel):
    """Markdown answer plus references collected from the document tools."""

    model_config = ConfigDict(extra="forbid", strict=True)

    markdown: str
    references: list[DocumentReference] = Field(default_factory=list)
    model: str
    elapsed_ms: int = Field(ge=0)
    started_at: int | None = Field(default=None, ge=0)
    ended_at: int | None = Field(default=None, ge=0)


class CaseDigestResult(BaseModel):
    """Structured digest output plus the source nodes used to produce it."""

    model_config = ConfigDict(extra="forbid", strict=True)

    digest: CaseDigest
    references: list[DocumentReference] = Field(default_factory=list)
    model: str
    elapsed_ms: int = Field(ge=0)


class CommentaryCase(BaseModel):
    """One case cited by the commentary with the proposition attributed to it.

    Every key is present in the serialized contract. An empty string means the
    source does not state that element separately.
    """

    model_config = ConfigDict(extra="ignore", strict=True)

    @model_validator(mode="before")
    @classmethod
    def normalize_missing_fields(cls, value: Any) -> Any:
        """Represent unsupported case details as empty strings."""
        return _normalize_missing_fields(
            value,
            scalar_fields=("case_name", "citation", "doctrine"),
        )

    case_name: str = Field(
        description=(
            "The name of the case as stated in the source, normally "
            "'Petitioner v. Respondent'. "
            "Preserve the source's spelling. "
            "Return an empty string if the source does not name the case."
        )
    )
    citation: str = Field(
        description=(
            "The docket number or reporter citation of the case, "
            "e.g. 'G.R. No. 123456, January 15, 2001'. "
            "Copy the citation from the source. "
            "Return an empty string if the source provides no citation."
        )
    )
    doctrine: str = Field(
        description=(
            "The proposition the author attributes to the case, stated as a reusable rule. "
            "Ground it in the chapter's discussion. "
            "Return an empty string if the author cites the case without stating what it "
            "stands for."
        )
    )


class CommentaryDigest(BaseModel):
    """Complete structured output for one chapter of a legal commentary.

    Every section is present in the serialized contract. Empty strings and
    empty lists represent sections unsupported by the source and are rendered
    as ``Not stated`` downstream. Unknown model keys are ignored so they cannot
    reach the renderer.
    """

    model_config = ConfigDict(extra="ignore", strict=True)

    @model_validator(mode="before")
    @classmethod
    def normalize_missing_fields(cls, value: Any) -> Any:
        """Fill unsupported top-level sections without weakening type checks."""
        return _normalize_missing_fields(
            value,
            scalar_fields=(
                "source_title",
                "chapter_title",
                "sections_covered",
                "subject",
                "summary",
                "rule",
            ),
            list_fields=(
                "elements",
                "exceptions",
                "definitions",
                "cases",
                "implementing_rules",
                "related_provisions",
            ),
        )

    source_title: str = Field(
        description=(
            "The complete title of the commentary or book, including author(s) and edition. "
            "Use the title stated in the source document. "
            "Return an empty string if the source does not state a title."
        )
    )
    chapter_title: str = Field(
        description=(
            "The chapter or topical cluster of the commentary that this digest covers, "
            "e.g. 'Board of Directors'. "
            "State it as the source presents it. "
            "Return an empty string if the source does not identify the covered chapter."
        )
    )
    sections_covered: str = Field(
        description=(
            "The statutory provisions commented on in the covered chapter, normally the "
            "section range and governing law, e.g. 'Secs. 21-40, RA No. 11232; former "
            "Secs. 21-39, BP 68'. "
            "Copy the identifiers from the source. "
            "Return an empty string if the chapter is not anchored to specific provisions."
        )
    )
    subject: str = Field(
        description=(
            "The legal subject or course area for which the digest is prepared, "
            "e.g. 'Corporation Law'. "
            "Use the source-provided subject or the most specific supported classification. "
            "Return an empty string if the source does not state a subject."
        )
    )
    summary: str = Field(
        description=(
            "A concise narrative of what the chapter's commentary covers, letting a reader "
            "grasp the material without reading the chapter. "
            "Summarize the author's analysis rather than quoting it. "
            "Return an empty string if the source does not support a summary."
        )
    )
    rule: str = Field(
        description=(
            "The operative legal rule or doctrine stated or derived by the author for the "
            "covered provisions. "
            "Phrase it as a reusable proposition supported by the chapter. "
            "Return an empty string if no rule is stated."
        )
    )
    elements: list[str] = Field(
        description=(
            "The constituent requirements that must be present for the rule to apply. "
            "Each item should express one distinct requirement grounded in the chapter. "
            "Return an empty list if the source does not break the rule into elements."
        )
    )
    exceptions: list[str] = Field(
        description=(
            "The circumstances under which the rule does not apply or is suspended. "
            "Each item should express one distinct exception grounded in the chapter. "
            "Return an empty list if the source states no exceptions."
        )
    )
    definitions: list[str] = Field(
        description=(
            "Statutory terms construed or defined by the author, each item pairing the term "
            "with its meaning, e.g. 'controlling stockholder'. "
            "Keep each item self-contained. "
            "Return an empty list if the source defines no terms."
        )
    )
    cases: list[CommentaryCase] = Field(
        description=(
            "The jurisprudence cited by the author in the covered chapter. "
            "Include a separate object for each distinct case with its case name, citation, "
            "and the proposition for which it is cited. "
            "Return an empty list when the source cites no cases."
        )
    )
    implementing_rules: list[str] = Field(
        description=(
            "SEC implementing rules, memorandum circulars, or opinions discussed in the "
            "chapter. "
            "Each item should identify the rule and the point the author makes about it. "
            "Return an empty list if the source cites none."
        )
    )
    related_provisions: list[str] = Field(
        description=(
            "Cross-references to other sections of the same statute or to other laws "
            "discussed in the chapter. "
            "Each item should identify the provision and its connection to the covered "
            "material. "
            "Return an empty list if the source states no cross-references."
        )
    )


class CommentaryDigestResult(BaseModel):
    """Structured commentary-digest output plus its source references."""

    model_config = ConfigDict(extra="forbid", strict=True)

    digest: CommentaryDigest
    references: list[DocumentReference] = Field(default_factory=list)
    model: str
    elapsed_ms: int = Field(ge=0)
