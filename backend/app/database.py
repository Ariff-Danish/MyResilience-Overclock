import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

# Example TiDB URL: mysql+pymysql://<user>:<password>@<host>:<port>/<db_name>
# Fallback to local SQLite if TiDB is not configured yet.
DATABASE_URL = os.getenv("TIDB_DATABASE_URL", "sqlite:///./myresilience.db")

import ssl

# SQLite requires specific args for thread safety. TiDB requires SSL.
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
else:
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    connect_args = {"ssl": ssl_context}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
