"""Resume/JD analysis service and FastAPI routes.

POST /api/analyzer/analyze
Request:
{
  "resume_text": "Python developer with 3 years of Python, SQL and FastAPI...",
  "jd_text": "Requires Python, SQL, Docker and 2 years experience",
  "region_filter": "INDIA"
}
Response (201): resume_analyzer fields; JSON fields are arrays, not encoded strings.
This file implements analysis only. Authentication/ownership and the remaining MVP-2
route groups require application-level integration and supporting models.
"""
import html
import json
import logging
import re
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status 
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

try:
    from database import ResumeAnalyzer, get_db_session, init_db
    from ai_analyzer import generate_interview_questions, suggest_courses
except ImportError:  # package import
    from .database import ResumeAnalyzer, get_db_session, init_db
    from .ai_analyzer import generate_interview_questions, suggest_courses

logger = logging.getLogger(__name__)
MAX_TEXT_LENGTH = 200_000
REGIONS = {"US", "GLOBAL", "INDIA", "BANGALORE"}

# Curated dictionary; aliases are canonicalized before matching.
SKILLS = [
    "machine learning", "deep learning", "data analysis", "data visualization",
    "natural language processing", "project management", "javascript", "typescript",
    "node.js", "react", "fastapi", "flask", "django", "python", "sql", "mysql",
    "postgresql", "mongodb", "html", "css", "docker", "kubernetes", "aws", "azure",
    "google cloud", "git", "github", "rest api", "linux", "excel", "power bi",
    "tableau", "pandas", "numpy", "scikit-learn", "java", "c++", "c#", "pytest",
    "selenium", "terraform", "redis", "communication", "agile", "scrum",
]
CERTIFICATIONS = [
    "aws certified solutions architect", "aws certified developer",
    "microsoft azure", "azure administrator associate", "google professional cloud architect",
    "pmp", "cissp", "comptia security+", "comptia a+", "cka", "ckad",
    "certified scrum master", "itil", "oracle certified", "salesforce certified",
]
ALIASES = {
    "js": "javascript", "node": "node.js", "k8s": "kubernetes",
    "ml": "machine learning", "nlp": "natural language processing",
    "restful api": "rest api", "amazon web services": "aws",
    "microsoft azure": "microsoft azure",
}


def normalize_text(value: str) -> str:
    """Remove HTML/control characters, normalize bullets/aliases and whitespace."""
    value = html.unescape(value)
    value = re.sub(r"(?is)<(script|style)\b.*?>.*?</\1>", " ", value)
    value = re.sub(r"(?s)<[^>]+>", " ", value)
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", value)
    value = value.replace("•", " ").replace("●", " ").replace("▪", " ")
    value = value.lower()
    for alias, canonical in sorted(ALIASES.items(), key=lambda x: -len(x[0])):
        value = re.sub(rf"(?<![a-z0-9+#]){re.escape(alias)}(?![a-z0-9+#])", canonical, value)
    return re.sub(r"\s+", " ", value).strip()


def _extract(text: str, vocabulary: list[str]) -> list[str]:
    found = []
    for skill in sorted(vocabulary, key=len, reverse=True):
        pattern = rf"(?<![a-z0-9+#]){re.escape(skill)}(?![a-z0-9+#])"
        if re.search(pattern, text, flags=re.I):
            found.append(skill)
    return sorted(set(found))


def _experience_years(text: str) -> int:
    """Estimate years from explicit experience statements and dated ranges."""
    patterns = [
        r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)",
        r"(?:experience|exp)\s*[:\-]?\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)",
    ]
    values = [int(m.group(1)) for p in patterns for m in re.finditer(p, text, re.I)]
    # Conservative date-range estimate for formats such as Jan 2020 - Mar 2024.
    month_year = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})"
    years = [int(y) for y in re.findall(month_year, text, re.I)]
    if len(years) >= 2:
        values.append(max(0, max(years) - min(years)))
    return min(max(values, default=0), 60)


def _required_experience(text: str) -> int:
    match = re.search(r"(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)", text, re.I)
    return int(match.group(1)) if match else 0


def _suggestions(missing: list[str], no_jd_skills: bool) -> list[dict[str, str]]:
    suggestions = []
    if no_jd_skills:
        suggestions.append({
            "type": "improve_job_description",
            "skill": "",
            "text": "Add a more detailed job description with specific skills and requirements.",
        })
    for skill in missing:
        suggestions.append({
            "type": "add_skill",
            "skill": skill,
            "text": f"Build a practical project demonstrating {skill} and include the evidence in your resume.",
        })
    return suggestions


def analyze_resume(resume_text: str, jd_text: str) -> dict[str, Any]:
    """Analyze resume against a JD. Raises ValueError for invalid or oversized text."""
    if not isinstance(resume_text, str) or not resume_text.strip():
        raise ValueError("resume_text is required and cannot be empty")
    if not isinstance(jd_text, str) or not jd_text.strip():
        raise ValueError("jd_text is required and cannot be empty")
    if len(resume_text) > MAX_TEXT_LENGTH or len(jd_text) > MAX_TEXT_LENGTH:
        raise ValueError(f"resume_text and jd_text must be at most {MAX_TEXT_LENGTH} characters")

    resume = normalize_text(resume_text)
    jd = normalize_text(jd_text)
    resume_skills = set(_extract(resume, SKILLS))
    jd_skills = set(_extract(jd, SKILLS))
    matched = sorted(resume_skills & jd_skills)
    missing = sorted(jd_skills - resume_skills)

    resume_certs = _extract(resume, CERTIFICATIONS)
    jd_certs = set(_extract(jd, CERTIFICATIONS))
    cert_held = sorted(set(resume_certs) & jd_certs)
    experience = _experience_years(resume)
    required_experience = _required_experience(jd)

    if not jd_skills:
        score = 0.0
    else:
        skill_coverage = len(matched) / len(jd_skills) * 100
        experience_fit = 100.0 if required_experience == 0 or experience >= required_experience else (
            experience / required_experience * 100
        )
        cert_fit = 100.0 if not jd_certs else len(cert_held) / len(jd_certs) * 100
        score = round(0.70 * skill_coverage + 0.15 * experience_fit + 0.15 * cert_fit, 2)

    suggestions = _suggestions(missing, not jd_skills)
    interview = generate_interview_questions(matched, missing, count=10)
    resources = suggest_courses(missing)
    return {
        "resume_text": resume_text.strip(),
        "jd_text": jd_text.strip(),
        "match_score": round(score, 2),
        "matched_skills": matched,
        "missing_skills": missing,
        "sugesstions": suggestions,
        "certifications": ", ".join(resume_certs),
        "experience_years": experience,
        "region_filter": None,
        "interview_prep": json.dumps(interview, ensure_ascii=False),
        "suggested_resources": json.dumps(resources, ensure_ascii=False),
        "dashboard_status": "saved",
        "auto_apply": False,
        "auto_refusal": False,
        "social_login": None,
        "privacy_setting": "private",
    }


def to_db_row(analysis: dict[str, Any]) -> dict[str, Any]:
    """Return only schema columns suitable for INSERT/ORM construction."""
    allowed = {
        "resume_text", "jd_text", "match_score", "matched_skills", "missing_skills",
        "sugesstions", "certifications", "experience_years", "region_filter",
        "interview_prep", "suggested_resources", "dashboard_status", "auto_apply",
        "auto_refusal", "social_login", "privacy_setting",
    }
    return {key: analysis[key] for key in allowed if key in analysis}


INSERT_SQL = """
INSERT INTO resume_analyzer
(resume_text, jd_text, match_score, matched_skills, missing_skills, sugesstions,
 certifications, experience_years, region_filter, interview_prep, suggested_resources,
 dashboard_status, auto_apply, auto_refusal, social_login, privacy_setting)
VALUES
(:resume_text, :jd_text, :match_score, :matched_skills, :missing_skills, :sugesstions,
 :certifications, :experience_years, :region_filter, :interview_prep, :suggested_resources,
 :dashboard_status, :auto_apply, :auto_refusal, :social_login, :privacy_setting)
"""


class AnalyzeRequest(BaseModel):
    """Validated HTTP request body."""
    model_config = ConfigDict(str_strip_whitespace=True)
    resume_text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    jd_text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    region_filter: str | None = None

    @field_validator("region_filter")
    @classmethod
    def validate_region(cls, value):
        if value is None or not value.strip():
            return None
        normalized = value.strip().upper()
        if normalized not in REGIONS:
            raise ValueError(f"region_filter must be one of {sorted(REGIONS)}")
        return normalized


router = APIRouter(prefix="/api/analyzer", tags=["analyzer"])


@router.post("/analyze", status_code=status.HTTP_201_CREATED)
def analyze_and_save(payload: AnalyzeRequest, request: Request, db: Session = Depends(get_db_session)):
    """Analyze and persist an analysis owned by the signed-in user. DB failures return a generic 500."""
    # main.py's SessionMiddleware puts the session in the ASGI scope; the standalone
    # `analyzer:app` has none, so read it defensively instead of request.session.
    user_id = (request.scope.get("session") or {}).get("user_id")
    try:
        result = analyze_resume(payload.resume_text, payload.jd_text)
        result["region_filter"] = payload.region_filter
        row = ResumeAnalyzer(**to_db_row(result), user_id=user_id)
        db.add(row)
        db.commit()
        db.refresh(row)
        result["analysis_id"] = row.analysis_id
        result["created_at"] = row.created_at.isoformat() if row.created_at else None
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail={"error": str(exc), "code": "INVALID_ANALYSIS_INPUT"})
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("Resume analysis persistence failed")
        raise HTTPException(status_code=500, detail={"error": "Could not save analysis", "code": "ANALYSIS_SAVE_FAILED"}) from exc


app = FastAPI(title="Jobnex MVP-2 Backend", version="2.0.0")


@app.on_event("startup")
def startup():
    """Initialize mapped schema when database credentials are configured."""
    try:
        init_db()
    except RuntimeError:
        logger.warning("Database not initialized at startup: configure DB_PASSWORD or DATABASE_URL")
    except Exception:
        logger.exception("Database startup initialization failed")


@app.get("/api/health")
def health():
    """Basic process health endpoint; does not expose secrets or database details."""
    return {"status": "ok", "service": "jobnex-backend"}


app.include_router(router)
