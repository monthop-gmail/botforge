"""Safety guardrails for adkcode agent."""

import json
import logging
import os
import re
from datetime import datetime

logger = logging.getLogger(__name__)

# --- Dangerous Command Detection ---

# Commands that are always blocked (no bypass)
BLOCKED_COMMANDS = [
    r"\brm\s+-rf\s+/\s*$",          # rm -rf /
    r"\brm\s+-rf\s+/\*",            # rm -rf /*
    r"\brm\s+-rf\s+~\s*$",          # rm -rf ~
    r"\bmkfs\b",                     # format filesystem
    r"\bdd\s+.*of=/dev/",           # dd to device
    r":\(\)\s*\{\s*:\|:\s*&\s*\};:", # fork bomb
]

# Commands that require confirmation (warning level)
DANGEROUS_PATTERNS = [
    (r"\brm\s+(-[rRf]+\s+|--recursive)", "Recursive delete"),
    (r"\bgit\s+push\s+.*--force", "Force push"),
    (r"\bgit\s+reset\s+--hard", "Hard reset (loses uncommitted changes)"),
    (r"\bgit\s+clean\s+-[fdx]", "Remove untracked files"),
    (r"\bchmod\s+777\b", "World-writable permissions"),
    (r"\bchown\s+-R\b", "Recursive ownership change"),
    (r"\bcurl\s+.*\|\s*(sudo\s+)?bash", "Pipe URL to shell"),
    (r"\bwget\s+.*\|\s*(sudo\s+)?bash", "Pipe URL to shell"),
    (r"\bsudo\s+", "Running as root"),
    (r"\bDROP\s+(TABLE|DATABASE|SCHEMA)\b", "Drop database objects"),
    (r"\bTRUNCATE\s+TABLE\b", "Truncate table"),
    (r"\bDELETE\s+FROM\s+\S+\s*;?\s*$", "Delete all rows (no WHERE clause)"),
    (r"\bshutdown\b", "System shutdown"),
    (r"\breboot\b", "System reboot"),
    (r"\bkill\s+-9\b", "Force kill process"),
    (r"\bkillall\b", "Kill all processes by name"),
    (r"\bsystemctl\s+(stop|disable|mask)\b", "Stop/disable system service"),
    (r">\s*/etc/", "Overwrite system config"),
    (r"\bnpm\s+publish\b", "Publish to npm"),
    (r"\bpip\s+install\s+(?!-r\b).*--break-system", "Break system packages"),
]

# Compile patterns for performance
_blocked_compiled = [re.compile(p, re.IGNORECASE) for p in BLOCKED_COMMANDS]
_dangerous_compiled = [(re.compile(p, re.IGNORECASE), desc) for p, desc in DANGEROUS_PATTERNS]


def check_command(command: str) -> dict:
    """Check a shell command for safety issues.

    Returns:
        dict with:
        - allowed: bool
        - level: "safe" | "warning" | "blocked"
        - reason: str (if not safe)
    """
    # Check blocked commands first
    for pattern in _blocked_compiled:
        if pattern.search(command):
            return {
                "allowed": False,
                "level": "blocked",
                "reason": f"Command blocked for safety: matches destructive pattern",
            }

    # Check dangerous patterns
    warnings = []
    for pattern, desc in _dangerous_compiled:
        if pattern.search(command):
            warnings.append(desc)

    if warnings:
        return {
            "allowed": True,
            "level": "warning",
            "reason": f"Potentially dangerous: {', '.join(warnings)}",
        }

    return {"allowed": True, "level": "safe", "reason": ""}


# --- File Access Control ---

# Load allowed directories from env (comma-separated)
# If not set, all paths are allowed
_allowed_dirs_raw = os.environ.get("ADKCODE_ALLOWED_DIRS", "")
ALLOWED_DIRS = [d.strip() for d in _allowed_dirs_raw.split(",") if d.strip()] if _allowed_dirs_raw else []

# Always blocked paths
BLOCKED_PATHS = [
    "/etc/shadow",
    "/etc/passwd",
    "/etc/sudoers",
]


def check_file_access(path: str, write: bool = False) -> dict:
    """Check if file access is allowed.

    Args:
        path: The file path to check.
        write: Whether this is a write operation.

    Returns:
        dict with allowed (bool) and reason (str).
    """
    abs_path = os.path.abspath(path)

    # Always block sensitive system files
    for blocked in BLOCKED_PATHS:
        if abs_path == blocked or abs_path.startswith(blocked + "/"):
            return {"allowed": False, "reason": f"Access to {blocked} is blocked for security"}

    # Block .env files from being read (may contain secrets)
    basename = os.path.basename(abs_path)
    if basename == ".env" and not write:
        return {"allowed": False, "reason": "Reading .env files is blocked (may contain secrets)"}

    # Check allowed directories whitelist
    if ALLOWED_DIRS:
        allowed = False
        for allowed_dir in ALLOWED_DIRS:
            allowed_abs = os.path.abspath(allowed_dir)
            if abs_path.startswith(allowed_abs + "/") or abs_path == allowed_abs:
                allowed = True
                break
        if not allowed:
            return {
                "allowed": False,
                "reason": f"Path '{path}' is outside allowed directories: {', '.join(ALLOWED_DIRS)}",
            }

    return {"allowed": True, "reason": ""}


# --- Audit Log ---

_audit_log_path = os.environ.get("ADKCODE_AUDIT_LOG", "")


def audit_log(agent: str, tool: str, args: dict, result_status: str):
    """Log a tool call for auditing.

    Args:
        agent: Name of the agent that called the tool.
        tool: Name of the tool called.
        args: Arguments passed to the tool.
        result_status: "success" or "error".
    """
    if not _audit_log_path:
        return

    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "agent": agent,
        "tool": tool,
        "args": _sanitize_args(args),
        "result": result_status,
    }

    try:
        os.makedirs(os.path.dirname(_audit_log_path) or ".", exist_ok=True)
        with open(_audit_log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        logger.warning(f"Audit log failed: {e}")


def _sanitize_args(args: dict) -> dict:
    """Remove sensitive data from args before logging."""
    sanitized = {}
    for key, value in args.items():
        if key in ("content", "image_base64") and isinstance(value, str) and len(value) > 200:
            sanitized[key] = f"<{len(value)} chars>"
        elif "password" in key.lower() or "token" in key.lower() or "secret" in key.lower():
            sanitized[key] = "<redacted>"
        else:
            sanitized[key] = value
    return sanitized
