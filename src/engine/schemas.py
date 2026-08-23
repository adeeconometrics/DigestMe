"""Structured case-digest output models shared with the DOCX renderer."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .document import DocumentReference


class CaseDigestFacts(BaseModel):
    """Facts grouped according to the case-digest FACTS section."""

    model_config = ConfigDict(extra="forbid", strict=True)

    petition: list[str] = Field(
        description=(
            "A chronological list explaining why the case was initiated and the material events "
            "leading to the petition. "
            "Each item should state one concrete fact grounded in the source document."
        )
    )
    petitioner_version: list[str] | None = Field(
        default=None,
        description=(
            "The petitioner's account of disputed facts, if the source presents one. "
            "Use concise, separately stated factual points."
        ),
    )
    respondent_version: list[str] | None = Field(
        default=None,
        description=(
            "The respondent's account of disputed facts, if the source presents one. "
            "Use concise, separately stated factual points."
        ),
    )


class CaseDigestIssue(BaseModel):
    """One issue together with the Supreme Court's answer and reasoning."""

    model_config = ConfigDict(extra="forbid", strict=True)

    issue: str | None = Field(
        default=None,
        description=(
            "The legal question presented, preferably phrased as a focused issue or WON question. "
            "Omit it only when the source does not identify the issue separately."
        ),
    )
    ruling: str = Field(
        description=(
            "The direct disposition of this issue, such as YES, NO, GRANTED, or DENIED. "
            "Keep the answer concise and faithful to the Court's holding."
        )
    )
    ratio: str = Field(
        description=(
            "The legal reasoning supporting the ruling on this issue. "
            "Explain the controlling rule and how the Court applied it to the material facts."
        )
    )


class CaseDigest(BaseModel):
    """Complete structured output accepted by ``caseDigestDocx.ts``."""

    model_config = ConfigDict(extra="forbid", strict=True)

    case_title: str = Field(
        description=(
            "The complete official case title, including the parties and the v. separator. "
            "Use the title stated in the source document."
        )
    )
    petitioner: str = Field(
        description=(
            "The person, entity, or group that brought the petition before the Supreme Court. "
            "Preserve the source's proper name and relevant designation."
        )
    )
    respondent: str = Field(
        description=(
            "The person, entity, or group opposing the petition. "
            "Preserve the source's proper name and relevant designation."
        )
    )
    topic_subtopic: str = Field(
        description=(
            "The legal topic and narrower subtopic that classify the case. "
            "State the classification succinctly, using the source's terminology where available."
        )
    )
    subject: str = Field(
        description=(
            "The class, course, or subject area for which the digest is prepared. "
            "Use the source-provided subject or the most specific supported legal subject."
        )
    )
    ponente: str = Field(
        description=(
            "The name and designation of the Supreme Court justice who wrote the decision. "
            "Do not infer a ponente when the source does not identify one."
        )
    )
    gr_no_date: str = Field(
        description=(
            "The case number and decision date, normally formatted as the G.R. number followed by "
            "a separator and date. "
            "Copy both details from the source document."
        )
    )
    full_text: str = Field(
        description=(
            "A URL or user-facing reference to the complete decision text. "
            "Use a source-provided link when available rather than inventing one."
        )
    )
    summary: str = Field(
        description=(
            "A concise narrative summary of the material facts, procedural setting, issue, and outcome. "
            "It should let a reader understand the case without reading the full decision."
        )
    )
    doctrine: str = Field(
        description=(
            "The general legal rule or principle established or applied by the Court. "
            "State it as a reusable proposition, supported by the decision rather than by speculation."
        )
    )
    provisions: str = Field(
        description=(
            "The constitutional provisions, statutes, rules, regulations, or other legal authorities "
            "relevant to the ruling. "
            "Include article or section identifiers and brief text or explanation when the source supplies them."
        )
    )
    facts: CaseDigestFacts = Field(
        description=(
            "The material factual narrative, including the petitioner's version and any opposing "
            "versions stated in the source. "
            "Organize it into concrete points suitable for the digest's FACTS section."
        )
    )
    petitioners_arguments: list[str] = Field(
        description=(
            "The petitioner's principal legal and factual arguments. "
            "Each list item should express one distinct argument grounded in the petition or the decision."
        )
    )
    respondents_arguments: list[str] = Field(
        description=(
            "The respondent's principal legal and factual arguments. "
            "Each list item should express one distinct argument grounded in the response or the decision."
        )
    )
    procedural_posture: list[str] = Field(
        description=(
            "The material procedural steps and rulings from the initial action through the Supreme Court. "
            "List them in chronological order and identify the deciding body for each step."
        )
    )
    issues: list[CaseDigestIssue] = Field(
        description=(
            "The significant legal issues resolved by the Supreme Court, each with its ruling and ratio. "
            "Include a separate item for each independently answered issue."
        )
    )
    supreme_court_ruling: str = Field(
        description=(
            "The Supreme Court's final disposition and operative orders. "
            "State whether the petition or appeal was granted or denied and identify the judgment or relief ordered."
        )
    )
    class_notes: list[str] = Field(
        description=(
            "Short study notes highlighting the most useful takeaways from the case. "
            "Each item should be a distinct, source-grounded rule, connection, or exam-relevant observation."
        )
    )

    @field_validator("issues", mode="before")
    @classmethod
    def normalize_issue_pairs(cls, value: Any) -> Any:
        """Normalize the legacy ``[ruling, ratio]`` issue shape accepted by TypeScript."""
        if not isinstance(value, list):
            return value

        normalized: list[Any] = []
        for issue in value:
            if isinstance(issue, (list, tuple)) and len(issue) == 2:
                normalized.append({"ruling": issue[0], "ratio": issue[1]})
            else:
                normalized.append(issue)
        return normalized


class ChatAnswer(BaseModel):
    """Markdown answer plus references collected from the document tools."""

    model_config = ConfigDict(extra="forbid", strict=True)

    markdown: str
    references: list[DocumentReference] = Field(default_factory=list)
    model: str
    elapsed_ms: int = Field(ge=0)


class CaseDigestResult(BaseModel):
    """Structured digest output plus the source nodes used to produce it."""

    model_config = ConfigDict(extra="forbid", strict=True)

    digest: CaseDigest
    references: list[DocumentReference] = Field(default_factory=list)
    model: str
    elapsed_ms: int = Field(ge=0)
