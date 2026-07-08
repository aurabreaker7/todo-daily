import os
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from telegram.ext import Application, CommandHandler

from telegram_bot import (
    BOT_TOKEN,
    sb,
    error_handler,
    link,
    start,
    stats,
    task,
    unlink,
    whoami,
)


SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]


app = FastAPI(title="TaskBoard Railway API")
telegram_app: Application | None = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginBody(BaseModel):
    email: str
    password: str


class SignupBody(BaseModel):
    name: str
    email: str
    password: str


class TaskBody(BaseModel):
    title: str
    description: str = ""
    category: str = "study"
    priority: str = "normal"
    date: str
    time: str | None = None
    subtasks: list[dict[str, Any]] = []
    pinned: bool = False


class TaskPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    priority: str | None = None
    date: str | None = None
    time: str | None = None
    subtasks: list[dict[str, Any]] | None = None
    done: bool | None = None
    pinned: bool | None = None
    done_at: str | None = None


class ProfilePatch(BaseModel):
    name: str | None = None
    status_message: str | None = None
    workspace_title: str | None = None
    layout_sort: str | None = None
    avatar_url: str | None = None
    xp_total: int | None = None
    current_level: int | None = None
    total_study_seconds: int | None = None
    today_study_seconds: int | None = None
    study_date: str | None = None
    study_subjects: list[dict[str, Any]] | None = None


async def supabase_auth_request(method: str, path: str, **kwargs: Any) -> Any:
    headers = kwargs.pop("headers", {})
    headers.update({"apikey": SUPABASE_ANON_KEY})
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.request(
            method,
            f"{SUPABASE_URL}/auth/v1/{path}",
            headers=headers,
            **kwargs,
        )
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json() if response.content else None


async def current_auth_user(authorization: str = Header(default="")) -> dict[str, Any]:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    return await supabase_auth_request(
        "GET",
        "user",
        headers={"authorization": f"Bearer {token}"},
    )


async def current_profile(auth_user: dict[str, Any] = Depends(current_auth_user)) -> dict[str, Any]:
    rows = await sb.request(
        "GET",
        "users",
        params={
            "auth_id": f"eq.{auth_user['id']}",
            "select": "*",
            "limit": "1",
        },
    )
    if rows:
        return rows[0]
    email = auth_user.get("email") or ""
    name = (auth_user.get("user_metadata") or {}).get("name") or email.split("@")[0] or "User"
    created = await sb.request(
        "POST",
        "users",
        headers={"prefer": "return=representation"},
        json={"name": name, "email": email, "auth_id": auth_user["id"]},
    )
    return created[0]


def clean_payload(payload: Any) -> Any:
    if isinstance(payload, list):
        return [clean_payload(item) for item in payload]
    if not isinstance(payload, dict):
        return payload
    return {k: v for k, v in payload.items() if v is not None}


def restricted_params(table: str, raw_params: dict[str, str], profile: dict[str, Any]) -> dict[str, str]:
    params = dict(raw_params)
    if table in {"tasks", "quick_notes"}:
        params["user_id"] = f"eq.{profile['id']}"
    elif table == "study_history":
        params["user_id"] = f"eq.{profile['id']}"
    elif table == "users":
        params["id"] = f"eq.{profile['id']}"
    return params


@app.on_event("startup")
async def startup() -> None:
    global telegram_app
    telegram_app = Application.builder().token(BOT_TOKEN).build()
    telegram_app.add_handler(CommandHandler("start", start))
    telegram_app.add_handler(CommandHandler("help", start))
    telegram_app.add_handler(CommandHandler("link", link))
    telegram_app.add_handler(CommandHandler("unlink", unlink))
    telegram_app.add_handler(CommandHandler("stats", stats))
    telegram_app.add_handler(CommandHandler("task", task))
    telegram_app.add_handler(CommandHandler("whoami", whoami))
    telegram_app.add_error_handler(error_handler)
    await telegram_app.initialize()
    await telegram_app.start()
    await telegram_app.updater.start_polling()


@app.on_event("shutdown")
async def shutdown() -> None:
    if telegram_app:
        await telegram_app.updater.stop()
        await telegram_app.stop()
        await telegram_app.shutdown()
    await sb.close()


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"ok": "true"}


@app.get("/")
async def index() -> FileResponse:
    return FileResponse("index.html")


@app.post("/api/auth/login")
async def login(body: LoginBody) -> dict[str, Any]:
    return await supabase_auth_request(
        "POST",
        "token?grant_type=password",
        json={"email": body.email, "password": body.password},
    )


@app.post("/api/auth/signup")
async def signup(body: SignupBody) -> dict[str, Any]:
    result = await supabase_auth_request(
        "POST",
        "signup",
        json={
            "email": body.email,
            "password": body.password,
            "data": {"name": body.name, "full_name": body.name},
        },
    )
    user_id = result.get("id") or (result.get("user") or {}).get("id")
    if user_id:
        await sb.request(
            "POST",
            "users",
            headers={"prefer": "return=minimal"},
            json={"name": body.name, "email": body.email, "auth_id": user_id},
        )
    return result


@app.get("/api/me")
async def me(profile: dict[str, Any] = Depends(current_profile)) -> dict[str, Any]:
    return profile


@app.patch("/api/me")
async def update_me(
    body: ProfilePatch,
    profile: dict[str, Any] = Depends(current_profile),
) -> dict[str, Any]:
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        return profile
    rows = await sb.request(
        "PATCH",
        "users",
        params={"id": f"eq.{profile['id']}"},
        headers={"prefer": "return=representation"},
        json=patch,
    )
    return rows[0] if rows else {**profile, **patch}


@app.get("/api/bootstrap")
async def bootstrap(profile: dict[str, Any] = Depends(current_profile)) -> dict[str, Any]:
    tasks = await sb.request(
        "GET",
        "tasks",
        params={
            "user_id": f"eq.{profile['id']}",
            "select": "*",
            "order": "created_at.desc",
        },
    )
    quick_notes = await sb.request(
        "GET",
        "quick_notes",
        params={"user_id": f"eq.{profile['id']}", "select": "id,content", "limit": "1"},
    )
    history = await sb.request(
        "GET",
        "study_history",
        params={"user_id": f"eq.{profile['id']}", "select": "date,subjects"},
    )
    return {
        "profile": profile,
        "tasks": tasks,
        "quick_note": quick_notes[0] if quick_notes else None,
        "study_history": history,
    }


@app.get("/api/tasks")
async def list_tasks(profile: dict[str, Any] = Depends(current_profile)) -> list[dict[str, Any]]:
    return await sb.request(
        "GET",
        "tasks",
        params={"user_id": f"eq.{profile['id']}", "select": "*", "order": "created_at.desc"},
    )


@app.post("/api/tasks")
async def create_task(
    body: TaskBody,
    profile: dict[str, Any] = Depends(current_profile),
) -> dict[str, Any]:
    rows = await sb.request(
        "POST",
        "tasks",
        headers={"prefer": "return=representation"},
        json={**body.model_dump(), "user_id": profile["id"], "done": False},
    )
    return rows[0]


@app.patch("/api/tasks/{task_id}")
async def update_task(
    task_id: str,
    body: TaskPatch,
    profile: dict[str, Any] = Depends(current_profile),
) -> dict[str, Any]:
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    rows = await sb.request(
        "PATCH",
        "tasks",
        params={"id": f"eq.{task_id}", "user_id": f"eq.{profile['id']}"},
        headers={"prefer": "return=representation"},
        json=patch,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    return rows[0]


@app.delete("/api/tasks/{task_id}")
async def delete_task(
    task_id: str,
    profile: dict[str, Any] = Depends(current_profile),
) -> dict[str, bool]:
    await sb.request(
        "DELETE",
        "tasks",
        params={"id": f"eq.{task_id}", "user_id": f"eq.{profile['id']}"},
        headers={"prefer": "return=minimal"},
    )
    return {"ok": True}


@app.get("/api/leaderboard")
async def leaderboard() -> list[dict[str, Any]]:
    return await sb.request(
        "GET",
        "leaderboard_view",
        params={
            "select": "id,name,total_study_seconds,today_study_seconds,study_date,xp_total,current_level,avatar_url",
            "order": "total_study_seconds.desc",
            "limit": "50",
        },
    )


@app.api_route("/api/rest/{table}", methods=["GET", "POST", "PATCH", "DELETE"])
async def rest_proxy(
    table: str,
    request: Request,
    profile: dict[str, Any] = Depends(current_profile),
) -> Any:
    allowed = {"users", "tasks", "quick_notes", "study_history", "leaderboard_view"}
    if table not in allowed:
        raise HTTPException(status_code=403, detail="Table is not allowed")

    method = request.method
    raw_params = dict(request.query_params)
    params = restricted_params(table, raw_params, profile)

    if table == "leaderboard_view" and method != "GET":
        raise HTTPException(status_code=405, detail="Leaderboard is read-only")

    if method == "GET":
        return await sb.request("GET", table, params=params)

    payload = clean_payload(await request.json()) if method in {"POST", "PATCH"} else None

    if method == "POST":
        if table == "users":
            return [profile]
        if table in {"tasks", "quick_notes"}:
            if isinstance(payload, list):
                payload = [{**item, "user_id": profile["id"]} for item in payload]
            else:
                payload = {**payload, "user_id": profile["id"]}
        if table == "study_history":
            if isinstance(payload, list):
                payload = [{**item, "user_id": str(profile["id"])} for item in payload]
            else:
                payload = {**payload, "user_id": str(profile["id"])}
        prefer = "resolution=merge-duplicates,return=representation" if request.headers.get("x-upsert") == "true" else "return=representation"
        return await sb.request("POST", table, params=params, headers={"prefer": prefer}, json=payload)

    if method == "PATCH":
        return await sb.request(
            "PATCH",
            table,
            params=params,
            headers={"prefer": "return=representation"},
            json=payload,
        )

    if method == "DELETE":
        if table == "users":
            raise HTTPException(status_code=405, detail="Deleting users is disabled")
        await sb.request("DELETE", table, params=params, headers={"prefer": "return=minimal"})
        return {"ok": True}
