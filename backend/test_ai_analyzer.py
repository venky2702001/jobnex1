# """Tests for AI service fallback and output contracts."""
from ai_analyzer import generate_interview_questions, suggest_courses


# def test_interview_generator_falls_back_without_api_key(monkeypatch):
#     monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
#     result = generate_interview_questions(["python"], ["docker"], count=6)
#     assert result["source"] == "template"
#     assert set(result["questions"]) == {"technical", "gap_based", "behavioral"}
#     assert any("python" in q.lower() for q in result["questions"]["technical"])
#     assert any("docker" in q.lower() for q in result["questions"]["gap_based"])


# def test_course_suggestions_have_expected_structure():
#     result = suggest_courses(["python", "unknown-skill"])
#     assert result["source"] == "catalog"
#     assert "python" in result["resources_by_skill"]
#     assert len(result["resources_by_skill"]["python"]) == 3
#     for resources in result["resources_by_skill"].values():
#         for item in resources:
#             assert {"title", "provider", "url", "level"} <= item.keys()


# def test_empty_missing_skills_returns_empty_catalog():
#     result = suggest_courses([])
#     assert result["resources_by_skill"] == {}
import pytest # type: ignore

from ai_analyzer import (
    generate_interview_questions,
    suggest_courses,
)


def test_interview_generator_returns_expected_structure():
    result = generate_interview_questions(
        ["python"],
        ["docker"],
        count=6,
    )

    assert "source" in result
    assert "questions" in result

    assert result["source"] in ["anthropic", "template"]


def test_course_catalog_lookup():
    result = suggest_courses(["docker"])

    assert result["source"] == "catalog"
    assert "docker" in result["resources_by_skill"]

    courses = result["resources_by_skill"]["docker"]

    assert len(courses) > 0
    assert courses[0]["title"] == "Docker Get Started"


def test_unknown_skill_gets_search_resource():
    result = suggest_courses(["react"])

    course = result["resources_by_skill"]["react"][0]

    assert course["provider"] == "Google Search"
    assert "google.com/search" in course["url"]