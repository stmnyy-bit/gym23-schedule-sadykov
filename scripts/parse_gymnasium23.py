#!/usr/bin/env python3
"""Парсер расписания МАОУ «Гимназия № 23» г. Троицка.

Скрипт получает расписание с официального сайта школы и сохраняет данные
в форматах JSON и JS, чтобы веб-приложение могло работать без сервера.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import ssl
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any


BASE_URL = "https://gym23trk.educhel.ru"
SCHEDULE_URL = f"{BASE_URL}/about/schedule"
BELL_URL = f"{BASE_URL}/conditions/bell_shedule"
WEEKDAYS = [
    "Понедельник",
    "Вторник",
    "Среда",
    "Четверг",
    "Пятница",
    "Суббота",
    "Воскресенье",
]


def fetch(url: str, attempts: int = 3) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; ScheduleDiplomaBot/1.0)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    context = ssl.create_default_context()
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=30, context=context) as response:
                raw = response.read()
            return raw.decode("utf-8", "replace")
        except Exception as exc:  # noqa: BLE001 - CLI must show a clear source error.
            last_error = exc
            if attempt < attempts:
                time.sleep(attempt)
    raise RuntimeError(f"Не удалось загрузить {url}: {last_error}") from last_error


def clean_markup(value: str) -> str:
    value = re.sub(r"(?is)<script.*?</script>|<style.*?</style>|<svg.*?</svg>", " ", value)
    value = re.sub(r"(?is)<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def clean_homework(value: str) -> str:
    value = clean_markup(value)
    value = re.sub(r"^Домашнее задание\s*", "", value, flags=re.I)
    empty_values = {"", "не задано", "нет задания", "отсутствует", "не задано."}
    return "" if value.strip().lower() in empty_values else value.strip()


def extract_cells(row_markup: str, tag: str = "td") -> list[str]:
    return [
        clean_markup(match.group(1))
        for match in re.finditer(rf"(?is)<{tag}[^>]*>(.*?)</{tag}>", row_markup)
    ]


def parse_class_links(index_html: str) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    seen: set[str] = set()
    pattern = r'(?is)<a[^>]+href="(/about/schedule/\d+)"[^>]*>\s*([^<]+?)\s*</a>'
    for match in re.finditer(pattern, index_html):
        href = match.group(1)
        class_name = clean_markup(match.group(2)).lower().replace(" ", "")
        if not class_name or href in seen:
            continue
        seen.add(href)
        links.append(
            {
                "className": class_name,
                "url": f"{BASE_URL}{href}",
            }
        )
    return links


def parse_schedule_page(page_html: str, class_name: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    tables = list(re.finditer(r"(?is)<table[\s\S]*?</table>", page_html))
    for table_match in tables:
        table_markup = table_match.group(0)
        if "DocumentsTable" not in table_markup:
            continue

        context = clean_markup(page_html[max(0, table_match.start() - 2500) : table_match.start()])
        dates = re.findall(r"\d{2}\.\d{2}\.\d{4}", context)
        if not dates:
            continue

        date_display = dates[-1]
        lesson_date = dt.datetime.strptime(date_display, "%d.%m.%Y").date()
        rows = re.finditer(r"(?is)<tr[^>]*>(.*?)</tr>", table_markup)
        for row in rows:
            row_markup = row.group(1)
            cells_raw = re.findall(r"(?is)<td[^>]*>(.*?)</td>", row_markup)
            cells = [clean_markup(cell) for cell in cells_raw]
            if len(cells) < 4 or not cells[0].isdigit():
                continue

            record = {
                "className": class_name,
                "date": lesson_date.isoformat(),
                "dateDisplay": date_display,
                "weekday": WEEKDAYS[lesson_date.weekday()],
                "lessonNumber": int(cells[0]),
                "subject": cells[1],
                "teacher": cells[2],
                "room": cells[3],
                "homework": clean_homework(cells_raw[4]) if len(cells_raw) > 4 else "",
                "sourceUrl": f"{SCHEDULE_URL}",
            }
            records.append(record)
    return records


def parse_bells(page_html: str) -> list[dict[str, str]]:
    bells: list[dict[str, str]] = []
    for table_match in re.finditer(r"(?is)<table[\s\S]*?</table>", page_html):
        table_markup = table_match.group(0)
        if "BellShedule" not in table_markup and "Начало" not in table_markup:
            continue
        for row in re.finditer(r"(?is)<tr[^>]*>(.*?)</tr>", table_markup):
            cells = extract_cells(row.group(1))
            if len(cells) < 4 or not cells[0].isdigit():
                continue
            bells.append(
                {
                    "lessonNumber": int(cells[0]),
                    "start": cells[1],
                    "end": cells[2],
                    "breakAfter": cells[3],
                }
            )
    return bells


def collect() -> dict[str, Any]:
    index_html = fetch(SCHEDULE_URL)
    class_links = parse_class_links(index_html)
    if not class_links:
        raise RuntimeError("На странице расписания не найдены ссылки на классы.")

    records: list[dict[str, Any]] = []

    for class_link in class_links:
        print(f"Загружаю {class_link['className']}...", file=sys.stderr)
        try:
            page_html = fetch(class_link["url"])
            class_records = parse_schedule_page(page_html, class_link["className"])
        except Exception as exc:  # noqa: BLE001 - keep scraping other classes.
            print(f"Предупреждение: {class_link['className']} пропущен: {exc}", file=sys.stderr)
            continue
        for record in class_records:
            record["sourceUrl"] = class_link["url"]
        records.extend(class_records)
        time.sleep(0.15)

    bells = parse_bells(fetch(BELL_URL))
    if not records:
        raise RuntimeError("Расписание не извлечено. Проверьте структуру сайта или доступность страниц.")

    parsed_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    return {
        "school": {
            "name": "МАОУ «Гимназия № 23»",
            "city": "Троицк",
            "region": "Челябинская область",
            "address": "457100, Челябинская область, г. Троицк, ул. им. Н.К. Крупской, д. 5",
            "phone": "+7 (351) 633-37-96",
            "email": "trmou23@mail.ru",
            "source": SCHEDULE_URL,
        },
        "parsedAt": parsed_at,
        "classes": class_links,
        "bells": bells,
        "lessons": sorted(records, key=lambda item: (item["date"], item["lessonNumber"], item["className"])),
    }


def write_outputs(payload: dict[str, Any], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "schedule.json"
    js_path = out_dir / "schedule.js"
    json_text = json.dumps(payload, ensure_ascii=False, indent=2)
    json_path.write_text(json_text + "\n", encoding="utf-8")
    js_path.write_text("window.SCHEDULE_DATA = " + json_text + ";\n", encoding="utf-8")
    print(f"Готово: {json_path}")
    print(f"Готово: {js_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Скачать расписание Гимназии №23 в JSON/JS")
    parser.add_argument("--out", default="data", help="Папка для результата")
    args = parser.parse_args()
    write_outputs(collect(), Path(args.out))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - console tool for non-technical users.
        print(f"Ошибка: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
