"""RAG (Retrieval-Augmented Generation) for semantic code search."""

import json
import logging
import math
import os

logger = logging.getLogger(__name__)

# Embedding config
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMS = 768
INDEX_FILE = ".adkcode_index.json"

# File scanning config
SKIP_DIRS = {".git", "node_modules", "vendor", "__pycache__", ".venv", "venv", ".tox", "dist", "build"}
CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".java", ".c", ".cpp", ".h",
    ".rb", ".php", ".swift", ".kt", ".scala", ".sh", ".bash", ".zsh",
    ".html", ".css", ".scss", ".vue", ".svelte",
    ".sql", ".graphql", ".proto",
    ".yaml", ".yml", ".toml", ".json", ".xml",
    ".md", ".txt", ".rst",
    ".dockerfile", ".tf", ".hcl",
}
MAX_FILE_SIZE = 100 * 1024  # 100KB
CHUNK_LINES = 80  # lines per chunk


def _get_client():
    """Get Google GenAI client."""
    try:
        from google import genai
        api_key = os.environ.get("GOOGLE_API_KEY", "")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY not set")
        return genai.Client(api_key=api_key)
    except ImportError:
        raise ImportError("google-genai not installed. Run: pip install google-genai")


def _cosine_similarity(a: list, b: list) -> float:
    """Compute cosine similarity between two vectors using pure math."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _chunk_file(filepath: str, content: str) -> list[dict]:
    """Split file content into chunks with metadata."""
    lines = content.split("\n")
    chunks = []

    if len(lines) <= CHUNK_LINES:
        # Small file — single chunk
        chunks.append({
            "file": filepath,
            "start_line": 1,
            "end_line": len(lines),
            "text": content,
        })
    else:
        # Split into overlapping chunks
        overlap = 10
        i = 0
        while i < len(lines):
            end = min(i + CHUNK_LINES, len(lines))
            chunk_text = "\n".join(lines[i:end])
            chunks.append({
                "file": filepath,
                "start_line": i + 1,
                "end_line": end,
                "text": chunk_text,
            })
            i += CHUNK_LINES - overlap

    return chunks


def _scan_files(root: str) -> list[dict]:
    """Scan directory for source code files and return chunks."""
    all_chunks = []

    for dirpath, dirnames, filenames in os.walk(root):
        # Skip ignored directories
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]

        for fname in sorted(filenames):
            ext = os.path.splitext(fname)[1].lower()
            # Include files with known extensions or common config files
            if ext not in CODE_EXTENSIONS and fname not in {"Makefile", "Dockerfile", "Vagrantfile", ".gitignore"}:
                continue

            filepath = os.path.join(dirpath, fname)
            rel_path = os.path.relpath(filepath, root)

            try:
                if os.path.getsize(filepath) > MAX_FILE_SIZE:
                    continue
                with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                if not content.strip():
                    continue

                chunks = _chunk_file(rel_path, content)
                all_chunks.extend(chunks)
            except (PermissionError, IsADirectoryError, OSError):
                continue

    return all_chunks


def _generate_embeddings(client, texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a batch of texts."""
    from google.genai import types

    embeddings = []
    # Process in batches of 20 (API limit)
    batch_size = 20
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        result = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=batch,
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_DOCUMENT",
                output_dimensionality=EMBEDDING_DIMS,
            ),
        )
        for emb in result.embeddings:
            embeddings.append(list(emb.values))
    return embeddings


def _generate_query_embedding(client, query: str) -> list[float]:
    """Generate embedding for a search query."""
    from google.genai import types

    result = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=query,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_QUERY",
            output_dimensionality=EMBEDDING_DIMS,
        ),
    )
    return list(result.embeddings[0].values)


class CodebaseIndex:
    """In-memory vector store for code chunks with JSON persistence."""

    def __init__(self):
        self.chunks: list[dict] = []  # [{file, start_line, end_line, text}, ...]
        self.embeddings: list[list[float]] = []

    def build(self, root: str = ".") -> dict:
        """Scan and index a codebase directory.

        Returns:
            dict with status and stats.
        """
        client = _get_client()
        chunks = _scan_files(root)

        if not chunks:
            return {"status": "error", "error_message": "No source files found to index"}

        logger.info(f"RAG: Indexing {len(chunks)} chunks from {root}")

        # Generate embeddings
        texts = [f"# {c['file']}:{c['start_line']}-{c['end_line']}\n{c['text']}" for c in chunks]
        embeddings = _generate_embeddings(client, texts)

        self.chunks = chunks
        self.embeddings = embeddings

        # Count unique files
        files = set(c["file"] for c in chunks)

        # Save to disk
        index_path = os.path.join(root, INDEX_FILE)
        self.save(index_path)

        logger.info(f"RAG: Indexed {len(files)} files, {len(chunks)} chunks → {index_path}")

        return {
            "status": "success",
            "files_indexed": len(files),
            "chunks_created": len(chunks),
            "index_path": index_path,
        }

    def search(self, query: str, top_k: int = 5) -> list[dict]:
        """Search for semantically similar code chunks.

        Returns:
            List of {file, start_line, end_line, score, snippet} dicts.
        """
        if not self.chunks:
            return []

        client = _get_client()
        query_emb = _generate_query_embedding(client, query)

        # Compute similarities
        scored = []
        for i, emb in enumerate(self.embeddings):
            score = _cosine_similarity(query_emb, emb)
            scored.append((score, i))

        # Sort by score descending
        scored.sort(key=lambda x: x[0], reverse=True)

        results = []
        for score, idx in scored[:top_k]:
            chunk = self.chunks[idx]
            # Truncate text for display
            snippet = chunk["text"]
            if len(snippet) > 500:
                snippet = snippet[:500] + "\n..."
            results.append({
                "file": chunk["file"],
                "start_line": chunk["start_line"],
                "end_line": chunk["end_line"],
                "score": round(score, 4),
                "snippet": snippet,
            })

        return results

    def save(self, path: str):
        """Save index to JSON file."""
        data = {
            "chunks": self.chunks,
            "embeddings": self.embeddings,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)

    def load(self, path: str) -> bool:
        """Load index from JSON file. Returns True if loaded successfully."""
        if not os.path.isfile(path):
            return False
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.chunks = data.get("chunks", [])
            self.embeddings = data.get("embeddings", [])
            logger.info(f"RAG: Loaded index with {len(self.chunks)} chunks from {path}")
            return True
        except Exception as e:
            logger.warning(f"RAG: Failed to load index: {e}")
            return False


# Global index instance
_index = CodebaseIndex()


def get_index() -> CodebaseIndex:
    """Get the global codebase index, loading from disk if available."""
    if not _index.chunks:
        # Try loading from working directory
        index_path = os.path.join(os.getcwd(), INDEX_FILE)
        _index.load(index_path)
    return _index
