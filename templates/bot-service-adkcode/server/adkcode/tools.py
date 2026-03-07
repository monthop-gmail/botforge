"""Coding tools for adkcode agent."""

import base64
import mimetypes
import os
import subprocess
import urllib.parse
import urllib.request
import re

from .guardrails import check_command, check_file_access, audit_log


def read_file(path: str) -> dict:
    """Read the contents of a file at the given path.

    Args:
        path: The file path to read.

    Returns:
        dict with status and file content or error message.
    """
    access = check_file_access(path, write=False)
    if not access["allowed"]:
        audit_log("tools", "read_file", {"path": path}, "blocked")
        return {"status": "error", "error_message": access["reason"]}

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        audit_log("tools", "read_file", {"path": path}, "success")
        return {"status": "success", "content": content}
    except Exception as e:
        audit_log("tools", "read_file", {"path": path}, "error")
        return {"status": "error", "error_message": str(e)}


def write_file(path: str, content: str) -> dict:
    """Write content to a file. Creates parent directories if needed.

    Args:
        path: The file path to write to.
        content: The content to write.

    Returns:
        dict with status and result message.
    """
    access = check_file_access(path, write=True)
    if not access["allowed"]:
        audit_log("tools", "write_file", {"path": path}, "blocked")
        return {"status": "error", "error_message": access["reason"]}

    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        audit_log("tools", "write_file", {"path": path, "content": content}, "success")
        return {"status": "success", "message": f"Wrote {len(content)} bytes to {path}"}
    except Exception as e:
        audit_log("tools", "write_file", {"path": path}, "error")
        return {"status": "error", "error_message": str(e)}


def edit_file(path: str, old_string: str, new_string: str) -> dict:
    """Edit a file by replacing an exact string match. The old_string must appear exactly once in the file.

    Args:
        path: The file path to edit.
        old_string: The exact string to find and replace (must be unique in the file).
        new_string: The string to replace it with.

    Returns:
        dict with status and result message.
    """
    access = check_file_access(path, write=True)
    if not access["allowed"]:
        audit_log("tools", "edit_file", {"path": path}, "blocked")
        return {"status": "error", "error_message": access["reason"]}

    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        count = content.count(old_string)
        if count == 0:
            return {"status": "error", "error_message": f"old_string not found in {path}"}
        if count > 1:
            return {"status": "error", "error_message": f"old_string found {count} times in {path} (must be unique)"}

        new_content = content.replace(old_string, new_string, 1)
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
        audit_log("tools", "edit_file", {"path": path}, "success")
        return {"status": "success", "message": f"Edited {path}"}
    except Exception as e:
        audit_log("tools", "edit_file", {"path": path}, "error")
        return {"status": "error", "error_message": str(e)}


def list_files(path: str = ".") -> dict:
    """List files and directories at the given path.

    Args:
        path: The directory path to list (default: current directory).

    Returns:
        dict with status and list of entries.
    """
    try:
        entries = []
        for entry in sorted(os.listdir(path)):
            full = os.path.join(path, entry)
            suffix = "/" if os.path.isdir(full) else ""
            entries.append(entry + suffix)
        return {"status": "success", "entries": entries}
    except Exception as e:
        return {"status": "error", "error_message": str(e)}


def grep(pattern: str, path: str = ".", include: str = "") -> dict:
    """Search for a text pattern in files recursively. Case-insensitive.

    Args:
        pattern: The text pattern to search for.
        path: File or directory to search in (default: current directory).
        include: File extension filter, e.g. '.py' or '.ts' (optional).

    Returns:
        dict with status and matching lines.
    """
    try:
        results = []
        max_results = 50
        skip_dirs = {".git", "node_modules", "vendor", "__pycache__", ".venv", "venv"}

        for root, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if d not in skip_dirs]

            for fname in files:
                if include and not fname.endswith(include):
                    continue
                filepath = os.path.join(root, fname)
                try:
                    if os.path.getsize(filepath) > 1024 * 1024:
                        continue
                    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                        for i, line in enumerate(f, 1):
                            if pattern.lower() in line.lower():
                                results.append(f"{filepath}:{i}: {line.rstrip()}")
                                if len(results) >= max_results:
                                    break
                except (PermissionError, IsADirectoryError):
                    continue

                if len(results) >= max_results:
                    break
            if len(results) >= max_results:
                break

        if not results:
            return {"status": "success", "message": f"No matches found for '{pattern}'"}
        return {"status": "success", "matches": results}
    except Exception as e:
        return {"status": "error", "error_message": str(e)}


def shell(command: str) -> dict:
    """Execute a shell command and return the output.

    Args:
        command: The shell command to execute.

    Returns:
        dict with status, stdout, stderr, and return code.
    """
    # Safety check
    safety = check_command(command)
    if not safety["allowed"]:
        audit_log("tools", "shell", {"command": command}, "blocked")
        return {"status": "error", "error_message": safety["reason"]}

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        audit_log("tools", "shell", {"command": command}, "success")

        response = {
            "status": "success",
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
        }

        # Add safety warning if command is dangerous
        if safety["level"] == "warning":
            response["warning"] = safety["reason"]

        return response
    except subprocess.TimeoutExpired:
        audit_log("tools", "shell", {"command": command}, "timeout")
        return {"status": "error", "error_message": "Command timed out (120s)"}
    except Exception as e:
        audit_log("tools", "shell", {"command": command}, "error")
        return {"status": "error", "error_message": str(e)}


def web_fetch(url: str) -> dict:
    """Fetch content from a URL. Returns the response body as text.

    Args:
        url: The URL to fetch (must start with http:// or https://).

    Returns:
        dict with status, HTTP status code, and content.
    """
    if not url.startswith(("http://", "https://")):
        return {"status": "error", "error_message": "URL must start with http:// or https://"}

    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "adkcode/1.0",
            "Accept": "text/html,application/json,text/plain,*/*",
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read(100 * 1024).decode("utf-8", errors="replace")
            content_type = resp.headers.get("Content-Type", "")

            if "text/html" in content_type:
                body = re.sub(r"<[^>]+>", " ", body)
                body = re.sub(r"\s+", " ", body).strip()

            if len(body) > 10000:
                body = body[:10000] + "\n... (truncated)"

            return {"status": "success", "http_status": resp.status, "content": body}
    except Exception as e:
        return {"status": "error", "error_message": str(e)}


def web_search(query: str) -> dict:
    """Search the web using DuckDuckGo. Returns search results with titles, URLs, and snippets.

    Args:
        query: The search query.

    Returns:
        dict with status and search results.
    """
    try:
        search_url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
        req = urllib.request.Request(search_url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read(200 * 1024).decode("utf-8", errors="replace")

        results = []
        parts = html.split('class="result__a"')
        for part in parts[1:9]:
            # Extract URL
            href_match = re.search(r'href="([^"]+)"', part)
            if not href_match:
                continue
            link = href_match.group(1)
            if "uddg=" in link:
                uddg_match = re.search(r"uddg=([^&]+)", link)
                if uddg_match:
                    link = urllib.parse.unquote(uddg_match.group(1))

            # Extract title
            title_match = re.search(r">([^<]+)</a>", part)
            title = re.sub(r"<[^>]+>", "", title_match.group(1)) if title_match else ""

            # Extract snippet
            snippet = ""
            snippet_match = re.search(r'result__snippet[^>]*>([^<]+)', part)
            if snippet_match:
                snippet = re.sub(r"<[^>]+>", "", snippet_match.group(1))

            if title:
                results.append({"title": title.strip(), "url": link, "snippet": snippet.strip()})

        if not results:
            return {"status": "success", "message": "No results found"}
        return {"status": "success", "results": results}
    except Exception as e:
        return {"status": "error", "error_message": str(e)}


def read_image(path: str, question: str = "Describe this image in detail.") -> dict:
    """Read an image file and return it for visual analysis. Supports PNG, JPG, GIF, WebP.

    Use this tool to:
    - Analyze screenshots and mockups to write matching code
    - Read diagrams, flowcharts, or architecture images
    - Extract text from images (OCR)
    - Understand UI designs and implement them

    Args:
        path: The image file path to read.
        question: What to analyze about the image (default: describe the image).

    Returns:
        dict with status and image data for the model to analyze.
    """
    SUPPORTED = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
    MAX_SIZE = 20 * 1024 * 1024  # 20MB

    try:
        ext = os.path.splitext(path)[1].lower()
        if ext not in SUPPORTED:
            return {"status": "error", "error_message": f"Unsupported image format '{ext}'. Supported: {', '.join(sorted(SUPPORTED))}"}

        if not os.path.isfile(path):
            return {"status": "error", "error_message": f"File not found: {path}"}

        size = os.path.getsize(path)
        if size > MAX_SIZE:
            return {"status": "error", "error_message": f"Image too large ({size // 1024 // 1024}MB). Max: 20MB"}

        mime_type = mimetypes.guess_type(path)[0] or "image/png"

        with open(path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        return {
            "status": "success",
            "mime_type": mime_type,
            "image_base64": image_data,
            "size_bytes": size,
            "path": path,
            "question": question,
        }
    except Exception as e:
        return {"status": "error", "error_message": str(e)}


def index_codebase(path: str = ".") -> dict:
    """Scan and index source code files for semantic search using Gemini embeddings.

    This creates a searchable index of the codebase. Run this before using semantic_search.
    The index is saved to .adkcode_index.json and reused across sessions.

    Args:
        path: Root directory to index (default: current directory).

    Returns:
        dict with status, number of files indexed, and chunks created.
    """
    try:
        from .rag import get_index
        index = get_index()
        result = index.build(path)
        audit_log("tools", "index_codebase", {"path": path}, result["status"])
        return result
    except Exception as e:
        audit_log("tools", "index_codebase", {"path": path}, "error")
        return {"status": "error", "error_message": str(e)}


def semantic_search(query: str, top_k: int = 5) -> dict:
    """Search the codebase by meaning using Gemini embeddings. More powerful than grep — finds semantically related code even without exact keyword matches.

    Run index_codebase first to build the search index. Examples:
    - semantic_search("authentication logic") → finds login(), verify_token(), etc.
    - semantic_search("error handling") → finds try/except blocks, error classes
    - semantic_search("database connection") → finds DB setup code

    Args:
        query: Natural language description of what you're looking for.
        top_k: Number of results to return (default: 5).

    Returns:
        dict with status and matching code chunks with similarity scores.
    """
    try:
        from .rag import get_index
        index = get_index()

        if not index.chunks:
            return {
                "status": "error",
                "error_message": "No index found. Run index_codebase() first to build the search index.",
            }

        results = index.search(query, top_k=top_k)
        audit_log("tools", "semantic_search", {"query": query, "top_k": top_k}, "success")
        return {"status": "success", "results": results}
    except Exception as e:
        audit_log("tools", "semantic_search", {"query": query}, "error")
        return {"status": "error", "error_message": str(e)}
