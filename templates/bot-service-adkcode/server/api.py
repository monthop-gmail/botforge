"""REST API wrapper for adkcode agent — bridges LINE bot to Google ADK runner."""

import asyncio
import os
import time
import uuid
import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Change to workspace dir before importing agent (so AGENTS.md loads correctly)
os.chdir("/workspace")

from adkcode.agent import root_agent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="adkcode-api", version="1.0.0")

# --- Session Service ---
session_service = InMemorySessionService()

# --- Runner ---
runner = Runner(
    agent=root_agent,
    app_name="adkcode",
    session_service=session_service,
)

# --- Session tracking ---
session_map: dict[str, dict] = {}


class CreateSessionRequest(BaseModel):
    title: str = ""


class MessageRequest(BaseModel):
    content: str


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": time.time()}


@app.post("/session")
async def create_session(req: CreateSessionRequest = CreateSessionRequest()):
    session_id = f"s-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    user_id = f"line-{uuid.uuid4().hex[:8]}"

    session = await session_service.create_session(
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
            parts=[types.Part.from_text(req.content)],
        )

        result_text = ""
        is_error = False

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
    # ADK doesn't support abort natively — just mark idle
    info["status"] = "idle"
    return {"aborted": True}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
