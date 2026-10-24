"""Database connectivity smoke test. Run: python test_db.py [--init]."""
import argparse
import logging
from sqlalchemy import text
from database import get_engine, init_db

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--init", action="store_true", help="Create mapped tables if absent")
    args = parser.parse_args()
    try:
        engine = get_engine()
        with engine.connect() as connection:
            value = connection.execute(text("SELECT 1")).scalar_one()
            assert value == 1
        logger.info("Database connectivity OK (SELECT 1).")
        if args.init:
            init_db()
            logger.info("SQLAlchemy mapped tables initialized.")
    except Exception:
        logger.exception("Database test failed")
        raise


if __name__ == "__main__":
    main()
