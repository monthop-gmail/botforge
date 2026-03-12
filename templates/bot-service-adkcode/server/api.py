"""REST API wrapper for adkcode agent — bridges LINE bot to Google ADK runner.

Uses ADK's built-in web UI with shared session service so LINE bot sessions
are visible in the web UI and vice versa.
"""

import os
import time
import uuid
import logging
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel
from google.genai import types

# Change to workspace dir before importing agent (so AGENTS.md loads correctly)
os.chdir("/workspace")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Build ADK app with shared session service ---
from google.adk.sessions import InMemorySessionService
from google.adk.runners import Runner
from google.adk.cli.fast_api import (
    AdkWebServer,
    AgentLoader,
    InMemoryCredentialService,
    LocalEvalSetsManager,
    LocalEvalSetResultsManager,
    create_artifact_service_from_options,
    create_memory_service_from_options,
)

AGENTS_DIR = "/app"
PORT = int(os.environ.get("PORT", 8000))

# Shared session service — used by both ADK web UI and LINE bot endpoints
session_service = InMemorySessionService()

agent_loader = AgentLoader(agents_dir=AGENTS_DIR)
artifact_service = create_artifact_service_from_options(
    base_dir=AGENTS_DIR, artifact_service_uri=None, strict_uri=False, use_local_storage=True,
)
memory_service = create_memory_service_from_options(base_dir=AGENTS_DIR, memory_service_uri=None)
credential_service = InMemoryCredentialService()
eval_sets_manager = LocalEvalSetsManager(agents_dir=AGENTS_DIR)
eval_set_results_manager = LocalEvalSetResultsManager(agents_dir=AGENTS_DIR)

adk_web_server = AdkWebServer(
    agent_loader=agent_loader,
    session_service=session_service,
    artifact_service=artifact_service,
    memory_service=memory_service,
    credential_service=credential_service,
    eval_sets_manager=eval_sets_manager,
    eval_set_results_manager=eval_set_results_manager,
    agents_dir=AGENTS_DIR,
)

# Get web assets dir for ADK web UI
WEB_ASSETS_DIR = Path(os.path.dirname(__file__)) / "../.." / "browser"
try:
    import google.adk.cli as adk_cli
    WEB_ASSETS_DIR = Path(os.path.dirname(adk_cli.__file__)) / "browser"
except Exception:
    pass

app = adk_web_server.get_fast_api_app(
    allow_origins=["*"],
    web_assets_dir=WEB_ASSETS_DIR if WEB_ASSETS_DIR.exists() else None,
)

# --- Optional auth middleware ---
API_PASSWORD = os.environ.get("API_PASSWORD", "")

if API_PASSWORD:
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import JSONResponse

    class AuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            # Skip auth for health, root, event, and dev-ui/static assets
            if request.url.path in ("/health", "/", "/event") or request.url.path.startswith("/dev-ui"):
                return await call_next(request)

            auth = request.headers.get("authorization", "")
            if not auth:
                return JSONResponse({"error": "Authorization required"}, status_code=401)

            if auth.startswith("Bearer "):
                if auth[7:] != API_PASSWORD:
                    return JSONResponse({"error": "Invalid password"}, status_code=403)
            else:
                return JSONResponse({"error": "Invalid auth format"}, status_code=401)

            return await call_next(request)

    app.add_middleware(AuthMiddleware)
    logger.info("Auth: enabled")
else:
    logger.info("Auth: disabled")

# --- Use the SAME runner as web UI (no separate runner) ---
async def get_runner():
    return await adk_web_server.get_runner_async("adkcode")

# --- Session tracking for LINE bot ---
session_map: dict[str, dict] = {}


class CreateSessionRequest(BaseModel):
    title: str = ""
    user_id: str = ""


class MessageRequest(BaseModel):
    content: str


@app.post("/session")
async def create_session(req: CreateSessionRequest = CreateSessionRequest()):
    session_id = f"s-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    # Always use fixed "user" so sessions are easily visible in ADK web UI
    # LINE user IDs are stored in session_map for reference but not used for ADK sessions
    user_id = "user"

    await session_service.create_session(
        app_name="adkcode",
        user_id=user_id,
        session_id=session_id,
    )

    session_map[session_id] = {
        "id": session_id,
        "user_id": user_id,
        "created_at": time.time(),
        "status": "idle",
    }

    logger.info(f"Created session: {session_id}")
    return {"id": session_id, "user_id": user_id}


@app.get("/session/{session_id}")
async def get_session(session_id: str):
    info = session_map.get(session_id)
    if not info:
        raise HTTPException(status_code=404, detail="Session not found")
    return info


@app.delete("/session/{session_id}")
async def delete_session(session_id: str):
    if session_id in session_map:
        del session_map[session_id]
    return {"deleted": True}


@app.post("/session/{session_id}/message")
async def send_message(session_id: str, req: MessageRequest):
    info = session_map.get(session_id)
    if not info:
        raise HTTPException(status_code=404, detail="Session not found")

    if info["status"] == "running":
        raise HTTPException(status_code=409, detail="Session is busy")

    info["status"] = "running"
    start = time.time()

    try:
        content = types.Content(
            role="user",
            parts=[types.Part.from_text(text=req.content)],
        )

        result_text = ""
        is_error = False
        runner = await get_runner()

        async for event in runner.run_async(
            user_id=info["user_id"],
            session_id=session_id,
            new_message=content,
        ):
            if event.is_final_response():
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if part.text:
                            result_text += part.text

        if not result_text:
            result_text = "เสร็จแล้วครับ (ไม่มีข้อความตอบกลับ)"

        duration_ms = int((time.time() - start) * 1000)
        logger.info(f"[{session_id}] done: {duration_ms}ms, {len(result_text)} chars")

        return {
            "result": result_text,
            "session_id": session_id,
            "is_error": is_error,
            "duration_ms": duration_ms,
        }

    except Exception as e:
        logger.error(f"[{session_id}] error: {e}")
        return {
            "result": str(e),
            "session_id": session_id,
            "is_error": True,
            "duration_ms": int((time.time() - start) * 1000),
        }
    finally:
        info["status"] = "idle"


@app.post("/session/{session_id}/abort")
async def abort_session(session_id: str):
    info = session_map.get(session_id)
    if not info:
        raise HTTPException(status_code=404, detail="Session not found")
    info["status"] = "idle"
    return {"aborted": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
