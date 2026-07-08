import asyncio
import html
import os
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes


BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Kolkata")
DEFAULT_CATEGORY = os.getenv("DEFAULT_TASK_CATEGORY", "study")
DEFAULT_PRIORITY = os.getenv("DEFAULT_TASK_PRIORITY", "normal")
MAX_TASKS_PER_MESSAGE = int(os.getenv("MAX_TASKS_PER_MESSAGE", "25"))
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://taskboard7.up.railway.app").rstrip("/")

# Shared in-memory store for Telegram login tokens.
# Keys are token strings; values are dicts with user info filled by the bot.
pending_telegram_tokens: dict[str, dict[str, Any]] = {}


class SupabaseError(RuntimeError):
    pass


class SupabaseClient:
    def __init__(self, url: str, key: str) -> None:
        self.base_url = f"{url}/rest/v1"
        self.client = httpx.AsyncClient(
            timeout=20,
            headers={
                "apikey": key,
                "authorization": f"Bearer {key}",
                "content-type": "application/json",
            },
        )

    async def close(self) -> None:
        await self.client.aclose()

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = await self.client.request(method, f"{self.base_url}/{path}", **kwargs)
        if response.status_code >= 400:
            raise SupabaseError(response.text)
        if not response.content:
            return None
        return response.json()

    async def get_user_by_email(self, email: str) -> dict[str, Any] | None:
        rows = await self.request(
            "GET",
            "users",
            params={
                "email": f"eq.{email}",
                "select": "id,name,email,telegram_chat_id,study_subjects,study_date,today_study_seconds",
                "limit": "1",
            },
        )
        return rows[0] if rows else None

    async def get_user_by_chat_id(self, chat_id: int) -> dict[str, Any] | None:
        rows = await self.request(
            "GET",
            "users",
            params={
                "telegram_chat_id": f"eq.{chat_id}",
                "select": "id,name,email,telegram_chat_id,study_subjects,study_date,today_study_seconds",
                "limit": "1",
            },
        )
        return rows[0] if rows else None

    async def link_chat(self, user_id: Any, chat_id: int) -> None:
        await self.request(
            "PATCH",
            "users",
            params={"id": f"eq.{user_id}"},
            headers={"prefer": "return=minimal"},
            json={"telegram_chat_id": str(chat_id)},
        )

    async def unlink_chat(self, chat_id: int) -> None:
        await self.request(
            "PATCH",
            "users",
            params={"telegram_chat_id": f"eq.{chat_id}"},
            headers={"prefer": "return=minimal"},
            json={"telegram_chat_id": None},
        )

    async def pending_tasks(self, user_id: Any) -> list[dict[str, Any]]:
        return await self.request(
            "GET",
            "tasks",
            params={
                "user_id": f"eq.{user_id}",
                "done": "eq.false",
                "select": "id,title,category,priority,date,time,created_at",
                "order": "date.asc,time.asc,created_at.asc",
                "limit": "50",
            },
        )

    async def add_tasks(self, user_id: Any, titles: list[str], date_key: str) -> list[dict[str, Any]]:
        payload = [
            {
                "user_id": user_id,
                "title": title,
                "description": "",
                "category": DEFAULT_CATEGORY,
                "priority": DEFAULT_PRIORITY,
                "date": date_key,
                "time": None,
                "subtasks": [],
                "done": False,
                "pinned": False,
            }
            for title in titles
        ]
        return await self.request(
            "POST",
            "tasks",
            headers={"prefer": "return=representation"},
            json=payload,
        )

    async def study_history_for_today(self, user_id: Any, date_key: str) -> dict[str, Any] | None:
        rows = await self.request(
            "GET",
            "study_history",
            params={
                "user_id": f"eq.{user_id}",
                "date": f"eq.{date_key}",
                "select": "subjects",
                "limit": "1",
            },
        )
        return rows[0] if rows else None


sb = SupabaseClient(SUPABASE_URL, SUPABASE_KEY)


def today_key() -> str:
    return datetime.now(ZoneInfo(APP_TIMEZONE)).date().isoformat()


def escape(value: Any) -> str:
    return html.escape(str(value or ""), quote=False)


def format_duration(seconds: float | int | None) -> str:
    total = max(0, int(seconds or 0))
    hours = total // 3600
    minutes = (total % 3600) // 60
    if hours:
        return f"{hours}h {minutes:02d}m"
    return f"{minutes}m"


def parse_task_titles(raw: str) -> list[str]:
    cleaned = raw.strip()
    if not cleaned:
        return []
    pieces: list[str] = []
    for line in cleaned.replace(";", "\n").splitlines():
        title = line.strip().lstrip("-*0123456789. ").strip()
        if title:
            pieces.append(title)
    return pieces[:MAX_TASKS_PER_MESSAGE]


def missing_link_column_message() -> str:
    return (
        "Telegram linking needs this Supabase column:\n\n"
        "<code>alter table public.users add column if not exists telegram_chat_id text;</code>\n\n"
        "Run that once in Supabase SQL editor, then use /link again."
    )


async def require_linked_user(update: Update) -> dict[str, Any] | None:
    chat_id = update.effective_chat.id
    try:
        user = await sb.get_user_by_chat_id(chat_id)
    except SupabaseError as exc:
        if "telegram_chat_id" in str(exc):
            await update.effective_message.reply_text(missing_link_column_message(), parse_mode=ParseMode.HTML)
            return None
        raise
    if not user:
        await update.effective_message.reply_text(
            "This Telegram chat is not linked yet.\n\nUse:\n"
            "<code>/link your-email@example.com</code>",
            parse_mode=ParseMode.HTML,
        )
        return None
    return user


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    # Deep-link login flow: /start <token>
    if context.args and context.args[0] in pending_telegram_tokens:
        token = context.args[0]
        entry = pending_telegram_tokens[token]
        # Check expiry (5 minutes)
        if time.time() - entry["created_at"] > 300:
            del pending_telegram_tokens[token]
            await update.message.reply_text("This login link has expired. Please try again from the TaskBoard website.")
            return

        tg_user = update.effective_user
        display_name = tg_user.first_name or "User"
        if tg_user.last_name:
            display_name += f" {tg_user.last_name}"
        username = tg_user.username or ""

        entry.update({
            "telegram_id": tg_user.id,
            "display_name": display_name,
            "telegram_username": username,
            "verified": True,
        })

        callback_url = f"{WEBAPP_URL}/api/auth/telegram/callback?token={token}"
        await update.message.reply_text(
            f"Welcome, {display_name}! \u2728\n\n"
            f"Tap below to sign in to TaskBoard:\n"
            f"{callback_url}",
        )
        return

    # Normal /start — show help
    await update.message.reply_text(
        "TaskBoard bot is ready.\n\n"
        "Commands:\n"
        "/link email@example.com - connect this chat to your TaskBoard account\n"
        "/stats - show pending tasks and today's study hours\n"
        "/task task name - add a daily task\n"
        "/task task 1; task 2; task 3 - add many tasks at once\n"
        "/unlink - disconnect this Telegram chat"
    )


async def link(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not context.args:
        await update.message.reply_text("Use: /link your-email@example.com")
        return
    email = context.args[0].strip().lower()
    try:
        user = await sb.get_user_by_email(email)
        if not user:
            await update.message.reply_text("No TaskBoard account was found for that email.")
            return
        await sb.link_chat(user["id"], update.effective_chat.id)
    except SupabaseError as exc:
        if "telegram_chat_id" in str(exc):
            await update.message.reply_text(missing_link_column_message(), parse_mode=ParseMode.HTML)
            return
        raise
    await update.message.reply_text(f"Linked to TaskBoard user: {user.get('name') or email}")


async def unlink(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await sb.unlink_chat(update.effective_chat.id)
    await update.message.reply_text("This Telegram chat is no longer linked to TaskBoard.")


async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = await require_linked_user(update)
    if not user:
        return
    date_key = today_key()
    pending = await sb.pending_tasks(user["id"])
    subjects = []

    if user.get("study_date") == date_key and isinstance(user.get("study_subjects"), list):
        subjects = user["study_subjects"]
    else:
        try:
            history = await sb.study_history_for_today(user["id"], date_key)
            subjects = list((history or {}).get("subjects", {}).values())
        except SupabaseError:
            subjects = []

    study_rows = []
    total_seconds = 0
    for subject in subjects:
        seconds = subject.get("seconds", subject.get("secs", 0)) if isinstance(subject, dict) else 0
        name = subject.get("name", "Subject") if isinstance(subject, dict) else "Subject"
        if seconds:
            total_seconds += int(seconds)
            study_rows.append(f"- {escape(name)}: {format_duration(seconds)}")

    task_rows = []
    for i, task in enumerate(pending, 1):
        date_text = task.get("date") or "No date"
        time_text = f" {task['time']}" if task.get("time") else ""
        task_rows.append(
            f"{i}. {escape(task.get('title'))} "
            f"({escape(task.get('category'))}, {escape(task.get('priority'))}, {escape(date_text)}{escape(time_text)})"
        )

    message = [
        f"<b>TaskBoard stats for {escape(user.get('name') or 'you')}</b>",
        f"<b>Date:</b> {escape(date_key)}",
        "",
        f"<b>Study today:</b> {format_duration(total_seconds)}",
        *(study_rows or ["- No study time logged today."]),
        "",
        f"<b>Pending tasks:</b> {len(pending)}",
        *(task_rows or ["- No pending tasks."]),
    ]
    await update.message.reply_text("\n".join(message), parse_mode=ParseMode.HTML)


async def task(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = await require_linked_user(update)
    if not user:
        return
    raw = update.message.text.partition(" ")[2]
    titles = parse_task_titles(raw)
    if not titles:
        await update.message.reply_text(
            "Use:\n"
            "<code>/task Revise electrostatics</code>\n\n"
            "Or add many:\n"
            "<code>/task Physics numericals; Chemistry notes; Maths practice</code>",
            parse_mode=ParseMode.HTML,
        )
        return
    added = await sb.add_tasks(user["id"], titles, today_key())
    rows = [f"- {escape(row.get('title'))}" for row in added]
    await update.message.reply_text(
        f"Added {len(added)} task(s) for today:\n" + "\n".join(rows),
        parse_mode=ParseMode.HTML,
    )


async def whoami(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = await require_linked_user(update)
    if not user:
        return
    await update.message.reply_text(
        f"Linked as {user.get('name') or 'TaskBoard user'}\n"
        f"Email: {user.get('email') or 'unknown'}"
    )


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    print("Telegram bot error:", repr(context.error))
    if isinstance(update, Update) and update.effective_message:
        await update.effective_message.reply_text("Something went wrong. Please try again in a moment.")


async def post_shutdown(application: Application) -> None:
    await sb.close()


def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("Missing TELEGRAM_BOT_TOKEN. Add it in Railway Variables before running telegram_bot.py directly.")
    application = (
        Application.builder()
        .token(BOT_TOKEN)
        .post_shutdown(post_shutdown)
        .build()
    )
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", start))
    application.add_handler(CommandHandler("link", link))
    application.add_handler(CommandHandler("unlink", unlink))
    application.add_handler(CommandHandler("stats", stats))
    application.add_handler(CommandHandler("task", task))
    application.add_handler(CommandHandler("whoami", whoami))
    application.add_error_handler(error_handler)
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        asyncio.run(sb.close())
