"""End-to-end API tests: register -> analyze -> track applications -> per-user isolation.

Needs a reachable MySQL database (DB_PASSWORD or DATABASE_URL in the environment/.env).
Use a SCRATCH database (e.g. DB_NAME=jobnex_test): these tests create users and rows.
Skipped automatically when the database is not configured/reachable.
"""
import uuid

import pytest

try:
    from fastapi.testclient import TestClient
    import database
    from sqlalchemy import text
    with database.get_engine().connect() as _c:
        _c.execute(text("SELECT 1"))
    DB_OK = True
except Exception:  # no credentials / server down
    DB_OK = False

pytestmark = pytest.mark.skipif(not DB_OK, reason="database not configured or unreachable")


@pytest.fixture(scope="module")
def app():
    import main
    with TestClient(main.app):  # runs startup: create tables, seed jobs
        yield main.app


def _signup(app):
    client = TestClient(app)
    email = f"{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/api/auth/register", json={"email": email, "password": "password123", "name": "T"})
    assert r.status_code in (200, 201), r.text
    return client


def test_api_requires_login_but_frontend_files_do_not(app):
    c = TestClient(app)
    assert c.get("/api/jobs").status_code == 401
    assert c.get("/api.js").status_code == 200          # regression: "/api.js" must not be treated as an API path
    assert c.get("/login.html").status_code == 200


def test_analyze_then_isolation(app):
    alice, bob = _signup(app), _signup(app)
    r = alice.post("/api/analyzer/analyze", json={
        "resume_text": "Python developer, 3 years. Python SQL FastAPI.",
        "jd_text": "Need Python SQL Docker FastAPI. 2 years experience."})
    assert r.status_code == 201
    body = r.json()
    assert body["match_score"] > 0 and "docker" in [s.lower() for s in body["missing_skills"]]
    assert alice.get("/api/applications").json()["total"] >= 1
    assert bob.get(f"/api/applications/{body['analysis_id']}").status_code == 404


def test_job_application_tracker_lifecycle(app):
    c = _signup(app)
    payload = {"company": "Acme", "job_title": "Backend Engineer"}
    created = c.post("/api/job-applications", json=payload)
    assert created.status_code == 201 and created.json()["status"] == "applied"
    assert c.post("/api/job-applications", json=payload).status_code == 409
    app_id = created.json()["id"]
    assert c.patch(f"/api/job-applications/{app_id}/status", json={"status": "interview"}).json()["status"] == "interview"
    assert c.patch(f"/api/job-applications/{app_id}/status", json={"status": "hired"}).status_code == 422
    other = _signup(app)
    assert other.patch(f"/api/job-applications/{app_id}/status", json={"status": "offer"}).status_code == 404
    assert other.delete(f"/api/job-applications/{app_id}").status_code == 404
    assert c.delete(f"/api/job-applications/{app_id}").status_code == 200
    assert c.get("/api/job-applications").json()["total"] == 0
