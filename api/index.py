import sys
import os
from pathlib import Path

# bridge for Vercel
backend_path = Path(__file__).parent.parent / "backend"
sys.path.append(str(backend_path))

from main import app
