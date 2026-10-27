from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import os

app = Flask(__name__)
CORS(app)  # allow frontend to call backend (harmless when proxied by nginx)

# Read DB path from env (set in docker-compose.yml).
# Falls back to a local file when running outside Docker.
DB_PATH = os.environ.get(
    "DB_PATH",
    os.path.join(os.path.dirname(__file__), "database.db"),
)


def init_db():
    # Ensure the parent directory exists (e.g. /app/data inside the container)
    parent = os.path.dirname(DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS calculations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expression TEXT NOT NULL,
            result TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def safe_eval(expression: str) -> float:
    """
    Evaluate a math expression safely (no builtins, no attribute access).
    Supports +, -, *, /, %, **, parentheses, decimals.
    """
    allowed_chars = set("0123456789.+-*/()% ")
    if not set(expression).issubset(allowed_chars):
        raise ValueError("Invalid characters in expression")

    # Block dunder / attribute access tricks
    if "__" in expression:
        raise ValueError("Invalid expression")

    result = eval(expression, {"__builtins__": {}}, {})
    return result


@app.route("/api/calculate", methods=["POST"])
def calculate():
    data = request.get_json(silent=True) or {}
    expression = str(data.get("expression", "")).strip()

    if not expression:
        return jsonify({"error": "Expression is required"}), 400

    try:
        result = safe_eval(expression)
        # Normalize: drop trailing .0 for whole numbers
        if isinstance(result, float) and result.is_integer():
            result_str = str(int(result))
        else:
            result_str = str(result)
    except ZeroDivisionError:
        return jsonify({"error": "Division by zero"}), 400
    except Exception as e:
        return jsonify({"error": f"Invalid expression: {e}"}), 400

    # Save to DB
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO calculations (expression, result) VALUES (?, ?)",
        (expression, result_str),
    )
    conn.commit()
    calc_id = cur.lastrowid
    conn.close()

    return jsonify({
        "id": calc_id,
        "expression": expression,
        "result": result_str,
    })


@app.route("/api/history", methods=["GET"])
def history():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        SELECT id, expression, result, created_at
        FROM calculations
        ORDER BY id DESC
        LIMIT 20
    """)
    rows = cur.fetchall()
    conn.close()

    return jsonify([
        {"id": r[0], "expression": r[1], "result": r[2], "created_at": r[3]}
        for r in rows
    ])


@app.route("/api/history", methods=["DELETE"])
def clear_history():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("DELETE FROM calculations")
    conn.commit()
    conn.close()
    return jsonify({"status": "cleared"})


# ---------------------------------------------------------------------------
# IMPORTANT: call init_db() at import time, NOT inside `if __name__ == "__main__"`.
# Gunicorn imports this module (`app:app`), so the `__main__` block is skipped.
# init_db() is idempotent (CREATE TABLE IF NOT EXISTS), so it's safe on every start.
# ---------------------------------------------------------------------------
init_db()


if __name__ == "__main__":
    # Only used for local dev (`python app.py`). In Docker, gunicorn runs the app.
    app.run(debug=True, port=5000)