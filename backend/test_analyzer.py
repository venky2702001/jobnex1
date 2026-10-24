"""Unit tests for deterministic resume analysis: pytest -q."""
import pytest # type: ignore
from analyzer import analyze_resume, to_db_row


def test_matched_and_missing_are_disjoint_and_cover_jd_skills():
    result = analyze_resume(
        "Python and SQL developer with 3 years of experience",
        "Need Python, SQL, Docker and FastAPI with 2 years of experience",
    )
    assert set(result["matched_skills"]).isdisjoint(result["missing_skills"])
    assert set(result["matched_skills"]) | set(result["missing_skills"]) == {
        "python", "sql", "docker", "fastapi"
    }


def test_scoring_formula_and_rounding():
    result = analyze_resume(
        "Python developer with 1 year of experience",
        "Python, SQL and Docker. Requires 2 years of experience",
    )
    # 1/3 skill coverage, 1/2 experience fit, no required certs => 100 cert fit.
    expected = round(0.70 * (1 / 3 * 100) + 0.15 * 50 + 0.15 * 100, 2)
    assert result["match_score"] == expected


def test_suggestions_are_json_ready_objects_and_keep_schema_typo():
    result = analyze_resume("Python developer", "Python, Docker")
    assert isinstance(result["sugesstions"], list)
    assert all(isinstance(item, dict) for item in result["sugesstions"])
    assert all({"type", "skill", "text"} <= item.keys() for item in result["sugesstions"])
    assert "sugesstions" in to_db_row(result)


def test_no_detectable_jd_skills_score_zero_and_explains():
    result = analyze_resume("A motivated candidate", "A motivated candidate wanted")
    assert result["match_score"] == 0.0
    assert result["sugesstions"][0]["type"] == "improve_job_description"


@pytest.mark.parametrize(("resume", "jd"), [("", "Python"), ("Python", "  ")])
def test_empty_text_rejected(resume, jd):
    with pytest.raises(ValueError):
        analyze_resume(resume, jd)


def test_oversized_text_rejected():
    with pytest.raises(ValueError):
        analyze_resume("x" * 200001, "Python")


def test_alias_normalization():
    result = analyze_resume("Experienced in JS and K8s", "Need JavaScript and Kubernetes")
    assert result["matched_skills"] == ["javascript", "kubernetes"]
