"""Standalone analyzer + MySQL round-trip test.

Run: python insert_test.py
Rollback-only: python insert_test.py --dry-run
Requires DB_PASSWORD (or DATABASE_URL) in the environment.
"""
import argparse
import json
import logging
from sqlalchemy import text

from analyzer import analyze_resume, to_db_row, INSERT_SQL
from database import get_engine

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SAMPLE_RESUME = """
Python developer with 3 years of experience. Skills: Python, SQL, FastAPI, Docker.
AWS Certified Solutions Architect.
"""
SAMPLE_JD = """
Seeking a Python developer with 2 years of experience, Python, SQL, FastAPI,
Docker, Kubernetes and AWS Certified Solutions Architect.
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Insert and verify, then roll back")
    args = parser.parse_args()
    engine = get_engine()
    result = analyze_resume(SAMPLE_RESUME, SAMPLE_JD)
    row = to_db_row(result)
    # JSON values are serialized explicitly for raw SQL compatibility with MySQL JSON.
    params = dict(row)
    for key in ("matched_skills", "missing_skills", "sugesstions"):
        params[key] = json.dumps(params[key], ensure_ascii=False)
    connection = engine.connect()
    transaction = connection.begin()
    try:
        insert_result = connection.execute(text(INSERT_SQL), params)
        analysis_id = insert_result.lastrowid
        saved = connection.execute(
            text("""SELECT analysis_id, match_score, matched_skills, missing_skills, sugesstions
                    FROM resume_analyzer WHERE analysis_id = :id"""),
            {"id": analysis_id},
        ).mappings().one()
        assert int(saved["analysis_id"]) == int(analysis_id)
        assert round(float(saved["match_score"]), 2) == result["match_score"]
        logger.info("Round-trip verified. analysis_id=%s match_score=%s", analysis_id, saved["match_score"])
        logger.info("Matched skills: %s", saved["matched_skills"])
        logger.info("Missing skills: %s", saved["missing_skills"])
        if args.dry_run:
            transaction.rollback()
            logger.info("Dry run complete; transaction rolled back.")
        else:
            transaction.commit()
            logger.info("Committed test record.")
    except Exception:
        transaction.rollback()
        logger.exception("Insert/round-trip test failed")
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    main()
